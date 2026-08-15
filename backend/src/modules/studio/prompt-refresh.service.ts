import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { Video } from '../videos/entities/video.entity';
import { AiService, ReferenciaDeCofre } from './ai.service';
import { PromptTemplate } from './entities/prompt-template.entity';

const JOB_NAME = 'cofre-refresh';

/** Segunda-feira às 4h, quando o tráfego é mínimo e a ingestão da noite já rodou. */
const CRON_PADRAO = '0 0 4 * * 1';

/** Categorias por rodada. Cada uma é uma chamada ao Claude — o teto é de custo. */
const MAX_CATEGORIAS = 6;

/** Anúncios enviados por categoria: o bastante para o padrão aparecer. */
const REFS_POR_CATEGORIA = 12;

/** Janela de observação. Formato que vendia há 3 meses já não é tendência. */
const DIAS_DE_JANELA = 30;

/**
 * Teto de prompts automáticos no Cofre.
 *
 * Sem ele, uma rodada por semana empilha indefinidamente e em um ano o Cofre
 * tem centenas de cards que ninguém rola até o fim. Ao estourar, os mais
 * antigos saem — os curados ('seed') nunca entram nessa conta.
 */
const MAX_AUTOMATICOS = 40;

/**
 * Mantém o Cofre de Prompts vivo.
 *
 * O Cofre nasceu como uma lista fixa escrita à mão no seed: excelente no dia
 * do lançamento e desatualizada um mês depois, porque formato de anúncio no
 * TikTok tem validade curta. Este serviço fecha o ciclo que a plataforma já
 * tinha aberto — nós ingerimos os anúncios que estão vendendo, então os
 * formatos que funcionam agora estão no nosso próprio banco. Semanalmente
 * destilamos os campeões de cada categoria em prompts reutilizáveis.
 *
 * Três garantias de segurança, nesta ordem de importância:
 *
 * 1. Os prompts curados ('seed') NUNCA são tocados. Uma safra ruim da IA, ou
 *    a API fora do ar, degrada a atualização — não o produto. O Cofre nunca
 *    fica vazio.
 * 2. Nada é apagado antes de a nova safra estar gravada. A poda do teto roda
 *    no fim, e só sobre 'auto'.
 * 3. As legendas que alimentam a destilação são texto de terceiros e são
 *    tratadas como dado, nunca como instrução (ver `buildCofrePrompt`).
 */
@Injectable()
export class PromptRefreshService implements OnModuleInit {
  private readonly logger = new Logger(PromptRefreshService.name);
  private running = false;
  private lastRunAt: Date | null = null;
  private lastResult: string | null = null;

