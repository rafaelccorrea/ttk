import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { Repository } from 'typeorm';
import { CREDIT_PACKS, PLANS } from './billing.config';
import { BillingService } from './billing.service';
import { CreditTransaction } from './entities/credit-transaction.entity';

/**
 * Stripe Checkout: pacotes = pagamento único; planos = assinatura mensal.
 * Créditos SÓ entram depois do Stripe confirmar o pagamento — via webhook
 * (produção) ou via confirmSession (redirect de sucesso, verificado
 * server-side na API do Stripe). Ambos são idempotentes pelo session/invoice
 * id gravado em credit_transactions.reference.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly webhookSecret: string;
  private readonly appUrl: string;

  constructor(
    config: ConfigService,
    private readonly billing: BillingService,
    @InjectRepository(CreditTransaction)
    private readonly transactions: Repository<CreditTransaction>,
  ) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:5173';
  }

  get enabled(): boolean {
    return this.stripe !== null;
  }

  private require(): Stripe {
    if (!this.stripe) {
      throw new BadRequestException(
        'Pagamentos indisponíveis: Stripe não configurado.',
      );
    }
    return this.stripe;
  }

  /** Cria a sessão de checkout e devolve a URL para redirecionar o usuário. */
  async createCheckout(
    userId: string,
    email: string | undefined,
    item: { packId?: string; planId?: string },
  ): Promise<{ url: string }> {
    const stripe = this.require();

    let session: Stripe.Checkout.Session;
    const common = {
      success_url: `${this.appUrl}/planos?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.appUrl}/planos?canceled=1`,
      customer_email: email,
    };

    if (item.packId) {
      const pack = CREDIT_PACKS.find((p) => p.id === item.packId);
      if (!pack) throw new NotFoundException(`Pacote ${item.packId} não existe`);
      session = await stripe.checkout.sessions.create({
        ...common,
        mode: 'payment',
        metadata: { userId, kind: 'pack', itemId: pack.id },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'brl',
              unit_amount: Math.round(pack.priceBrl * 100),
              product_data: {
                name: `PikPok — ${pack.name}`,
                description: `${pack.credits} créditos de IA`,
              },
            },
          },
        ],
      });
    } else if (item.planId) {
      const plan = PLANS.find((p) => p.id === item.planId);
      if (!plan || plan.priceBrl === 0) {
        throw new NotFoundException(`Plano ${item.planId} não existe`);
      }
      session = await stripe.checkout.sessions.create({
        ...common,
        mode: 'subscription',
        metadata: { userId, kind: 'plan', itemId: plan.id },
        subscription_data: {
          metadata: { userId, kind: 'plan', itemId: plan.id },
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'brl',
              unit_amount: Math.round(plan.priceBrl * 100),
              recurring: { interval: 'month' },
              product_data: {
                name: `PikPok ${plan.name}`,
                description: `${plan.monthlyCredits} créditos de IA por mês`,
              },
            },
          },
        ],
      });
    } else {
      throw new BadRequestException('Informe packId ou planId.');
    }

    if (!session.url) {
      throw new BadRequestException('Stripe não retornou URL de checkout.');
    }
    return { url: session.url };
  }

  /**
   * Chamado no redirect de sucesso: confere o pagamento direto na API do
   * Stripe (o cliente não consegue forjar) e credita se ainda não creditado.
   */
  async confirmSession(userId: string, sessionId: string) {
    const stripe = this.require();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.userId !== userId) {
      throw new BadRequestException('Sessão de outro usuário.');
    }
    if (session.payment_status !== 'paid') {
      throw new BadRequestException('Pagamento ainda não confirmado.');
    }
    await this.grantForSession(
      session.metadata.userId,
      session.metadata.kind,
      session.metadata.itemId,
      session.id,
    );
    return this.billing.getWallet(userId);
  }

  /** Webhook do Stripe (produção): exige STRIPE_WEBHOOK_SECRET. */
  async handleWebhook(rawBody: Buffer, signature: string) {
    const stripe = this.require();
    if (!this.webhookSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET não configurado.');
    }
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.payment_status === 'paid' && session.metadata?.userId) {
        await this.grantForSession(
          session.metadata.userId,
          session.metadata.kind,
          session.metadata.itemId,
          session.id,
        );
      }
    } else if (event.type === 'invoice.paid') {
      // Renovação mensal da assinatura → novo lote de créditos.
      const invoice = event.data.object as Stripe.Invoice;
      const meta = (invoice as any).subscription_details?.metadata ?? {};
      if (
        meta.userId &&
        meta.kind === 'plan' &&
        invoice.billing_reason === 'subscription_cycle'
      ) {
        await this.grantForSession(meta.userId, 'plan', meta.itemId, invoice.id!);
      }
    }
    return { received: true };
  }

  /** Credita o item pago — idempotente pelo reference (session/invoice id). */
  private async grantForSession(
    userId: string,
    kind: string | undefined,
    itemId: string | undefined,
    stripeRef: string,
  ) {
    const already = await this.transactions.findOneBy({
      userId,
      reference: stripeRef,
    });
    if (already) return;

    if (kind === 'pack') {
      const pack = CREDIT_PACKS.find((p) => p.id === itemId);
      if (!pack) return;
      await this.billing.grantPaid(
        userId,
        pack.credits,
        'purchase',
        stripeRef,
        `${pack.name} — pago via Stripe`,
      );
      this.logger.log(`Pack ${itemId} creditado para ${userId} (${stripeRef})`);
    } else if (kind === 'plan') {
      const plan = PLANS.find((p) => p.id === itemId);
      if (!plan) return;
      await this.billing.setPlan(userId, plan.id);
      await this.billing.grantPaid(
        userId,
        plan.monthlyCredits,
        'plan_grant',
        stripeRef,
        `Plano ${plan.name} — pago via Stripe`,
      );
      this.logger.log(`Plano ${itemId} ativado para ${userId} (${stripeRef})`);
    }
  }
}
