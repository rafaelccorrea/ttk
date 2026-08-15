import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trend } from '../trends/entities/trend.entity';
import { CreativeCenterSource } from './creative-center.source';

export interface IngestionRunResult {
  source: string;
  fetched: number;
  created: number;
  updated: number;
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
      this.logger.log(
        `Ingestão ok: ${result.fetched} hashtags (${result.created} novas, ${result.updated} atualizadas)`,
      );
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ingestão falhou: ${result.error}`);
    }
    this.lastRun = result;
    return result;
  }
}
