import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CREDIT_VALUE_BRL,
  findPlan,
  PLANS,
  planPrice,
} from '../billing/billing.config';
import { BillingService } from '../billing/billing.service';
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
  ) {}

  /**
   * Painel: o retrato do negócio numa consulta.
   *
   * A receita é *estimada* a partir do plano atual de cada assinante, não do que
   * o Stripe efetivamente cobrou — quem paga anual aparece aqui pelo valor
   * mensal equivalente do plano. Serve para ver ordem de grandeza e tendência;
   * para fechar caixa, a fonte é o Stripe.
   */
  async overview() {
    const porPlano = await this.users
      .createQueryBuilder('u')
      .select('u.plan', 'plan')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect('COALESCE(SUM(u.credits),0)::int', 'creditos')
      .groupBy('u.plan')
      .getRawMany<{ plan: string; total: number; creditos: number }>();

    const assinantes = porPlano
      .filter((p) => p.plan !== 'free')
      .reduce((s, p) => s + p.total, 0);
    const receitaMensal = porPlano.reduce((soma, linha) => {
      const plano = findPlan(linha.plan);
      return soma + (plano ? planPrice(plano, 'month') * linha.total : 0);
    }, 0);

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

    return {
      contas: {
        total: totalContas,
        assinantes,
        pendentes: porPlano.find((p) => p.plan === 'free')?.total ?? 0,
        novos30Dias: novos30?.total ?? 0,
        // A régua que importa num paywall: quantos dos que criaram conta pagaram.
        conversaoPct:
          totalContas > 0 ? Math.round((assinantes / totalContas) * 100) : 0,
      },
      porPlano: PLANS.map((p) => ({
        id: p.id,
        nome: p.name,
        assinantes: porPlano.find((x) => x.plan === p.id)?.total ?? 0,
        precoBrl: p.priceBrl,
      })),
      receita: { mensalEstimadaBrl: Number(receitaMensal.toFixed(2)) },
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