  constructor(
    @InjectRepository(PromptTemplate)
    private readonly prompts: Repository<PromptTemplate>,
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly ai: AiService,
    private readonly scheduler: SchedulerRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const expr = this.config.get<string>('COFRE_CRON') ?? CRON_PADRAO;
    if (expr === 'off') {
      this.logger.log('Atualização do Cofre desativada (COFRE_CRON=off)');
      return;
    }
    let job: CronJob;
    try {
      job = new CronJob(expr, () => void this.run('cron'));
    } catch {
      // Cron inválido no ambiente não pode impedir o boot: o Cofre continua
      // servindo o que já tem.
      this.logger.error(`COFRE_CRON inválido ("${expr}") — atualização desligada`);
      return;
    }
    this.scheduler.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Atualização do Cofre agendada: "${expr}"`);
  }

  status() {
    const agendado = this.scheduler.doesExist('cron', JOB_NAME);
    return {
      enabled: agendado,
      isRunning: this.running,
      nextRunAt: agendado
        ? (this.scheduler.getCronJob(JOB_NAME).nextDate()?.toJSDate().toISOString() ??
          null)
        : null,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastResult: this.lastResult,
    };
  }

  async run(trigger: 'cron' | 'manual' = 'manual'): Promise<{ criados: number; atualizados: number }> {
    if (this.running) {
      this.logger.warn('Atualização do Cofre já em andamento — ignorando');
      return { criados: 0, atualizados: 0 };
    }
    // Sem chave de IA não há o que destilar. Sair aqui evita varrer o banco
    // para depois descobrir que não dava.
    if (!this.ai.enabled) {
      this.lastResult = 'sem ANTHROPIC_API_KEY — nada a fazer';
      this.logger.warn(this.lastResult);
      return { criados: 0, atualizados: 0 };
    }

    this.running = true;
    const inicio = Date.now();
    let criados = 0;
    let atualizados = 0;
    try {
      const categorias = await this.categoriasComTracao();
      this.logger.log(
        `Atualizando o Cofre (${trigger}) a partir de ${categorias.length} categoria(s)`,
      );

      for (const categoria of categorias) {
        const referencias = await this.referencias(categoria);
        if (referencias.length < 3) continue; // amostra pequena não revela padrão

        const destilados = await this.ai.destilarPromptsDoCofre(categoria, referencias);
        for (const p of destilados) {
          const sourceKey = this.chave(categoria, p.title);
          const existente = await this.prompts.findOneBy({ sourceKey });
          if (existente) {
            // Atualiza no lugar: o card permanece, o conteúdo acompanha o que
            // está funcionando agora.
            Object.assign(existente, {
              title: p.title,
              mediaType: p.mediaType,
              durationSec: p.durationSec,
              tags: p.tags,
              template: p.template,
              fields: p.fields,
            });
            await this.prompts.save(existente);
            atualizados += 1;
          } else {
            await this.prompts.save(
              this.prompts.create({
                title: p.title,
                mediaType: p.mediaType,
                durationSec: p.durationSec ?? undefined,
                niches: [categoria],
                tags: p.tags,
                template: p.template,
                fields: p.fields,
                source: 'auto',
                sourceKey,
              }),
            );
            criados += 1;
          }
        }
      }

      // Só depois de tudo gravado. Se a rodada morreu no meio, o Cofre fica
      // maior que o teto por uma semana — o que é infinitamente melhor que
      // ter podado antes e não ter conseguido repor.
      const podados = await this.podar();

      this.lastResult = `${criados} novo(s), ${atualizados} atualizado(s), ${podados} removido(s) em ${Math.round((Date.now() - inicio) / 1000)}s`;
      this.logger.log(`Cofre atualizado: ${this.lastResult}`);
      return { criados, atualizados };
    } catch (error) {
      this.lastResult = `falhou: ${error instanceof Error ? error.message : error}`;
      this.logger.error(`Atualização do Cofre falhou: ${error}`);
      return { criados, atualizados };
    } finally {
      this.lastRunAt = new Date();
      this.running = false;
    }
  }

  /** As categorias que mais faturaram na janela — onde há padrão para extrair. */
  private async categoriasComTracao(): Promise<string[]> {
    const linhas = await this.videos
      .createQueryBuilder('v')
      .select('v.category', 'categoria')
      .addSelect('SUM(v.revenueEstimate)', 'total')
      .where('v.postedAt >= :desde', { desde: this.desde() })
      .andWhere('v.category IS NOT NULL')
      .groupBy('v.category')
      .orderBy('total', 'DESC')
      .limit(MAX_CATEGORIAS)
      .getRawMany<{ categoria: string }>();
    return linhas.map((l) => l.categoria).filter(Boolean);
  }

  private async referencias(categoria: string): Promise<ReferenciaDeCofre[]> {
    const videos = await this.videos
      .createQueryBuilder('v')
      .where('v.category = :categoria', { categoria })
      .andWhere('v.postedAt >= :desde', { desde: this.desde() })
      .andWhere("v.caption <> ''")
      // Ordena por faturamento, não por views: o Cofre é sobre o que VENDE.
      // Um vídeo com 5M de views e nenhuma venda ensina o formato errado.
      .orderBy('v.revenueEstimate', 'DESC')
      .addOrderBy('v.views', 'DESC')
      .limit(REFS_POR_CATEGORIA)
      .getMany();
    return videos.map((v) => ({
      caption: v.caption,
      views: v.views,
      revenueBrl: Number(v.revenueEstimate) || 0,
    }));
  }

  /** Remove os automáticos mais antigos acima do teto. Nunca toca nos curados. */
  private async podar(): Promise<number> {
    const excedente =
      (await this.prompts.countBy({ source: 'auto' })) - MAX_AUTOMATICOS;
    if (excedente <= 0) return 0;
    const velhos = await this.prompts.find({
      where: { source: 'auto' },
      order: { updatedAt: 'ASC' },
      take: excedente,
    });
    await this.prompts.remove(velhos);
    return velhos.length;
  }

  private desde(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - DIAS_DE_JANELA);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Chave de dedupe: categoria + título normalizado.
   *
   * Normalizar (minúsculas, sem acento, sem pontuação) faz "Testando se
   * aguenta água" e "testando se aguenta agua!" caírem no mesmo card em vez de
   * virarem duas linhas quase iguais no Cofre.
   */
  private chave(categoria: string, titulo: string): string {
    const normal = `${categoria}|${titulo}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9| ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return createHash('sha256').update(normal).digest('hex').slice(0, 32);
  }
}
