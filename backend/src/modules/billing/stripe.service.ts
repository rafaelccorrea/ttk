import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
// Sem esModuleInterop no tsconfig, o default import do stripe vira undefined.
import Stripe = require('stripe');
import { Repository } from 'typeorm';
import {
  BillingCycle,
  CREDIT_PACKS,
  PLANS,
  findLiveHourPack,
  findPlan,
  livePackMinutes,
  planCredits,
  planLiveMinutes,
  planPrice,
} from './billing.config';
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
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly webhookSecret: string;
  private readonly appUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly billing: BillingService,
    @InjectRepository(CreditTransaction)
    private readonly transactions: Repository<CreditTransaction>,
  ) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:5173';
  }

  /**
   * O valor cobrado vem do Price cadastrado no Stripe, mas a vitrine (landing
   * e /planos) lê o billing.config — se os dois divergirem, a página mente
   * sobre o preço. Este check roda no boot e grita quando isso acontece.
   * Não derruba o servidor: é falha de configuração externa, não de código.
   */
  async onModuleInit(): Promise<void> {
    if (!this.stripe) return;
    const expected: Array<[string, string | undefined, number]> = [
      ...PLANS.flatMap((plan) => {
        const rows: Array<[string, string | undefined, number]> = [];
        if (plan.priceBrl > 0) {
          rows.push([
            `${plan.id}/mensal`,
            this.priceIdFor(plan.id, 'month'),
            plan.priceBrl,
          ]);
        }
        if (plan.annual) {
          rows.push([
            `${plan.id}/anual`,
            this.priceIdFor(plan.id, 'year'),
            plan.annual.priceBrl,
          ]);
        }
        return rows;
      }),
      ...CREDIT_PACKS.map(
        (pack): [string, string | undefined, number] => [
          pack.id,
          this.packPriceIdFor(pack.id),
          pack.priceBrl,
        ],
      ),
    ];

    let checked = 0;
    for (const [label, priceId, priceBrl] of expected) {
      if (!priceId) continue; // sem cadastro → cai no price_data inline
      checked += 1;
      try {
        const price = await this.stripe.prices.retrieve(priceId);
        const cents = Math.round(priceBrl * 100);
        if (price.unit_amount !== cents) {
          this.logger.error(
            `Preço divergente em "${label}": Stripe cobra ${price.unit_amount} centavos, ` +
              `o billing.config anuncia ${cents}. Alinhe os dois antes de vender.`,
          );
        } else if (!price.active) {
          this.logger.error(`Price ${priceId} ("${label}") está arquivado no Stripe.`);
        }
      } catch (err) {
        this.logger.warn(
          `Não consegui conferir o price de "${label}" (${priceId}): ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Stripe: ${checked} de ${expected.length} preços conferidos contra o billing.config.`,
    );
  }

  get enabled(): boolean {
    return this.stripe !== null;
  }

  /**
   * Price id cadastrado no Stripe para o plano/ciclo, por convenção de env:
   * `STRIPE_PRICE_PRO_MONTH`, `STRIPE_PRICE_PRO_YEAR`, `STRIPE_PRICE_BUSINESS_MONTH`.
   * Sem a variável, o checkout cai no `price_data` inline (útil em dev, onde
   * ninguém cadastrou o catálogo) — o preço então vem do billing.config.
   */
  private priceIdFor(planId: string, cycle: BillingCycle): string | undefined {
    return this.envPrice(`${planId}_${cycle}`);
  }

  /** Idem para os pacotes avulsos: `STRIPE_PRICE_PACK_100`, ... */
  private packPriceIdFor(packId: string): string | undefined {
    return this.envPrice(packId);
  }

  private envPrice(suffix: string): string | undefined {
    const key = `STRIPE_PRICE_${suffix.toUpperCase().replace(/-/g, '_')}`;
    return this.config.get<string>(key)?.trim() || undefined;
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
    item: {
      packId?: string;
      planId?: string;
      livePackId?: string;
      cycle?: BillingCycle;
    },
  ): Promise<{ url: string }> {
    const stripe = this.require();

    let session: Stripe.Checkout.Session;
    // Para onde o Stripe devolve o usuário depende de por que ele foi pagar.
    // Assinatura sai da tela `/assinatura` (fora do app, o paywall) e volta
    // para lá, que confirma a sessão e então entra no app. Pacote de créditos
    // é comprado por quem já assina, dentro de `/planos` — mandá-lo para o
    // paywall seria expulsá-lo do produto que ele paga.
    const returnPath = item.planId ? '/assinatura' : '/planos';
    const common = {
      success_url: `${this.appUrl}${returnPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.appUrl}${returnPath}?canceled=1`,
      customer_email: email,
    };

    if (item.packId) {
      const pack = CREDIT_PACKS.find((p) => p.id === item.packId);
      if (!pack) throw new NotFoundException(`Pacote ${item.packId} não existe`);
      await this.billing.assertSubscriber(userId);
      session = await stripe.checkout.sessions.create({
        ...common,
        mode: 'payment',
        // Sem `payment_method_types`: o Stripe oferece os métodos que estiverem
        // habilitados na conta. PIX caberia bem aqui (pacote é cobrança única e
        // à vista converte melhor no Brasil), mas fixar a lista quebraria o
        // checkout enquanto o método não estiver ativo no Dashboard — então
        // deixamos a conta mandar. Para ligar o PIX, basta habilitá-lo lá.
        metadata: { userId, kind: 'pack', itemId: pack.id },
        line_items: [
          this.packPriceIdFor(pack.id)
            ? { price: this.packPriceIdFor(pack.id), quantity: 1 }
            : {
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
    } else if (item.livePackId) {
      /*
       * Add-on de horas de live. Cobrança única, como o pacote de créditos, mas
       * entrega outra moeda — e é exclusivo do Business, então a checagem aqui
       * é de PLANO, não só de assinatura ativa: sem ela, um Essencial compraria
       * horas de um recurso que a conta dele não abre, e a devolução desse
       * dinheiro é trabalho manual nosso.
       */
      const pack = findLiveHourPack(item.livePackId);
      if (!pack) {
        throw new NotFoundException(`Pacote ${item.livePackId} não existe`);
      }
      await this.billing.assertFeature(userId, 'live_copilot');
      const minutos = livePackMinutes(pack);
      session = await stripe.checkout.sessions.create({
        ...common,
        mode: 'payment',
        metadata: { userId, kind: 'live_pack', itemId: pack.id },
        line_items: [
          this.envPrice(pack.id)
            ? { price: this.envPrice(pack.id), quantity: 1 }
            : {
                quantity: 1,
                price_data: {
                  currency: 'brl',
                  unit_amount: Math.round(pack.priceBrl * 100),
                  product_data: {
                    name: `PikPok — ${pack.name}`,
                    description: `${minutos} minutos de copiloto respondendo o chat da sua live`,
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
      const cycle: BillingCycle = item.cycle === 'year' ? 'year' : 'month';
      if (cycle === 'year' && !plan.annual) {
        throw new BadRequestException(
          `O plano ${plan.name} não tem opção anual.`,
        );
      }
      const credits = planCredits(plan, cycle);
      // `cycle` vai no metadata porque a renovação (invoice.paid) só tem isso
      // para saber quantos créditos liberar.
      const meta = { userId, kind: 'plan', itemId: plan.id, cycle };
      const priceId = this.priceIdFor(plan.id, cycle);
      if (!priceId) {
        this.logger.warn(
          `Sem price id para ${plan.id}/${cycle} — usando price_data inline. ` +
            `Cadastre STRIPE_PRICE_${plan.id.toUpperCase()}_${cycle.toUpperCase()}.`,
        );
      }
      session = await stripe.checkout.sessions.create({
        ...common,
        mode: 'subscription',
        metadata: meta,
        subscription_data: { metadata: meta },
        line_items: [
          priceId
            ? { price: priceId, quantity: 1 }
            : {
                quantity: 1,
                price_data: {
                  currency: 'brl',
                  unit_amount: Math.round(planPrice(plan, cycle) * 100),
                  recurring: { interval: cycle },
                  product_data: {
                    name: `PikPok ${plan.name}`,
                    description: `${credits} créditos de IA por ${cycle === 'year' ? 'ano' : 'mês'}`,
                  },
                },
              },
        ],
      });
    } else {
      throw new BadRequestException('Informe packId, livePackId ou planId.');
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
    await this.rememberCustomer(session);
    await this.grantForSession(
      session.metadata.userId,
      session.metadata.kind,
      session.metadata.itemId,
      session.id,
      session.metadata.cycle === 'year' ? 'year' : 'month',
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
        await this.rememberCustomer(session);
        await this.grantForSession(
          session.metadata.userId,
          session.metadata.kind,
          session.metadata.itemId,
          session.id,
          session.metadata.cycle === 'year' ? 'year' : 'month',
        );
      }
    } else if (event.type === 'customer.subscription.deleted') {
      // Fim real do acesso: o Stripe só dispara este evento quando o período
      // pago termina (cancelamento manual, dunning esgotado ou assinatura
      // encerrada no Dashboard). Sem tratá-lo, quem cancelava continuava no
      // plano pago para sempre — o vazamento de receita que o paywall criaria.
      const sub = event.data.object as Stripe.Subscription;
      await this.downgradeFromSubscription(sub, `subscription.deleted`);
    } else if (event.type === 'invoice.payment_failed') {
      // Aqui NÃO rebaixamos: o Stripe ainda vai reter o cartão algumas vezes
      // (dunning) e, se desistir, manda o `subscription.deleted` tratado acima.
      // Cortar no primeiro erro derrubaria cliente bom por falha transitória.
      const invoice = event.data.object as Stripe.Invoice;
      this.logger.warn(
        `Pagamento recusado para customer ${String(invoice.customer)} ` +
          `(fatura ${invoice.id}). Aguardando o dunning do Stripe — o acesso ` +
          `só cai se a assinatura for cancelada.`,
      );
    } else if (event.type === 'invoice.paid') {
      // Renovação da assinatura (mensal ou anual) → novo lote de créditos.
      const invoice = event.data.object as Stripe.Invoice;
      const meta = (invoice as any).subscription_details?.metadata ?? {};
      if (
        meta.userId &&
        meta.kind === 'plan' &&
        invoice.billing_reason === 'subscription_cycle'
      ) {
        await this.grantForSession(
          meta.userId,
          'plan',
          meta.itemId,
          invoice.id!,
          meta.cycle === 'year' ? 'year' : 'month',
        );
      }
    }
    return { received: true };
  }

  /**
   * Receita de verdade: soma o que o Stripe efetivamente cobrou dos clientes
   * informados, já descontando reembolsos.
   *
   * Não se calcula receita a partir do plano gravado no banco — plano é
   * permissão, não pagamento. Conta de cortesia, ajuste manual de suporte e
   * assinatura cancelada que ainda não expirou apareceriam como dinheiro que
   * nunca entrou.
   *
   * A busca é por cliente, e não pelas cobranças da conta inteira, porque este
   * Stripe é compartilhado com outros produtos: somar tudo traria receita
   * alheia para dentro do painel do PikPok.
   */
  async receitaPorClientes(
    customerIds: string[],
    desde?: Date,
  ): Promise<{ totalBrl: number; cobrancas: number }> {
    const stripe = this.require();
    let centavos = 0;
    let cobrancas = 0;
    for (const customer of customerIds) {
      let startingAfter: string | undefined;
      // Pagina até acabar; o teto evita laço infinito se a API se comportar
      // de forma inesperada.
      for (let pagina = 0; pagina < 10; pagina++) {
        const lote = await stripe.charges.list({
          customer,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
          ...(desde
            ? { created: { gte: Math.floor(desde.getTime() / 1000) } }
            : {}),
        });
        for (const c of lote.data) {
          if (c.status !== 'succeeded' || !c.paid) continue;
          centavos += c.amount - (c.amount_refunded ?? 0);
          cobrancas += 1;
        }
        if (!lote.has_more || lote.data.length === 0) break;
        startingAfter = lote.data[lote.data.length - 1].id;
      }
    }
    return { totalBrl: Number((centavos / 100).toFixed(2)), cobrancas };
  }

  /** Assinaturas que o Stripe considera vivas agora (cobrando de fato). */
  async assinaturasAtivas(customerIds: string[]): Promise<number> {
    const stripe = this.require();
    let ativas = 0;
    for (const customer of customerIds) {
      const subs = await stripe.subscriptions.list({
        customer,
        status: 'active',
        limit: 10,
      });
      ativas += subs.data.length;
    }
    return ativas;
  }

  /**
   * Grava o customer do Stripe na conta assim que o primeiro pagamento fecha.
   * É o que liga os dois lados: sem isso não há Billing Portal para o cliente,
   * nem como identificar o dono de um webhook de cancelamento.
   */
  private async rememberCustomer(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const userId = session.metadata?.userId;
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;
    if (!userId || !customerId) return;
    await this.billing.linkStripeCustomer(userId, customerId);
  }

  /**
   * Abre o Billing Portal do Stripe: é lá que o cliente cancela, troca o cartão
   * e baixa as faturas. Sem isso, todo cancelamento vira ticket de suporte — e
   * cliente que não consegue cancelar abre chargeback, que custa muito mais.
   */
  async createPortalSession(userId: string): Promise<{ url: string }> {
    const stripe = this.require();
    const user = await this.billing.findUser(userId);
    if (!user?.stripeCustomerId) {
      throw new BadRequestException(
        'Esta conta ainda não tem assinatura no Stripe.',
      );
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${this.appUrl}/perfil`,
    });
    return { url: session.url };
  }

  /**
   * Descobre de quem é a assinatura e rebaixa a conta.
   *
   * O metadata (gravado em `subscription_data` no checkout) é a via principal;
   * o `stripeCustomerId` é a rede de segurança para assinaturas criadas fora do
   * nosso checkout — pelo Dashboard, por exemplo — que não têm metadata algum.
   */
  private async downgradeFromSubscription(
    sub: Stripe.Subscription,
    reason: string,
  ): Promise<void> {
    const userId = sub.metadata?.userId;
    if (userId) {
      await this.billing.endSubscription(userId, reason);
      return;
    }
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    const user = customerId
      ? await this.billing.findByStripeCustomer(customerId)
      : null;
    if (!user) {
      this.logger.error(
        `Assinatura ${sub.id} encerrada, mas não achei o usuário ` +
          `(customer ${String(customerId)}). Rebaixe a conta à mão.`,
      );
      return;
    }
    await this.billing.endSubscription(user.id, reason);
  }

  /** Credita o item pago — idempotente pelo reference (session/invoice id). */
  private async grantForSession(
    userId: string,
    kind: string | undefined,
    itemId: string | undefined,
    stripeRef: string,
    cycle: BillingCycle = 'month',
  ) {
    // Add-on de horas não grava em `credit_transactions`, então esta barreira
    // não o alcança — a idempotência dele mora no extrato de minutos, que tem
    // a mesma referência sob índice único (ver `grantLiveMinutes`).
    if (kind !== 'live_pack') {
      const already = await this.transactions.findOneBy({
        userId,
        reference: stripeRef,
      });
      if (already) return;
    }

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
    } else if (kind === 'live_pack') {
      const pack = itemId ? findLiveHourPack(itemId) : undefined;
      if (!pack) return;
      // Horas vão para a carteira de live, não para os créditos de IA — e a
      // idempotência é a do próprio extrato de minutos, que tem a referência
      // do Stripe com índice único.
      await this.billing.grantLiveMinutes(
        userId,
        livePackMinutes(pack),
        stripeRef,
        `${pack.name} — pago via Stripe`,
      );
      this.logger.log(
        `Pacote de live ${itemId} creditado para ${userId} (${stripeRef})`,
      );
    } else if (kind === 'plan') {
      // `findPlan` (e não `PLANS`) porque a renovação mensal também chega para
      // quem assinou um plano que já saiu do catálogo.
      const plan = itemId ? findPlan(itemId) : undefined;
      if (!plan) return;
      await this.billing.setPlan(userId, plan.id);
      await this.billing.grantPaid(
        userId,
        planCredits(plan, cycle),
        'plan_grant',
        stripeRef,
        `Plano ${plan.name} ${cycle === 'year' ? 'anual' : 'mensal'} — pago via Stripe`,
      );

      /*
       * As horas de live inclusas no plano, na carteira que é delas.
       *
       * Mesma `stripeRef` dos créditos, e isso é de propósito: a idempotência
       * de cada moeda mora no extrato dela, com índice único sobre a
       * referência (ver `grantLiveMinutes`). Um webhook reentregue pelo Stripe
       * — que acontece — credita zero vezes a mais nos dois lados.
       */
      const minutos = planLiveMinutes(plan, cycle);
      if (minutos > 0) {
        await this.billing.grantLiveMinutes(
          userId,
          minutos,
          stripeRef,
          `Horas de live do plano ${plan.name} ${cycle === 'year' ? 'anual' : 'mensal'}`,
        );
      }
      this.logger.log(`Plano ${itemId} ativado para ${userId} (${stripeRef})`);
    }
  }
}
