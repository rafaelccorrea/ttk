import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import type { BillableAction } from '../billing/billing.config';
import { BillingService } from '../billing/billing.service';
import { AiJob, AiJobTipo } from './entities/ai-job.entity';

/** O que o trabalho recebe para contar como está indo. */
export interface JobContexto {
  jobId: string;
  progresso(pct: number, etapa?: string): Promise<void>;
  /**
   * Registra uma cobrança já feita: se o servidor morrer antes de terminar,
   * o cron devolve exatamente isso. Chamar de novo sobrescreve.
   */
  cobrado(acao: BillableAction, quantidade?: number): Promise<void>;
}

export interface PedidoDeJob {
  userId: string;
  tipo: AiJobTipo;
  titulo: string;
  referenciaId?: string | null;
}

const HEARTBEAT_MS = 30_000;
const MINUTOS_ATE_CONSIDERAR_TRAVADO = 5;
/** Jobs terminados continuam no indicador por este tempo se não dispensados. */
const MINUTOS_VISIVEL_DEPOIS_DE_TERMINAR = 30;

/**
 * Executor de trabalhos de IA em background. Roda dentro do processo da API
 * (não há worker separado, como nos Cortes e no Live Copilot), com a linha no
 * banco como fonte de verdade: é ela que a tela consulta, é ela que sobrevive
 * à aba fechada, e é por ela que o cron estorna o que o processo deixou cair.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  /** Ids que ESTE processo está executando — o cron não mexe neles. */
  private readonly emAndamento = new Set<string>();

  constructor(
    @InjectRepository(AiJob) private readonly jobs: Repository<AiJob>,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cria a linha e dispara `fn` sem esperar. O request que chamou devolve o
   * job ao cliente na hora; o resultado de `fn` vai para `resultado` quando
   * terminar e a exceção (com a mensagem do Nest, se for HttpException) para
   * `erro`.
   */
  async iniciar<T>(
    pedido: PedidoDeJob,
    fn: (ctx: JobContexto) => Promise<T>,
  ): Promise<AiJob> {
    const job = await this.jobs.save(
      this.jobs.create({
        userId: pedido.userId,
        tipo: pedido.tipo,
        titulo: pedido.titulo.slice(0, 200),
        referenciaId: pedido.referenciaId ?? null,
        status: 'na_fila',
        progresso: 0,
        heartbeatAt: new Date(),
      }),
    );
    void this.executar(job, fn);
    return job;
  }

  /** Há job deste tipo (e referência, se dada) ainda rodando para o usuário? */
  async emVoo(userId: string, tipo: AiJobTipo, referenciaId?: string): Promise<AiJob | null> {
    return this.jobs.findOne({
      where: {
        userId,
        tipo,
        status: In(['na_fila', 'rodando']),
        ...(referenciaId ? { referenciaId } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async executar<T>(job: AiJob, fn: (ctx: JobContexto) => Promise<T>) {
    this.emAndamento.add(job.id);
    const bater = setInterval(() => {
      this.jobs
        .update({ id: job.id }, { heartbeatAt: new Date() })
        .catch(() => undefined);
    }, HEARTBEAT_MS);

    const ctx: JobContexto = {
      jobId: job.id,
      progresso: async (pct, etapa) => {
        const progresso = Math.max(0, Math.min(99, Math.round(pct)));
        await this.jobs.update(
          { id: job.id },
          { progresso, ...(etapa !== undefined ? { etapa } : {}), heartbeatAt: new Date() },
        );
      },
      cobrado: async (acao, quantidade = 1) => {
        await this.jobs.update(
          { id: job.id },
          { estornoAcao: acao, estornoQuantidade: quantidade },
        );
      },
    };

    try {
      await this.jobs.update(
        { id: job.id },
        { status: 'rodando', heartbeatAt: new Date() },
      );
      const resultado = await fn(ctx);
      await this.jobs.update(
        { id: job.id },
        {
          status: 'concluido',
          progresso: 100,
          etapa: null,
          resultado: (resultado ?? null) as never,
          // Entregou: não há mais o que devolver.
          estornoAcao: null,
          estornoQuantidade: null,
          finishedAt: new Date(),
        },
      );
      this.audit.evento({
        userId: job.userId,
        categoria: 'jobs',
        acao: `jobs.${job.tipo}.concluido`,
        alvoId: job.referenciaId ?? job.id,
        detalhe: { jobId: job.id },
      });
    } catch (error) {
      const mensagem = mensagemDoErro(error);
      this.logger.warn(`Job ${job.tipo} ${job.id} falhou: ${mensagem}`);
      this.audit.evento({
        userId: job.userId,
        categoria: 'jobs',
        acao: `jobs.${job.tipo}.falhou`,
        alvoId: job.referenciaId ?? job.id,
        resultado: 'erro',
        erro: mensagem,
        detalhe: { jobId: job.id },
      });
      await this.jobs
        .update(
          { id: job.id },
          {
            status: 'falhou',
            erro: mensagem,
            etapa: null,
            // Quem lançou já estornou (withCharge) — o cron não deve repetir.
            estornoAcao: null,
            estornoQuantidade: null,
            finishedAt: new Date(),
          },
        )
        .catch(() => undefined);
    } finally {
      clearInterval(bater);
      this.emAndamento.delete(job.id);
    }
  }

  /** Jobs vivos + terminados há pouco e ainda não dispensados. */
  async listarAtivos(userId: string): Promise<AiJob[]> {
    const limite = new Date(
      Date.now() - MINUTOS_VISIVEL_DEPOIS_DE_TERMINAR * 60_000,
    );
    return this.jobs.find({
      where: [
        { userId, status: In(['na_fila', 'rodando']) },
        {
          userId,
          status: In(['concluido', 'falhou']),
          finishedAt: MoreThan(limite),
          dispensadoEm: IsNull(),
        },
      ],
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async obter(userId: string, id: string): Promise<AiJob> {
    const job = await this.jobs.findOneBy({ id, userId });
    if (!job) throw new NotFoundException('Trabalho não encontrado.');
    return job;
  }

  async dispensar(userId: string, id: string): Promise<void> {
    const r = await this.jobs.update(
      { id, userId, status: In(['concluido', 'falhou']) },
      { dispensadoEm: new Date() },
    );
    if (!r.affected) throw new NotFoundException('Trabalho não encontrado.');
  }

  /**
   * Job que parou de bater morreu com o processo (deploy, restart, OOM).
   * Devolve o que estava cobrado e conta a verdade para o usuário.
   */
  @Cron('*/2 * * * *')
  async reabrirTravados(): Promise<number> {
    const limite = new Date(Date.now() - MINUTOS_ATE_CONSIDERAR_TRAVADO * 60_000);
    const candidatos = await this.jobs.find({
      where: { status: In(['na_fila', 'rodando']), heartbeatAt: LessThan(limite) },
    });
    const travados = candidatos.filter((j) => !this.emAndamento.has(j.id));
    for (const job of travados) {
      let aviso = '';
      if (job.estornoAcao) {
        try {
          await this.billing.refund(
            job.userId,
            job.estornoAcao as BillableAction,
            `Estorno: ${job.titulo} interrompido no servidor`,
            job.estornoQuantidade ?? 1,
          );
          aviso = ' Os créditos foram devolvidos.';
        } catch (error) {
          this.logger.error(`Estorno do job ${job.id} falhou: ${error}`);
        }
      }
      await this.jobs.update(
        { id: job.id },
        {
          status: 'falhou',
          etapa: null,
          erro: `O processamento foi interrompido antes de terminar (provavelmente uma reinicialização do servidor).${aviso} Tente de novo.`,
          estornoAcao: null,
          estornoQuantidade: null,
          finishedAt: new Date(),
        },
      );
      this.logger.warn(`Job ${job.tipo} ${job.id} reaberto pelo cron como falhou.`);
    }
    return travados.length;
  }
}

function mensagemDoErro(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { getResponse?: () => unknown; message?: string };
    if (typeof e.getResponse === 'function') {
      const r = e.getResponse();
      if (typeof r === 'string') return r;
      if (r && typeof r === 'object' && 'message' in r) {
        const m = (r as { message: unknown }).message;
        return Array.isArray(m) ? m.join('; ') : String(m);
      }
    }
    if (e.message) return e.message;
  }
  return 'Erro inesperado ao processar.';
}
