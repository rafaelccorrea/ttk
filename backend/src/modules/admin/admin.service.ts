import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  compAccountEmails,
  CREDIT_VALUE_BRL,
  findPlan,
  LIVE_HOUR_PACKS,
  PLANS,
} from '../billing/billing.config';
import { AiCostService } from '../telemetry/ai-cost.service';
import { BillingService } from '../billing/billing.service';
import { StripeService } from '../billing/stripe.service';
import { MailService } from '../auth/mail.service';
import { CreditTransaction } from '../billing/entities/credit-transaction.entity';
import { AppUser } from '../users/entities/app-user.entity';
import { isAdmin } from './admin.access';

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string | null;
  plan: string;
  credits: number;
  isAdmin: boolean;
  emailConfirmed: boolean;
  /** Conta com Google vinculado (cadastro ou vínculo posterior pelo login social). */
  viaGoogle: boolean;
  naFila: boolean;
  temAssinaturaStripe: boolean;
  /** Conta da equipe (COMP_ACCOUNT_EMAILS): não paga e não conta como venda. */
  cortesia: boolean;
  createdAt: Date;
  emailConfirmedAt: Date | null;
  /** Última vez que bateu na API autenticada (folga de 5 min). */
  lastSeenAt: Date | null;
  /** Créditos já consumidos em IA — o custo que a conta gerou. */
  creditosGastos: number;
  /** Último lançamento de consumo no extrato. */
  ultimoUso: Date | null;
  liveMinutes: number;
  /** O que a conta produziu — diz se o cadastro virou uso. */
  uso: {
    produtos: number;
    campanhas: number;
    videosGerados: number;
    lives: number;
  };
}

