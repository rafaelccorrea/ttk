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
  ACTION_MIN_PLAN,
  ACTION_PRICES,
  assertProfitability,
  BillableAction,
  BillingCycle,
  CREDIT_PACKS,
  FEATURE_MIN_PLAN,
  PLAN_RANK,
  planAllows,
  planCredits,
  PlanFeature,
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
    // Mapa recurso→liberado para o plano do usuário (o front usa para bloquear telas).
    const features = Object.fromEntries(
      (Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]).map((f) => [
        f,
        planAllows(user.plan, f),
      ]),
    );
    return {
      credits: user.credits,
      plan: user.plan,
      prices: ACTION_PRICES,
      features,
      featureMinPlan: FEATURE_MIN_PLAN,
      history,
    };
  }

  /** Bloqueia o recurso se o plano do usuário não alcança o mínimo (403). */
  async assertFeature(userId: string, feature: PlanFeature): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    const plan = user?.plan ?? 'free';
    if (!planAllows(plan, feature)) {
      const min = FEATURE_MIN_PLAN[feature];
      throw new HttpException(
        `Este recurso está disponível a partir do plano ${min.charAt(0).toUpperCase() + min.slice(1)}. Faça upgrade em Planos & Créditos.`,
        403,
      );
    }
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
    // Plano mínimo da ação (ex.: vídeo IA só no Pro+).
    const owner = await this.users.findOneBy({ id: userId });
    const minPlan = ACTION_MIN_PLAN[action];
    if ((PLAN_RANK[owner?.plan ?? 'free'] ?? 0) < (PLAN_RANK[minPlan] ?? 0)) {
      throw new HttpException(
        `"${ACTION_PRICES[action].label}" está disponível a partir do plano ${minPlan.charAt(0).toUpperCase() + minPlan.slice(1)}. Faça upgrade em Planos & Créditos.`,
        403,
      );
    }
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
    await this.assertSubscriber(userId);
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
  async subscribe(userId: string, planId: string, cycle: BillingCycle = 'month') {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new NotFoundException(`Plano ${planId} não existe`);
    if (plan.id === 'free') {
      throw new BadRequestException('O plano Free é o padrão.');
    }
    if (cycle === 'year' && !plan.annual) {
      throw new BadRequestException(`O plano ${plan.name} não tem opção anual.`);
    }
    if (process.env.ALLOW_DEV_CHECKOUT !== 'true') {
      throw new BadRequestException(
        'Pagamentos ainda não estão habilitados. Fale com o suporte.',
      );
    }
    await this.users.update({ id: userId }, { plan: plan.id });
    await this.addCredits(
      userId,
      planCredits(plan, cycle),
      'plan_grant',
      plan.id,
      `Créditos ${cycle === 'year' ? 'anuais' : 'mensais'} do plano ${plan.name}`,
    );
    return this.getWallet(userId);
  }

  /** Pacote avulso é exclusivo de assinantes (Free precisa assinar primeiro). */
  async assertSubscriber(userId: string): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    if ((PLAN_RANK[user?.plan ?? 'free'] ?? 0) < PLAN_RANK.starter) {
      throw new HttpException(
        'Pacotes avulsos são exclusivos para assinantes. Assine um plano para desbloquear.',
        403,
      );
    }
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
