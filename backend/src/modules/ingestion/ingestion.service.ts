import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Creator } from '../creators/entities/creator.entity';
import { Trend } from '../trends/entities/trend.entity';
import { Video } from '../videos/entities/video.entity';
import { CreativeCenterSource } from './creative-center.source';

export interface IngestionRunResult {
  source: string;
  fetched: number;
  created: number;
  updated: number;
  creatorsFetched: number;
  videosUpserted: number;
  ranAt: string;
  error?: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private lastRun: IngestionRunResult | null = null;

  constructor(
    @InjectRepository(Trend)
    private readonly trends: Repository<Trend>,
    @InjectRepository(Creator)
    private readonly creators: Repository<Creator>,
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly creativeCenter: CreativeCenterSource,
  ) {}

  // 1x/dia às 06:00 — cadência educada com a área pública do Creative Center.
  @Cron('0 0 6 * * *')
  async scheduledRun() {
    await this.run();
  }

  status(): IngestionRunResult | null {
    return this.lastRun;
  }

  async run(): Promise<IngestionRunResult> {
    const result: IngestionRunResult = {
      source: 'tiktok-creative-center',
      fetched: 0,
      created: 0,
      updated: 0,
      creatorsFetched: 0,
      videosUpserted: 0,
      ranAt: new Date().toISOString(),
    };
    try {
      const hashtags = await this.creativeCenter.fetchTrendingHashtags(20);
      result.fetched = hashtags.length;
      for (const tag of hashtags) {
        const existing = await this.trends.findOne({ where: { hashtag: tag.hashtag } });
        if (existing) {
          existing.title = tag.title;
          existing.views = String(tag.views);
          existing.growthRate = tag.growthRate.toFixed(2);
          existing.category = tag.category ?? existing.category;
          await this.trends.save(existing);
          result.updated += 1;
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
          result.created += 1;
        }
      }
      // Criadores/vídeos em alta (reais, com handle/avatar/thumbnail do TikTok).
      const trendingCreators = await this.creativeCenter.fetchTrendingCreators(4);
      result.creatorsFetched = trendingCreators.length;
      for (const tc of trendingCreators) {
        const creator =
          (await this.creators.findOne({ where: { handle: tc.handle } })) ??
          this.creators.create({ handle: tc.handle, category: tc.topic ?? 'geral' });
        creator.name = tc.name;
        creator.followers = tc.followers;
        creator.category = tc.topic ?? creator.category ?? 'geral';
        creator.avatarUrl = tc.avatarUrl ?? creator.avatarUrl;
        await this.creators.save(creator);

        // Vídeo em alta associado (thumbnail real; sem URL pública do vídeo,
        // o card linka para o perfil do criador).
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
        await this.videos.save(video);
        result.videosUpserted += 1;
      }

      this.logger.log(
        `Ingestão ok: ${result.fetched} hashtags (${result.created} novas, ${result.updated} atualizadas), ${result.creatorsFetched} criadores, ${result.videosUpserted} vídeos`,
      );
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ingestão falhou: ${result.error}`);
    }
    this.lastRun = result;
    return result;
  }
}
