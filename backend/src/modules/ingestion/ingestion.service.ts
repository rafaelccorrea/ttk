import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import { Repository } from 'typeorm';
import { Creator } from '../creators/entities/creator.entity';
import { Trend } from '../trends/entities/trend.entity';
import { Video } from '../videos/entities/video.entity';
import { CreativeCenterSource } from './creative-center.source';
import { IngestionRun, IngestionTrigger } from './entities/ingestion-run.entity';
import { IngestionSetting } from './entities/ingestion-setting.entity';

const JOB_NAME = 'ingestion-cron';

@Injectable()
export class IngestionService implements OnModuleInit {
  private readonly logger = new Logger(IngestionService.name);
  private running = false;

  constructor(
    @InjectRepository(Trend)
    private readonly trends: Repository<Trend>,
    @InjectRepository(Creator)
    private readonly creators: Repository<Creator>,
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    @InjectRepository(IngestionRun)
    private readonly runs: Repository<IngestionRun>,
    @InjectRepository(IngestionSetting)
    private readonly settings: Repository<IngestionSetting>,
    private readonly creativeCenter: CreativeCenterSource,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  // Registra o cron a partir da configuração persistida.
  async onModuleInit() {
    const setting = await this.getSetting();
    this.applySchedule(setting);
    // Marca como interrompida qualquer execução que ficou "running" (crash/restart).
    await this.runs.update({ status: 'running' }, { status: 'error', error: 'Interrompida por reinício do servidor' });
  }

  private async getSetting(): Promise<IngestionSetting> {
    let setting = await this.settings.findOneBy({ id: 1 });
    if (!setting) {
      setting = await this.settings.save(this.settings.create({ id: 1 }));
    }
    return setting;
  }

  private applySchedule(setting: IngestionSetting) {
    if (this.scheduler.doesExist('cron', JOB_NAME)) {
      this.scheduler.deleteCronJob(JOB_NAME);
    }
    if (!setting.enabled) {
      this.logger.log('Agendamento da ingestão desativado');
      return;
    }
    const job = new CronJob(setting.cronExpr, () => void this.run('cron'));
    this.scheduler.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Ingestão agendada: "${setting.cronExpr}"`);
  }

  async getSchedule() {
    const setting = await this.getSetting();
    let nextRunAt: string | null = null;
    if (setting.enabled && this.scheduler.doesExist('cron', JOB_NAME)) {
      const job = this.scheduler.getCronJob(JOB_NAME);
      nextRunAt = job.nextDate()?.toJSDate().toISOString() ?? null;
    }
    return {
      cronExpr: setting.cronExpr,
      enabled: setting.enabled,
      nextRunAt,
      isRunning: this.running,
    };
  }

  async updateSchedule(input: { cronExpr?: string; enabled?: boolean }) {
    const setting = await this.getSetting();
    if (input.cronExpr !== undefined) {
      try {
        // Valida a expressão criando um job descartável.
        new CronJob(input.cronExpr, () => undefined);
      } catch {
        throw new BadRequestException(`Expressão cron inválida: "${input.cronExpr}"`);
      }
      setting.cronExpr = input.cronExpr;
    }
    if (input.enabled !== undefined) setting.enabled = input.enabled;
    await this.settings.save(setting);
    this.applySchedule(setting);
    return this.getSchedule();
  }

  listRuns(limit = 20): Promise<IngestionRun[]> {
    return this.runs.find({ order: { startedAt: 'DESC' }, take: limit });
  }

  async status() {
    const [schedule, lastRuns] = await Promise.all([this.getSchedule(), this.listRuns(1)]);
    return { ...schedule, lastRun: lastRuns[0] ?? null };
  }

  async run(trigger: IngestionTrigger = 'manual'): Promise<IngestionRun> {
    if (this.running) {
      throw new BadRequestException('Já existe uma ingestão em andamento');
    }
    this.running = true;
    const run = await this.runs.save(this.runs.create({ trigger, status: 'running' }));
    try {
      // 1) Hashtags em alta (BR) → tabela trends.
      const hashtags = await this.creativeCenter.fetchTrendingHashtags(20);
      run.hashtagsFetched = hashtags.length;
      for (const tag of hashtags) {
        const existing = await this.trends.findOne({ where: { hashtag: tag.hashtag } });
        if (existing) {
          existing.title = tag.title;
          existing.views = String(tag.views);
          existing.growthRate = tag.growthRate.toFixed(2);
          existing.category = tag.category ?? existing.category;
          await this.trends.save(existing);
        } else {
          await this.trends.save(
            this.trends.create({
              title: tag.title,
              hashtag: tag.hashtag,
              views: String(tag.views),
              growthRate: tag.growthRate.toFixed(2),
              category: tag.category ?? undefined,
            }),
          );
        }
      }

      // 2) Criadores/vídeos em alta (com avatar, thumbnail e MP4 reais).
      const trendingCreators = await this.creativeCenter.fetchTrendingCreators(4);
      run.creatorsFetched = trendingCreators.length;
      for (const tc of trendingCreators) {
        const creator =
          (await this.creators.findOne({ where: { handle: tc.handle } })) ??
          this.creators.create({ handle: tc.handle, category: tc.topic ?? 'geral' });
        creator.name = tc.name;
        creator.followers = tc.followers;
        creator.category = tc.topic ?? creator.category ?? 'geral';
        creator.avatarUrl = tc.avatarUrl ?? creator.avatarUrl;
        await this.creators.save(creator);

        const externalId = `cc-top-${tc.handle}`;
        const video =
          (await this.videos.findOne({ where: { externalId } })) ??
          this.videos.create({
            externalId,
            postedAt: new Date().toISOString().slice(0, 10),
          });
        video.caption = `Vídeo em alta de ${tc.name}${tc.topic ? ` · ${tc.topic}` : ''}`;
        video.creatorHandle = tc.handle;
        video.views = tc.videoViews;
        video.category = tc.topic ?? 'geral';
        video.thumbnailUrl = tc.thumbnailUrl ?? video.thumbnailUrl;
        video.playbackUrl = tc.playbackUrl ?? video.playbackUrl;
        await this.videos.save(video);
        run.videosUpserted += 1;
      }

      run.status = 'success';
      this.logger.log(
        `Ingestão ok: ${run.hashtagsFetched} hashtags, ${run.creatorsFetched} criadores, ${run.videosUpserted} vídeos`,
      );
    } catch (err) {
      run.status = 'error';
      run.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ingestão falhou: ${run.error}`);
    } finally {
      run.finishedAt = new Date();
      await this.runs.save(run);
      this.running = false;
    }
    return run;
  }
}
