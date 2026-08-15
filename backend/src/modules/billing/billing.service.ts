import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import {
  ACTION_PRICES,
  assertProfitability,
  BillableAction,
  CREDIT_PACKS,
  PLANS,
  SIGNUP_BONUS_CREDITS,
} from './billing.config';
import { CreditTransaction, TransactionKind } from './entities/credit-transaction.entity';

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
    @InjectRepository(CreditTransaction)
    private readonly transactions: Repository<CreditTransaction>,
  ) {}

  // Servidor não sobe com tabela de preços que dá prejuízo.
  onModuleInit() {
    const problems = assertProfitability();
    if (problems.length) {
      throw new Error(
        `Tabela de preços com prejuízo:\n${problems.join('\n')}`,
      );
    }
    this.logger.log('Tabela de preços validada: todas as margens ≥ mínimo.');
  }

  async getWallet(userId: string) {
    await this.ensureSignupBonus(userId);
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const history = await this.transactions.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 30,
    });
    return {
      credits: user.credits,
      plan: user.plan,
      prices: ACTION_PRICES,
      history,
    };
  }

  listPlans() {
    return PLANS;
  }

  listPacks() {
    return CREDIT_PACKS;
  }

  /** Bônus de cadastro — uma vez por usuário. */
  private async ensureSignupBonus(userId: string) {
    const existing = await this.transactions.findOneBy({
      userId,
      kind: 'signup_bonus',
    });
    if (existing) return;
    await this.addCredits(
      userId,
      SIGNUP_BONUS_CREDITS,
      'signup_bonus',
      undefined,
      'Créditos de boas-vindas',
    );
  }

  /**
   * Debita créditos de forma atômica: o UPDATE só afeta a linha se o saldo
   * for suficiente, então duas requisições simultâneas nunca deixam o saldo
   * negativo (e nós nunca pagamos IA sem crédito cobrado).
   */
  async charge(userId: string, action: BillableAction): Promise<void> {
    await this.ensureSignupBonus(userId);
    const price = ACTION_PRICES[action];
    const result = await this.users
      .createQueryBuilder()
      .update(AppUser)
      .set({ credits: () => `credits - ${price.credits}` })
      .where('id = :userId AND credits >= :cost', {
        userId,
        cost: price.credits,
      })
      .execute();

    if (!result.affected) {
      throw new HttpException(
        `Créditos insuficientes: "${price.label}" custa ${price.credits} créditos. Compre um pacote ou assine um plano em Planos & Créditos.`,
        402,
      );
    }

    const user = await this.users.findOneBy({ id: userId });
    await this.transactions.save(
      this.transactions.create({
        userId,
        amount: -price.credits,
        balanceAfter: user?.credits ?? 0,
        kind: 'spend',
        action,
        description: price.label,
      }),
    );
  }

  /** Estorna uma ação que falhou (a IA não entregou → usuário não paga). */
  async refund(userId: string, action: BillableAction, reason?: string) {
    const price = ACTION_PRICES[action];
    await this.addCredits(
      userId,
      price.credits,
      'refund',
      action,
      reason ?? `Estorno: ${price.label} falhou`,
    );
  }

  /**
   * Executa fn cobrando antes e estornando se der erro — o padrão para
   * qualquer endpoint de IA.
   */
  async withCharge<T>(
    userId: string,
    action: BillableAction,
    fn: () => Promise<T>,
  ): Promise<T> {
    await this.charge(userId, action);
    try {
      return await fn();
    } catch (error) {
      await this.refund(userId, action).catch((e) =>
        this.logger.error(`Falha no estorno de ${action}: ${e}`),
      );
      throw error;
    }
  }

  /**
   * Compra de pacote. Sem gateway configurado, só funciona em modo dev
   * (ALLOW_DEV_CHECKOUT=true) — em produção, o webhook do gateway (Stripe /
   * Mercado Pago) é quem chama grantPack após pagamento confirmado.
   */
  async purchasePack(userId: string, packId: string) {
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) throw new NotFoundException(`Pacote ${packId} não existe`);
    if (process.env.ALLOW_DEV_CHECKOUT !== 'true') {
      throw new BadRequestException(
        'Pagamentos ainda não estão habilitados. Fale com o suporte.',
      );
    }
    await this.addCredits(
      userId,
      pack.credits,
      'purchase',
      pack.id,
      `${pack.name} — R$ ${pack.priceBrl.toFixed(2)} (checkout dev)`,
    );
    return this.getWallet(userId);
  }

  /** Assinatura de plano (mesma regra: dev-only até o gateway entrar). */
  async subscribe(userId: string, planId: string) {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new NotFoundException(`Plano ${planId} não existe`);
    if (plan.id === 'free') {
      throw new BadRequestException('O plano Free é o padrão.');
    }
    if (process.env.ALLOW_DEV_CHECKOUT !== 'true') {
      throw new BadRequestException(
        'Pagamentos ainda não estão habilitados. Fale com o suporte.',
      );
    }
    await this.users.update({ id: userId }, { plan: plan.id });
    await this.addCredits(
      userId,
      plan.monthlyCredits,
      'plan_grant',
      plan.id,
      `Créditos mensais do plano ${plan.name}`,
    );
    return this.getWallet(userId);
  }

  /** Crédito confirmado por pagamento (Stripe) — reference = session/invoice id. */
  async grantPaid(
    userId: string,
    amount: number,
    kind: TransactionKind,
    reference: string,
    description: string,
  ) {
    await this.addCredits(userId, amount, kind, reference, description);
  }

  async setPlan(userId: string, planId: string) {
    await this.users.update({ id: userId }, { plan: planId });
  }

  private async addCredits(
    userId: string,
    amount: number,
    kind: TransactionKind,
    reference?: string,
    description?: string,
  ) {
    await this.users
      .createQueryBuilder()
      .update(AppUser)
      .set({ credits: () => `credits + ${amount}` })
      .where('id = :userId', { userId })
      .execute();
    const user = await this.users.findOneBy({ id: userId });
    await this.transactions.save(
      this.transactions.create({
        userId,
        amount,
        balanceAfter: user?.credits ?? amount,
        kind,
        action: kind === 'refund' ? reference : undefined,
        reference: kind === 'refund' ? undefined : reference,
        description,
      }),
    );
  }
}
