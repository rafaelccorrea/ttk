import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import {
  ACTION_MIN_PLAN,
  ACTION_PRICES,
  assertProfitability,
  BillableAction,
  BillingCycle,
  CREDIT_PACKS,
  devCheckoutEnabled,
  FEATURE_MIN_PLAN,
  featureLancada,
  isCompAccount,
  LIVE_HOUR_PACKS,
  LIVE_TRIAL_MINUTES,
  PLAN_RANK,
  planAllows,
  planCredits,
  PlanFeature,
  PLANS,
  SIGNUP_BONUS_CREDITS,
} from './billing.config';
import { CreditTransaction, TransactionKind } from './entities/credit-transaction.entity';
import { LiveMinuteTransaction } from './entities/live-minute-transaction.entity';

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
    @InjectRepository(CreditTransaction)
    private readonly transactions: Repository<CreditTransaction>,
    @InjectRepository(LiveMinuteTransaction)
    private readonly liveTransactions: Repository<LiveMinuteTransaction>,
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
    /*
     * É este mapa que o front usa para montar o menu e bloquear tela, então a
     * trava de lançamento precisa entrar AQUI também — não basta o guard negar
     * a chamada. Sem isso o item continuaria no menu e o cliente clicaria num
     * recurso que responde 404, que é pior do que não existir.
     *
     * O gate do front é só UX: quem manda é o `assertFeature` do backend.
     */
    const features = Object.fromEntries(
      (Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]).map((f) => [
        f,
        planAllows(user.plan, f) &&
          (featureLancada(f) || isCompAccount(user.email)),
      ]),
    );
    return {
      credits: user.credits,
      plan: user.plan,
      /*
       * Conta da equipe: nada é debitado dela (ver `charge`). A interface
       * precisa saber disso porque, sem o aviso, o cabeçalho mostraria um saldo
       * parado para sempre — e um número que nunca muda lê como bug, não como
       * cortesia. Só diz QUE é ilimitada; o motivo não interessa ao navegador.
       */
      unlimited: isCompAccount(user.email),
      prices: ACTION_PRICES,
      features,
      featureMinPlan: FEATURE_MIN_PLAN,
      /*
       * A carteira de live vai junto da de créditos, mas separada dentro dela —
       * é a mesma tela e são saldos que não se convertem um no outro.
       * `trialAvailable` responde a pergunta que a interface faz antes de
       * oferecer o teste: esta conta ainda tem os dez minutos de cortesia?
       */
      liveCopilot: {
        minutes: user.liveMinutes ?? 0,
        trialMinutes: LIVE_TRIAL_MINUTES,
        trialAvailable: !user.liveTrialGrantedAt,
        // Só o catálogo de venda. O custo por hora fica no servidor: é a nossa
        // margem, e ela não tem por que viajar até o navegador do cliente.
        packs: LIVE_HOUR_PACKS,
      },
      history,
    };
  }

  /** Bloqueia o recurso se o plano do usuário não alcança o mínimo (403). */
  async assertFeature(userId: string, feature: PlanFeature): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    const plan = user?.plan ?? 'free';
    /*
     * A trava de lançamento vem ANTES da de plano, e a ordem importa: o
     * contrário mandaria quem paga pouco fazer upgrade para chegar a um recurso
     * que nem quem paga muito consegue usar ainda. A equipe atravessa, para
     * poder testar em produção antes de abrir.
     */
    if (!featureLancada(feature) && !isCompAccount(user?.email)) {
      throw new HttpException(
        'Este recurso ainda está em construção e será liberado em breve.',
        404,
      );
    }
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
   * Confere plano e saldo SEM debitar — a trava de entrada.
   *
   * Existe para o caso em que a cobrança acontece longe da porta: o upload da
   * live é aceito na rota e só é debitado lá dentro, depois do ffmpeg. Sem esta
   * checagem, quem está com o saldo zerado sobe gigabytes, espera a extração do
   * áudio e recebe o "créditos insuficientes" no fim — tendo gastado a banda
   * dele e o nosso CPU para chegar a uma resposta que já era conhecida no
   * primeiro byte.
   *
   * Ela NÃO substitui o débito atômico de `charge`: entre a conferida e a
   * cobrança o saldo pode mudar (outra aba, outro dispositivo). Quem garante
   * que ninguém fica negativo continua sendo o UPDATE condicional — isto aqui é
   * cortesia com quem já sabemos que não vai passar, não controle de corrida.
   *
   * Recebe a LISTA de ações porque a pergunta certa quase nunca é sobre uma
   * delas isolada: a live cobra transcrição e extração em momentos diferentes
   * do mesmo pipeline, e conferir uma de cada vez aprova quem tem saldo para
   * cada metade e para nenhum inteiro — que é justamente o pedido que quebra no
   * meio, depois de já ter debitado a primeira parte.
   */
  async assertSaldo(
    userId: string,
    itens: Array<{ action: BillableAction; quantidade?: number }>,
  ): Promise<void> {
    await this.ensureSignupBonus(userId);
    const owner = await this.users.findOneBy({ id: userId });

    /*
     * A conta da equipe passa direto. Sem isto, a trava barraria na PORTA quem
     * o `charge` deixaria passar lá dentro — e o sintoma seria o pior tipo de
     * bug: "o upload nem começa, mas quando eu contornava a tela funcionava".
     */
    if (isCompAccount(owner?.email)) return;

    for (const { action } of itens) {
      const minPlan = ACTION_MIN_PLAN[action];
      if ((PLAN_RANK[owner?.plan ?? 'free'] ?? 0) < (PLAN_RANK[minPlan] ?? 0)) {
        throw new HttpException(
          `"${ACTION_PRICES[action].label}" está disponível a partir do plano ${minPlan.charAt(0).toUpperCase() + minPlan.slice(1)}. Faça upgrade em Planos & Créditos.`,
          403,
        );
      }
    }

    const total = itens.reduce(
      (soma, { action, quantidade }) =>
        soma +
        ACTION_PRICES[action].credits * Math.max(Math.trunc(quantidade ?? 1), 1),
      0,
    );
    const saldo = owner?.credits ?? 0;
    if (saldo < total) {
      throw new HttpException(
        `Créditos insuficientes: este envio custa ${total} créditos e você tem ${saldo}. Compre um pacote ou assine um plano em Planos & Créditos.`,
        402,
      );
    }
  }

  /**
   * Debita créditos de forma atômica: o UPDATE só afeta a linha se o saldo
   * for suficiente, então duas requisições simultâneas nunca deixam o saldo
   * negativo (e nós nunca pagamos IA sem crédito cobrado).
   *
   * `manager` faz o débito participar de uma transação de FORA.
   *
   * Quem precisa disso é o pipeline da live: ele cobra e, logo depois, grava na
   * sessão o marcador que torna o estorno possível. Em duas transações
   * separadas existe uma janela — estreita, mas real — em que o processo pode
   * morrer com o crédito já debitado e nenhum marcador escrito. O estorno,
   * tanto o do `catch` quanto o do cron, procura pelo marcador: sem ele, o
   * crédito some sem rastro e sem ninguém para devolvê-lo, e é o cliente que
   * paga a conta de um restart nosso. Com o manager, débito e marcador entram e
   * saem juntos.
   *
   * Sem o argumento, tudo segue como antes — cada operação na sua transação
   * implícita.
   */
  async charge(
    userId: string,
    action: BillableAction,
    quantidade = 1,
    manager?: EntityManager,
  ): Promise<void> {
    const usuarios = manager ? manager.getRepository(AppUser) : this.users;
    const lancamentos = manager
      ? manager.getRepository(CreditTransaction)
      : this.transactions;

    await this.ensureSignupBonus(userId);
    // Plano mínimo da ação (ex.: vídeo IA só no Pro+).
    const owner = await usuarios.findOneBy({ id: userId });

    /*
     * A conta da equipe não paga — mas o uso fica registrado.
     *
     * O custo real do que ela consome já é medido em `ai_cost_events`, com os
     * tokens de verdade; o crédito é preço de venda, e cobrar preço de venda de
     * nós mesmos não mede nada. O que isso evitava era só uma coisa: a conta que
     * demonstra o produto travar por falta de saldo no meio de uma demonstração.
     *
     * O lançamento de valor zero mantém o extrato honesto — dá para ver o que
     * foi usado e quando, sem o saldo se mexer.
     */
    if (isCompAccount(owner?.email)) {
      await lancamentos.save(
        lancamentos.create({
          userId,
          amount: 0,
          balanceAfter: owner?.credits ?? 0,
          kind: 'spend',
          action,
          description: `${ACTION_PRICES[action].label} (uso interno)`,
        }),
      );
      return;
    }
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
    const result = await usuarios
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

    const user = await usuarios.findOneBy({ id: userId });
    await lancamentos.save(
      lancamentos.create({
        userId,
        amount: -total,
        balanceAfter: user?.credits ?? 0,
        kind: 'spend',
        action,
        description: itens > 1 ? `${price.label} × ${itens}` : price.label,
      }),
    );
  }

  /* ---------------------------------------------------------------- *
   *  Minutos de live — a carteira do copiloto ao vivo                  *
   * ---------------------------------------------------------------- */

  /**
   * Concede a cortesia de estreia, se esta conta ainda não recebeu.
   *
   * O UPDATE condicional é a trava: dois pedidos simultâneos — o vendedor
   * abrindo o copiloto em duas abas — leriam os dois `liveTrialGrantedAt` nulo
   * e creditariam dez minutos cada. Quem afeta a linha é quem concede.
   *
   * Chamável à vontade: quem já ganhou não ganha de novo.
   */
  async grantLiveTrial(userId: string): Promise<number> {
    const concedeu = await this.users
      .createQueryBuilder()
      .update(AppUser)
      .set({
        liveMinutes: () => `"liveMinutes" + ${LIVE_TRIAL_MINUTES}`,
        liveTrialGrantedAt: () => 'now()',
      })
      .where('id = :userId AND "liveTrialGrantedAt" IS NULL', { userId })
      .execute();

    if (!concedeu.affected) return 0;

    const dono = await this.users.findOneBy({ id: userId });
    await this.liveTransactions.save(
      this.liveTransactions.create({
        userId,
        minutes: LIVE_TRIAL_MINUTES,
        balanceAfter: dono?.liveMinutes ?? LIVE_TRIAL_MINUTES,
        kind: 'trial',
        reference: `trial:${userId}`,
        description: `${LIVE_TRIAL_MINUTES} minutos de cortesia para conhecer o copiloto`,
      }),
    );
    this.logger.log(`Live Copilot: cortesia concedida para ${userId}.`);
    return LIVE_TRIAL_MINUTES;
  }

  /**
   * Consome minutos de transmissão do saldo.
   *
   * Mesmo UPDATE condicional do débito de créditos, e pelo mesmo motivo: o
   * copiloto debita enquanto a live corre, e sem a condição de saldo duas
   * cobranças concorrentes deixariam o cliente devendo tempo que não comprou.
   *
   * Lança 402 quando não há saldo — quem chama transforma isso no evento que
   * desliga o envio e mostra o CTA de compra, em vez de seguir gastando IA de
   * graça.
   */
  async chargeLiveMinutes(userId: string, minutos = 1): Promise<number> {
    const total = Math.max(Math.trunc(minutos), 1);
    const owner = await this.users.findOneBy({ id: userId });
    const minPlan = FEATURE_MIN_PLAN.live_copilot;
    if ((PLAN_RANK[owner?.plan ?? 'free'] ?? 0) < (PLAN_RANK[minPlan] ?? 0)) {
      throw new HttpException(
        `O Live Copilot é exclusivo do plano ${minPlan.charAt(0).toUpperCase() + minPlan.slice(1)}. Faça upgrade em Planos & Créditos.`,
        403,
      );
    }

    // Conta da equipe: o minuto é registrado e não é descontado. Mesmo motivo
    // do débito de créditos — uma live de demonstração não pode acabar porque o
    // saldo interno zerou.
    if (isCompAccount(owner?.email)) {
      const saldoAtual = owner?.liveMinutes ?? 0;
      await this.liveTransactions.save(
        this.liveTransactions.create({
          userId,
          minutes: 0,
          balanceAfter: saldoAtual,
          kind: 'spend',
          description: `Copiloto ao vivo — ${total} ${total === 1 ? 'minuto' : 'minutos'} (uso interno)`,
        }),
      );
      return saldoAtual;
    }

    const result = await this.users
      .createQueryBuilder()
      .update(AppUser)
      .set({ liveMinutes: () => `"liveMinutes" - ${total}` })
      .where('id = :userId AND "liveMinutes" >= :custo', {
        userId,
        custo: total,
      })
      .execute();

    if (!result.affected) {
      throw new HttpException(
        `Suas horas de live acabaram. Compre um pacote de horas para o copiloto continuar respondendo.`,
        402,
      );
    }

    const user = await this.users.findOneBy({ id: userId });
    const saldo = user?.liveMinutes ?? 0;
    await this.liveTransactions.save(
      this.liveTransactions.create({
        userId,
        minutes: -total,
        balanceAfter: saldo,
        kind: 'spend',
        description: `Copiloto ao vivo — ${total} ${total === 1 ? 'minuto' : 'minutos'}`,
      }),
    );
    return saldo;
  }

  /** Devolve minutos de uma transmissão que o copiloto não chegou a atender. */
  async refundLiveMinutes(
    userId: string,
    minutos: number,
    motivo?: string,
  ): Promise<void> {
    const total = Math.max(Math.trunc(minutos), 1);
    await this.users.increment({ id: userId }, 'liveMinutes', total);
    const user = await this.users.findOneBy({ id: userId });
    await this.liveTransactions.save(
      this.liveTransactions.create({
        userId,
        minutes: total,
        balanceAfter: user?.liveMinutes ?? total,
        kind: 'refund',
        description: motivo ?? 'Estorno de minutos de live',
      }),
    );
  }

  /**
   * Credita as horas de um add-on pago.
   *
   * A `reference` do Stripe é a chave de idempotência: o webhook reenvia, e sem
   * isso o mesmo pagamento entregaria horas duas vezes. A checagem aqui é a
   * primeira barreira; o índice único na coluna é a que vale sob concorrência.
   */
  async grantLiveMinutes(
    userId: string,
    minutos: number,
    reference: string,
    description: string,
  ): Promise<void> {
    const already = await this.liveTransactions.findOneBy({ reference });
    if (already) return;

    await this.users.increment({ id: userId }, 'liveMinutes', minutos);
    const user = await this.users.findOneBy({ id: userId });
    await this.liveTransactions.save(
      this.liveTransactions.create({
        userId,
        minutes: minutos,
        balanceAfter: user?.liveMinutes ?? minutos,
        kind: 'purchase',
        reference,
        description,
      }),
    );
    this.logger.log(
      `Live Copilot: ${minutos} minutos creditados para ${userId} (${reference}).`,
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
    quantidade = 1,
  ): Promise<T> {
    await this.charge(userId, action, quantidade);
    try {
      return await fn();
    } catch (error) {
      await this.refund(userId, action, undefined, quantidade).catch((e) =>
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
    if (!devCheckoutEnabled()) {
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
    if (!devCheckoutEnabled()) {
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
