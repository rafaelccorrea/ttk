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
  isCompAccount,
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

  /**
   * Bônus de cadastro — uma vez por usuário. Com o paywall na entrada o valor
   * é 0, e aí a função não faz nada: sem esta guarda, todo `getWallet` de conta
   * não paga gravaria uma transação de 0 crédito no histórico.
   */
  private async ensureSignupBonus(userId: string) {
    if (SIGNUP_BONUS_CREDITS <= 0) return;
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
  async charge(
    userId: string,
    action: BillableAction,
    quantidade = 1,
  ): Promise<void> {
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
    // Uma montagem do Multiplicador cobra os N vídeos numa tacada: são até 150
    // arquivos, e 150 débitos separados encheriam o extrato e dariam 150
    // chances de o saldo acabar no meio da fila.
    const itens = Math.max(Math.trunc(quantidade), 1);
    const total = price.credits * itens;
    const result = await this.users
      .createQueryBuilder()
      .update(AppUser)
      .set({ credits: () => `credits - ${total}` })
      .where('id = :userId AND credits >= :cost', { userId, cost: total })
      .execute();

    if (!result.affected) {
      throw new HttpException(
        `Créditos insuficientes: "${price.label}"${itens > 1 ? ` × ${itens}` : ''} custa ${total} créditos. Compre um pacote ou assine um plano em Planos & Créditos.`,
        402,
      );
    }

    const user = await this.users.findOneBy({ id: userId });
    await this.transactions.save(
      this.transactions.create({
        userId,
        amount: -total,
        balanceAfter: user?.credits ?? 0,
        kind: 'spend',
        action,
        description: itens > 1 ? `${price.label} × ${itens}` : price.label,
      }),
    );
  }

  /** Estorna uma ação que falhou (a IA não entregou → usuário não paga). */
  async refund(
    userId: string,
    action: BillableAction,
    reason?: string,
    quantidade = 1,
  ) {
    const price = ACTION_PRICES[action];
    const itens = Math.max(Math.trunc(quantidade), 1);
    await this.addCredits(
      userId,
      price.credits * itens,
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

  /** Guarda o customer do Stripe no primeiro checkout (idempotente). */
  async linkStripeCustomer(userId: string, customerId: string) {
    await this.users.update(
      { id: userId },
      { stripeCustomerId: customerId },
    );
  }

  async findByStripeCustomer(customerId: string): Promise<AppUser | null> {
    return this.users.findOneBy({ stripeCustomerId: customerId });
  }

  findUser(userId: string): Promise<AppUser | null> {
    return this.users.findOneBy({ id: userId });
  }

  /**
   * Fim da assinatura: a conta volta a 'free' (rank 0 = paywall).
   *
   * Os créditos que sobraram NÃO são apagados: foram pagos. Eles ficam parados
   * no saldo e voltam a ser úteis se a pessoa reassinar — mas não dão acesso a
   * nada sozinhos, porque toda ação cobrada também exige plano mínimo
   * (ACTION_MIN_PLAN em `charge`). Assim ninguém é punido por cancelar e
   * ninguém consome IA sem assinatura.
   *
   * Contas de cortesia são imunes: o downgrade não pode derrubar a equipe se um
   * cartão de teste falhar.
   */
  async endSubscription(userId: string, reason: string) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) return;
    if (isCompAccount(user.email)) {
      this.logger.log(
        `Downgrade ignorado para conta de cortesia ${user.email} (${reason}).`,
      );
      return;
    }
    if (user.plan === 'free') return;
    await this.users.update({ id: userId }, { plan: 'free' });
    this.logger.log(
      `Assinatura encerrada: ${user.email} saiu de "${user.plan}" para "free" (${reason}).`,
    );
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
