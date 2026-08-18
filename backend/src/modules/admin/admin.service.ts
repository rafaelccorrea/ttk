import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  naFila: boolean;
  temAssinaturaStripe: boolean;
  createdAt: Date;
  /** Créditos já consumidos em IA — o custo que a conta gerou. */
  creditosGastos: number;
  ultimoUso: Date | null;
}

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
  ) {}

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

    const novos30 = await this.users
      .createQueryBuilder('u')
      .select('COUNT(*)::int', 'total')
      .where("u.createdAt > now() - interval '30 days'")
      .getRawOne<{ total: number }>();

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
        conversaoPct:
          externas > 0
            ? Math.round((receita.assinaturasAtivas / externas) * 100)
            : 0,
      },
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

  /** Lista de contas, com busca por e-mail/nome e filtro por plano. */
  async listUsers(params: {
    busca?: string;
    plano?: string;
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

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('u.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Consumo e último uso vêm numa consulta só, agrupada — não uma por linha.
    const ids = rows.map((r) => r.id);
    const consumo = ids.length
      ? await this.transactions
          .createQueryBuilder('t')
          .select('t.userId', 'userId')
          .addSelect('COALESCE(SUM(-t.amount),0)::int', 'gastos')
          .addSelect('MAX(t.createdAt)', 'ultimo')
          .where('t.userId IN (:...ids)', { ids })
          .andWhere('t.kind = :kind', { kind: 'spend' })
          .groupBy('t.userId')
          .getRawMany<{ userId: string; gastos: number; ultimo: Date }>()
      : [];
    const porUsuario = new Map(consumo.map((c) => [c.userId, c]));

    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName ?? null,
        plan: u.plan,
        credits: u.credits,
        isAdmin: isAdmin(u.email),
        emailConfirmed: Boolean(u.emailConfirmedAt),
        naFila: Boolean(u.waitlistedAt),
        temAssinaturaStripe: Boolean(u.stripeCustomerId),
        createdAt: u.createdAt,
        creditosGastos: porUsuario.get(u.id)?.gastos ?? 0,
        ultimoUso: porUsuario.get(u.id)?.ultimo ?? null,
      })),
      total,
      page,
    };
  }

  /** Ficha da conta: dados + extrato completo de créditos. */
  async userDetail(id: string) {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('Conta não encontrada');
    const historico = await this.transactions.find({
      where: { userId: id },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? null,
      plan: user.plan,
      credits: user.credits,
      isAdmin: isAdmin(user.email),
      emailConfirmed: Boolean(user.emailConfirmedAt),
      naFila: Boolean(user.waitlistedAt),
      stripeCustomerId: user.stripeCustomerId ?? null,
      createdAt: user.createdAt,
      historico,
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
    return this.userDetail(id);
  }
}