/** Contagem por usuário de uma tabela com coluna "userId". */
type ContagemPorUsuario = Record<string, number>;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
    @InjectRepository(CreditTransaction)
    private readonly transactions: Repository<CreditTransaction>,
    private readonly billing: BillingService,
    private readonly stripe: StripeService,
    private readonly custos: AiCostService,
    private readonly mail: MailService,
    /**
     * Para as contagens de atividade (campanhas, vídeos, lives...). São só
     * COUNTs agrupados por "userId" em tabelas de outros módulos; importar cada
     * entidade aqui só para contar amarraria o admin a todos eles.
     */
    private readonly dataSource: DataSource,
  ) {}

  /** COUNT(*) por usuário numa tabela, restrito a um conjunto de ids. */
  private async contarPorUsuario(
    tabela: string,
    ids: string[],
    extra = '',
  ): Promise<ContagemPorUsuario> {
    if (!ids.length) return {};
    const linhas = await this.dataSource.query<{ userId: string; total: string }[]>(
      `SELECT "userId", COUNT(*)::int AS total FROM "${tabela}"
       WHERE "userId" = ANY($1) ${extra} GROUP BY "userId"`,
      [ids],
    );
    return Object.fromEntries(linhas.map((l) => [l.userId, Number(l.total)]));
  }

  /**
   * A margem que aconteceu, contra a que a tabela de preços promete.
   *
   * O `billing.config` afirma um custo de pior caso por ação, calculado à mão —
   * e conta à mão envelhece calada: o fornecedor reajusta, o prompt engorda, o
   * cache pega menos do que se supunha. Este relatório é o contraditório, feito
   * com o `usage` que a própria API reportou.
   *
   * `alertas` é o que se olha primeiro: são as ações cujo custo MEDIDO já
   * passou do ESTIMADO. Cada linha ali é uma margem sendo corroída em silêncio,
   * e o preço correspondente precisa ser refeito.
   *
   * O minuto de live é convertido a preço pelo add-on mais barato, de propósito:
   * é o pior cenário de receita por minuto, e margem se apura pelo pior caso.
   */
  async margemRealizada(dias: number) {
    const ate = new Date();
    const desde = new Date(ate.getTime() - dias * 24 * 60 * 60 * 1000);
    const menorPacote = [...LIVE_HOUR_PACKS].sort(
      (a, b) => a.priceBrl / a.hours - b.priceBrl / b.hours,
    )[0];
    const precoDoMinuto = menorPacote
      ? menorPacote.priceBrl / (menorPacote.hours * 60)
      : 0;

    const [porRecurso, alertas] = await Promise.all([
      this.custos.margemPorRecurso(desde, ate, precoDoMinuto),
      this.custos.acoesAcimaDoEstimado(desde),
    ]);

    const custoBrl = porRecurso.reduce((s, l) => s + l.custoBrl, 0);
    const receitaBrl = porRecurso.reduce((s, l) => s + l.receitaBrl, 0);

    return {
      periodo: { desde, ate, dias },
      margemMinima: this.custos.margemMinima,
      total: {
        custoBrl: Number(custoBrl.toFixed(2)),
        receitaBrl: Number(receitaBrl.toFixed(2)),
        margem: custoBrl > 0 ? Number((receitaBrl / custoBrl).toFixed(2)) : null,
      },
      porRecurso,
      alertas,
    };
  }

  /**
   * Painel — só número real, nada projetado.
   *
   * Receita aqui é dinheiro que o Stripe cobrou, líquido de reembolso. A versão
   * anterior multiplicava "quantas contas estão no plano X" pelo preço do plano,
   * e isso mentia: as contas da equipe são cortesia, o suporte pode liberar um
   * acesso à mão, e uma assinatura cancelada segue com o plano até o período
   * pago acabar. Nenhum desses casos é caixa, mas todos apareciam como receita.
   *
   * Pela mesma razão, "pagantes" não é "quem não está no free": é quem tem
   * cliente no Stripe e assinatura viva lá.
   */
  async overview() {
    const porPlano = await this.users
      .createQueryBuilder('u')
      .select('u.plan', 'plan')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect('COALESCE(SUM(u.credits),0)::int', 'creditos')
      .groupBy('u.plan')
      .getRawMany<{ plan: string; total: number; creditos: number }>();

    // Contas ligadas a um cliente do Stripe: as únicas que podem ter pago.
    const comStripe = await this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.stripeCustomerId'])
      .where('u.stripeCustomerId IS NOT NULL')
      .getMany();
    const customerIds = comStripe
      .map((u) => u.stripeCustomerId)
      .filter((v): v is string => Boolean(v));

    // Contas internas ficam fora da conversão: elas nunca vão pagar, e deixá-las
    // no denominador esconde a taxa real de quem chegou pela porta da frente.
    const cortesia = await this.users
      .createQueryBuilder('u')
      .select('COUNT(*)::int', 'total')
      .where('LOWER(u.email) IN (:...emails)', {
        emails: compAccountEmails().length ? compAccountEmails() : ['-'],
      })
      .getRawOne<{ total: number }>();

    const receita = await this.receitaReal(customerIds);

    const gasto = await this.transactions
      .createQueryBuilder('t')
      .select('COALESCE(SUM(-t.amount),0)::int', 'total')
      .where('t.kind = :kind', { kind: 'spend' })
      .getRawOne<{ total: number }>();

    const gastoUltimos30 = await this.transactions
      .createQueryBuilder('t')
      .select('COALESCE(SUM(-t.amount),0)::int', 'total')
      .where('t.kind = :kind', { kind: 'spend' })
      .andWhere("t.createdAt > now() - interval '30 days'")
      .getRawOne<{ total: number }>();

    // Quantas contas têm Google vinculado — mede a adesão ao login social.
    const viaGoogle = await this.users
      .createQueryBuilder('u')
      .select('COUNT(*)::int', 'total')
      .where('u.googleId IS NOT NULL')
      .getRawOne<{ total: number }>();

    const novos30 = await this.users
      .createQueryBuilder('u')
      .select('COUNT(*)::int', 'total')
      .where("u.createdAt > now() - interval '30 days'")
      .getRawOne<{ total: number }>();

    // Cadastro não é uso. Estes dizem quem de fato abre o app.
    const contar = async (where: string) =>
      (
        await this.users
          .createQueryBuilder('u')
          .select('COUNT(*)::int', 'total')
          .where(where)
          .getRawOne<{ total: number }>()
      )?.total ?? 0;
    const [novos7, ativos7, ativos30, nuncaConfirmou, semUso] = await Promise.all([
      contar("u.createdAt > now() - interval '7 days'"),
      contar("u.lastSeenAt > now() - interval '7 days'"),
      contar("u.lastSeenAt > now() - interval '30 days'"),
      contar('u.emailConfirmedAt IS NULL AND u.googleId IS NULL'),
      // Cadastrou há mais de 7 dias e nunca gastou um crédito.
      contar(
        `u.createdAt < now() - interval '7 days' AND NOT EXISTS (
          SELECT 1 FROM credit_transactions t WHERE t."userId" = u.id AND t.kind = 'spend'
        )`,
      ),
    ]);

    // Cadastros por dia, últimos 14 dias — o ritmo de entrada.
    const cadastrosPorDia = await this.dataSource.query<{ dia: string; total: number }[]>(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS dia,
              COALESCE((SELECT COUNT(*)::int FROM app_users u
                        WHERE u."createdAt"::date = d::date), 0) AS total
       FROM generate_series(now()::date - 13, now()::date, interval '1 day') AS d
       ORDER BY d`,
    );

    const totalContas = porPlano.reduce((s, p) => s + p.total, 0);
    const internas = cortesia?.total ?? 0;
    // Quem pode converter: tira as contas da própria equipe do denominador.
    const externas = Math.max(0, totalContas - internas);

    return {
      contas: {
        total: totalContas,
        pagantes: receita.assinaturasAtivas,
        cortesia: internas,
        // "Com plano no banco" não é o mesmo que "pagando": inclui cortesia e
        // liberações manuais. Fica separado para o número não ser confundido.
        comPlanoLiberado: porPlano
          .filter((p) => p.plan !== 'free')
          .reduce((s, p) => s + p.total, 0),
        pendentes: porPlano.find((p) => p.plan === 'free')?.total ?? 0,
        novos30Dias: novos30?.total ?? 0,
        novos7Dias: novos7,
        /** Abriram o app (API autenticada) nos últimos 7 / 30 dias. */
        ativos7Dias: ativos7,
        ativos30Dias: ativos30,
        /** Cadastro por e-mail que nunca confirmou (e sem Google). */
        naoConfirmaram: nuncaConfirmou,
        /** Mais de 7 dias de casa e nenhum crédito gasto. */
        semUso,
        viaGoogle: viaGoogle?.total ?? 0,
        conversaoPct:
          externas > 0
            ? Math.round((receita.assinaturasAtivas / externas) * 100)
            : 0,
      },
      cadastrosPorDia: cadastrosPorDia.map((c) => ({ dia: c.dia, total: Number(c.total) })),
      porPlano: PLANS.map((p) => ({
        id: p.id,
        nome: p.name,
        assinantes: porPlano.find((x) => x.plan === p.id)?.total ?? 0,
        precoBrl: p.priceBrl,
      })),
      receita: {
        totalBrl: receita.totalBrl,
        ultimos30DiasBrl: receita.ultimos30DiasBrl,
        cobrancas: receita.cobrancas,
        /** 'stripe' = número real; 'indisponivel' = não deu para consultar. */
        fonte: receita.fonte,
      },
      creditos: {
        emCirculacao: porPlano.reduce((s, p) => s + p.creditos, 0),
        gastosTotal: gasto?.total ?? 0,
        gastos30Dias: gastoUltimos30?.total ?? 0,
        // Quanto a IA consumida já custou, ao valor de face do crédito.
        custoEstimado30DiasBrl: Number(
          ((gastoUltimos30?.total ?? 0) * CREDIT_VALUE_BRL).toFixed(2),
        ),
      },
    };
  }

  /**
   * Receita apurada no Stripe. Sem cliente lá, o resultado é zero — e zero é a
   * resposta certa, não um número "estimado" para a tela não parecer vazia.
   *
   * Se a consulta ao Stripe falhar (chave ausente, fora do ar), devolve
   * `fonte: 'indisponivel'` em vez de um valor: o painel deve dizer que não
   * sabe, nunca chutar dinheiro.
   */
  private async receitaReal(customerIds: string[]) {
    const vazio = {
      totalBrl: 0,
      ultimos30DiasBrl: 0,
      cobrancas: 0,
      assinaturasAtivas: 0,
      fonte: 'stripe' as 'stripe' | 'indisponivel',
    };
    if (!customerIds.length) return vazio;
    if (!this.stripe.enabled) return { ...vazio, fonte: 'indisponivel' as const };

    try {
      const desde30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [total, ultimos30, ativas] = await Promise.all([
        this.stripe.receitaPorClientes(customerIds),
        this.stripe.receitaPorClientes(customerIds, desde30),
        this.stripe.assinaturasAtivas(customerIds),
      ]);
      return {
        totalBrl: total.totalBrl,
        ultimos30DiasBrl: ultimos30.totalBrl,
        cobrancas: total.cobrancas,
        assinaturasAtivas: ativas,
        fonte: 'stripe' as const,
      };
    } catch (err) {
      this.logger.error(
        `Não consegui apurar a receita no Stripe: ${(err as Error).message}`,
      );
      return { ...vazio, fonte: 'indisponivel' as const };
    }
  }

  /**
   * Lista de contas, com busca, filtro por plano e por SITUAÇÃO, e ordenação.
   *
   * A situação é o recorte que o suporte usa de verdade: "quem cadastrou e não
   * confirmou", "quem sumiu há 30 dias", "quem nunca gastou". Sem isso a lista
   * é uma tabela que só serve para achar um e-mail.
   */
  async listUsers(params: {
    busca?: string;
    plano?: string;
    situacao?: string;
    cadastroDias?: number;
    ordenar?: string;
    direcao?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }): Promise<{ items: AdminUserRow[]; total: number; page: number }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 25));

    const qb = this.users.createQueryBuilder('u');
    if (params.busca) {
      qb.andWhere('(u.email ILIKE :b OR u.displayName ILIKE :b)', {
        b: `%${params.busca}%`,
      });
    }
    if (params.plano) qb.andWhere('u.plan = :p', { p: params.plano });
    if (params.cadastroDias) {
      qb.andWhere("u.createdAt > now() - (:dias || ' days')::interval", {
        dias: String(params.cadastroDias),
      });
    }
    const gastosSql = `(SELECT COALESCE(SUM(-t.amount),0) FROM credit_transactions t
      WHERE t."userId" = u.id AND t.kind = 'spend')`;
    switch (params.situacao) {
      case 'confirmado':
        qb.andWhere('(u.emailConfirmedAt IS NOT NULL OR u.googleId IS NOT NULL)');
        break;
      case 'nao_confirmado':
        qb.andWhere('u.emailConfirmedAt IS NULL AND u.googleId IS NULL');
        break;
      case 'google':
        qb.andWhere('u.googleId IS NOT NULL');
        break;
      case 'stripe':
        qb.andWhere('u.stripeCustomerId IS NOT NULL');
        break;
      case 'fila':
        qb.andWhere('u.waitlistedAt IS NOT NULL AND u.waitlistReleasedAt IS NULL');
        break;
      case 'ativos_7d':
        qb.andWhere("u.lastSeenAt > now() - interval '7 days'");
        break;
      case 'inativos_30d':
        qb.andWhere("(u.lastSeenAt IS NULL OR u.lastSeenAt < now() - interval '30 days')");
        break;
      case 'nunca_usou':
        qb.andWhere(`${gastosSql} = 0`);
        break;
    }

    const total = await qb.getCount();

    const direcao = params.direcao === 'asc' ? 'ASC' : 'DESC';
    // Ordenar por gastos precisa do agregado na consulta; `addSelect` + raw
    // entrega as duas coisas (entidade e coluna calculada) numa ida só.
    qb.addSelect(gastosSql, 'gastos');
    switch (params.ordenar) {
      case 'ultimo_acesso':
        qb.orderBy('u.lastSeenAt', direcao, 'NULLS LAST');
        break;
      case 'gastos':
        qb.orderBy('gastos', direcao);
        break;
      case 'creditos':
        qb.orderBy('u.credits', direcao);
        break;
      case 'email':
        qb.orderBy('u.email', direcao);
        break;
      default:
        qb.orderBy('u.createdAt', direcao);
    }
    const { entities: rows, raw } = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawAndEntities();
    const gastosPorId = new Map<string, number>();
    for (const r of raw as { u_id: string; gastos: string | null }[]) {
      gastosPorId.set(r.u_id, Number(r.gastos ?? 0));
    }

    // Último uso e atividade vêm agrupados — nunca uma consulta por linha.
    const ids = rows.map((r) => r.id);
    const [ultimoUso, produtos, campanhas, videos, lives] = await Promise.all([
      ids.length
        ? this.transactions
            .createQueryBuilder('t')
            .select('t.userId', 'userId')
            .addSelect('MAX(t.createdAt)', 'ultimo')
            .where('t.userId IN (:...ids)', { ids })
            .andWhere('t.kind = :kind', { kind: 'spend' })
            .groupBy('t.userId')
            .getRawMany<{ userId: string; ultimo: Date }>()
        : [],
      this.contarPorUsuario('user_products', ids),
      this.contarPorUsuario('campaigns', ids),
      this.contarPorUsuario('generated_media', ids, `AND kind = 'video'`),
      this.contarPorUsuario('live_runs', ids),
    ]);
    const ultimoPorId = new Map<string, Date>(
      (ultimoUso as { userId: string; ultimo: Date }[]).map((c) => [c.userId, c.ultimo]),
    );

    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName ?? null,
        plan: u.plan,
        credits: u.credits,
        isAdmin: isAdmin(u.email),
        emailConfirmed: Boolean(u.emailConfirmedAt),
        viaGoogle: Boolean(u.googleId),
        naFila: Boolean(u.waitlistedAt) && !u.waitlistReleasedAt,
        temAssinaturaStripe: Boolean(u.stripeCustomerId),
        cortesia: compAccountEmails().includes(u.email.toLowerCase()),
        createdAt: u.createdAt,
        emailConfirmedAt: u.emailConfirmedAt ?? null,
        lastSeenAt: u.lastSeenAt ?? null,
        creditosGastos: gastosPorId.get(u.id) ?? 0,
        ultimoUso: ultimoPorId.get(u.id) ?? null,
        liveMinutes: u.liveMinutes,
        uso: {
          produtos: produtos[u.id] ?? 0,
          campanhas: campanhas[u.id] ?? 0,
          videosGerados: videos[u.id] ?? 0,
          lives: lives[u.id] ?? 0,
        },
      })),
      total,
      page,
    };
  }

  /**
   * Contas criadas depois de `desde` (no máximo 24 h para trás, 20 itens) —
   * a lista que vira toast no painel. Sem `desde` válido, só as da última hora.
   */
  async novasContas(desde?: string) {
    const agora = Date.now();
    const pedido = desde ? new Date(desde).getTime() : NaN;
    const minimo = agora - 24 * 60 * 60 * 1000;
    const corte = new Date(
      Number.isFinite(pedido) ? Math.max(pedido, minimo) : agora - 60 * 60 * 1000,
    );
    const rows = await this.users
      .createQueryBuilder('u')
      .where('u.createdAt > :corte', { corte })
      .orderBy('u.createdAt', 'ASC')
      .take(20)
      .getMany();
    return {
      agora: new Date(agora),
      contas: rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName ?? null,
        viaGoogle: Boolean(u.googleId),
        naFila: Boolean(u.waitlistedAt) && !u.waitlistReleasedAt,
        createdAt: u.createdAt,
      })),
    };
  }

  /**
   * Ficha da conta: cadastro, acesso, o que produziu, quanto custou em IA de
   * verdade (telemetria, não crédito) e os extratos.
   */
  async userDetail(id: string) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Conta não encontrada');

    const um = async <T,>(sql: string, params: unknown[] = []): Promise<T> =>
      (await this.dataSource.query<T[]>(sql, params))[0];

    const [
      historico,
      minutos,
      campanhas,
      videos,
      lives,
      contagens,
      custoIa,
      indicadoPor,
      indicados,
    ] = await Promise.all([
      this.transactions.find({ where: { userId: id }, order: { createdAt: 'DESC' }, take: 100 }),
      this.dataSource.query<
        { id: string; minutes: number; kind: string; description: string | null; createdAt: Date }[]
      >(
        `SELECT id, minutes, kind, description, "createdAt" FROM live_minute_transactions
         WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
        [id],
      ),
      this.dataSource.query<{ status: string; total: number }[]>(
        `SELECT status, COUNT(*)::int AS total FROM campaigns WHERE "userId" = $1 GROUP BY status`,
        [id],
      ),
      um<{ total: number; prontos: number; falhos: number; ultimo: Date | null }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS prontos,
                COUNT(*) FILTER (WHERE status IN ('failed','nsfw','canceled'))::int AS falhos,
                MAX("createdAt") AS ultimo
         FROM generated_media WHERE "userId" = $1 AND kind = 'video'`,
        [id],
      ),
      um<{ total: number; minutos: number; ultima: Date | null }>(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) / 60), 0)::int AS minutos,
                MAX(COALESCE("endedAt", "startedAt")) AS ultima
         FROM live_runs WHERE "userId" = $1`,
        [id],
      ),
      um<{ produtos: number; personas: number; roteiros: number; multiplicador: number }>(
        `SELECT (SELECT COUNT(*)::int FROM user_products WHERE "userId" = $1) AS produtos,
                (SELECT COUNT(*)::int FROM personas WHERE "userId" = $1) AS personas,
                (SELECT COUNT(*)::int FROM scripts WHERE "userId" = $1) AS roteiros,
                (SELECT COUNT(*)::int FROM combination_videos WHERE "userId" = $1) AS multiplicador`,
        [id],
      ),
      um<{ total: string; ultimos30: string; eventos: number }>(
        `SELECT COALESCE(SUM("costBrl"), 0) AS total,
                COALESCE(SUM("costBrl") FILTER (WHERE "createdAt" > now() - interval '30 days'), 0) AS ultimos30,
                COUNT(*)::int AS eventos
         FROM ai_cost_events WHERE "userId" = $1`,
        [id],
      ),
      user.referredBy
        ? this.users.findOne({ where: { id: user.referredBy }, select: { id: true, email: true } })
        : Promise.resolve(null),
      um<{ total: number; pagos: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE "referralRewardedAt" IS NOT NULL)::int AS pagos
         FROM app_users WHERE "referredBy" = $1`,
        [id],
      ),
    ]);

    const gastos = historico
      .filter((t) => t.kind === 'spend')
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? null,
      avatarUrl: user.avatarUrl ?? null,
      plan: user.plan,
      credits: user.credits,
      liveMinutes: user.liveMinutes,
      isAdmin: isAdmin(user.email),
      cortesia: compAccountEmails().includes(user.email.toLowerCase()),
      emailConfirmed: Boolean(user.emailConfirmedAt),
      viaGoogle: Boolean(user.googleId),
      naFila: Boolean(user.waitlistedAt) && !user.waitlistReleasedAt,
      stripeCustomerId: user.stripeCustomerId ?? null,
      createdAt: user.createdAt,
      /** Datas que contam a história da conta, na ordem em que acontecem. */
      linhaDoTempo: {
        cadastro: user.createdAt,
        emailConfirmado: user.emailConfirmedAt ?? null,
        entrouNaFila: user.waitlistedAt ?? null,
        liberadoDaFila: user.waitlistReleasedAt ?? null,
        cortesiaDeLive: user.liveTrialGrantedAt ?? null,
        ultimoAcesso: user.lastSeenAt ?? null,
        ultimaAlteracao: user.updatedAt,
      },
      indicacao: {
        indicadoPor: indicadoPor?.email ?? null,
        recompensaPagaEm: user.referralRewardedAt ?? null,
        indicados: indicados?.total ?? 0,
        indicadosQuePagaram: indicados?.pagos ?? 0,
      },
      atividade: {
        produtos: contagens?.produtos ?? 0,
        personas: contagens?.personas ?? 0,
        roteiros: contagens?.roteiros ?? 0,
        multiplicador: contagens?.multiplicador ?? 0,
        campanhas: {
          total: campanhas.reduce((s, c) => s + Number(c.total), 0),
          porStatus: Object.fromEntries(campanhas.map((c) => [c.status, Number(c.total)])),
        },
        videosGerados: {
          total: videos?.total ?? 0,
          prontos: videos?.prontos ?? 0,
          falhos: videos?.falhos ?? 0,
          ultimo: videos?.ultimo ?? null,
        },
        lives: {
          total: lives?.total ?? 0,
          minutosUsados: lives?.minutos ?? 0,
          ultima: lives?.ultima ?? null,
        },
        creditosGastos: gastos,
      },
      /**
       * O que a conta custou de verdade na IA (telemetria), contra o que pagou
       * em crédito — é a margem por cliente.
       */
      custoIa: {
        totalBrl: Number(Number(custoIa?.total ?? 0).toFixed(2)),
        ultimos30DiasBrl: Number(Number(custoIa?.ultimos30 ?? 0).toFixed(2)),
        eventos: custoIa?.eventos ?? 0,
        receitaEmCreditosBrl: Number((gastos * CREDIT_VALUE_BRL).toFixed(2)),
      },
      historico,
      historicoMinutos: minutos,
    };
  }

  /**
   * Troca o plano à mão.
   *
   * Isto NÃO mexe na assinatura do Stripe: serve para casos de suporte (liberar
   * um acesso, corrigir um webhook perdido), e por isso registra quem fez. Se a
   * pessoa tem assinatura ativa, a próxima renovação sobrescreve o que for
   * posto aqui — o Stripe continua sendo a fonte da verdade da cobrança.
   */
  async setPlan(id: string, plano: string, porQuem: string) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Conta não encontrada');
    if (plano !== 'free' && !findPlan(plano)) {
      throw new NotFoundException(`Plano "${plano}" não existe`);
    }
    await this.billing.setPlan(id, plano);
    this.logger.log(
      `${porQuem} trocou o plano de ${user.email}: "${user.plan}" -> "${plano}"`,
    );
    return this.userDetail(id);
  }

  /**
   * Concede (ou retira, com valor negativo) créditos, deixando registro no
   * extrato do usuário — inclusive de quem fez o ajuste, para que um saldo
   * inesperado sempre tenha explicação.
   */
  async adjustCredits(
    id: string,
    amount: number,
    motivo: string,
    porQuem: string,
    notificar = false,
  ) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Conta não encontrada');
    // Retirar mais do que existe deixaria saldo negativo, e um saldo negativo
    // trava a conta em silêncio: toda ação passaria a falhar por falta de
    // crédito sem que o usuário tenha gasto nada.
    if (amount < 0 && user.credits + amount < 0) {
      throw new BadRequestException(
        `A conta tem ${user.credits} créditos; não dá para retirar ${Math.abs(amount)}.`,
      );
    }
    await this.billing.grantPaid(
      id,
      amount,
      'purchase',
      `admin:${porQuem}:${Date.now()}`,
      `Ajuste manual (${porQuem}): ${motivo}`,
    );
    this.logger.log(
      `${porQuem} ajustou os créditos de ${user.email} em ${amount}: ${motivo}`,
    );
    if (notificar && amount > 0) {
      // O ajuste já está lançado; falha no e-mail não pode desfazê-lo nem
      // virar 500 para o admin. Fica no log e o botão "Avisar por e-mail"
      // permite reenviar depois.
      await this.notificarCredito(id, amount, motivo, porQuem).catch((err) =>
        this.logger.error(
          `Créditos lançados, mas o aviso por e-mail para ${user.email} falhou: ${err?.message ?? err}`,
        ),
      );
    }
    return this.userDetail(id);
  }

  /**
   * Avisa o cliente por e-mail que recebeu créditos. Separado do ajuste para
   * cobrir o caso de um crédito lançado antes sem aviso (ou um reenvio) —
   * não mexe no saldo, só informa o saldo atual.
   */
  async notificarCredito(
    id: string,
    amount: number,
    mensagem: string | undefined,
    porQuem: string,
  ) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Conta não encontrada');
    await this.mail.sendCreditGrantEmail(user.email, {
      displayName: user.displayName,
      amount,
      saldo: user.credits,
      mensagem,
    });
    this.logger.log(
      `${porQuem} avisou ${user.email} por e-mail sobre ${amount} créditos`,
    );
    return { enviado: true, para: user.email };
  }
}
