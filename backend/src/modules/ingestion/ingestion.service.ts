import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import { IsNull, Repository } from 'typeorm';
import { Creator } from '../creators/entities/creator.entity';
import { Trend } from '../trends/entities/trend.entity';
import { Video } from '../videos/entities/video.entity';
import { Product } from '../products/entities/product.entity';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { CreativeCenterSource } from './creative-center.source';
import {
  CreativeCenterProductsSource,
  TrendingProduct,
} from './creative-center-products.source';
import { ExternalDataProvider } from './external-data.provider';
import { ImageSearchSource } from './image-search.source';
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
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(ProductMetricDaily)
    private readonly productMetrics: Repository<ProductMetricDaily>,
    private readonly creativeCenter: CreativeCenterSource,
    private readonly ccProducts: CreativeCenterProductsSource,
    private readonly externalData: ExternalDataProvider,
    private readonly imageSearch: ImageSearchSource,
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
      const trendingCreators = await this.creativeCenter.fetchTrendingCreators(8);
      run.creatorsFetched = trendingCreators.length;
      for (const tc of trendingCreators) {
        const creator =
          (await this.creators.findOne({ where: { handle: tc.handle } })) ??
          this.creators.create({ handle: tc.handle, category: tc.topic ?? 'geral' });
        creator.name = tc.name;
        creator.followers = tc.followers;
        creator.category = tc.topic ?? creator.category ?? 'geral';
        creator.avatarUrl = tc.avatarUrl ?? creator.avatarUrl;
        // GMV real não é público: estimativa conservadora pelas views do
        // vídeo em alta (1% das views × ticket R$ 60 ÷ 100 ≈ R$ 0,006/view),
        // só para o criador raspado disputar o ranking com os dados antigos.
        const estimatedGmv = Math.round(tc.videoViews * 0.006);
        if (estimatedGmv > Number(creator.gmvPeriod ?? 0)) {
          creator.gmvPeriod = String(estimatedGmv);
        }
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

      // 3) Produtos em alta → tabelas products + product_metrics_daily.
      //    Fornecedor externo (vendas reais) tem prioridade; sem ele, usa o
      //    Creative Center (popularidade → estimativa).
      run.productsIngested = await this.ingestProducts();

      // 4) Imagens de produtos sem foto (busca de imagem real; 15 por execução).
      const missing = await this.products.find({
        where: { imageUrl: IsNull() },
        take: 15,
      });
      for (const product of missing) {
        const imageUrl = await this.imageSearch.findProductImage(product.title);
        if (imageUrl) {
          product.imageUrl = imageUrl;
          await this.products.save(product);
          run.productsEnriched += 1;
        }
        // Cadência educada entre buscas.
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      run.status = 'success';
      this.logger.log(
        `Ingestão ok: ${run.hashtagsFetched} hashtags, ${run.creatorsFetched} criadores, ${run.videosUpserted} vídeos, ${run.productsIngested} produtos, ${run.productsEnriched} imagens de produto`,
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

  /**
   * Upsert de produtos + métrica diária.
   * - Fornecedor externo configurado: vendas e receita REAIS do dia.
   * - Só Creative Center: sem venda pública, a métrica diária é uma
   *   ESTIMATIVA derivada do índice de popularidade (documentado no código;
   *   o dado bruto de popularidade vai em radarScore).
   */
  private async ingestProducts(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    let count = 0;

    // 3a) Fornecedor pago (Kalodata etc.) — dado real, prioridade máxima.
    const external = await this.externalData.fetchTopProducts(50);
    for (const ext of external) {
      const product = await this.upsertProduct({
        externalId: ext.externalId,
        title: ext.title,
        category: ext.category,
        price: ext.price,
        imageUrl: ext.imageUrl,
        storeName: ext.storeName,
        tiktokUrl: ext.tiktokUrl,
        radarScore: null,
      });
      await this.upsertDailyMetric(product.id, today, ext.salesDaily, ext.revenueDaily);
      count += 1;
    }
    if (external.length > 0) {
      this.logger.log(`${external.length} produtos do fornecedor externo (dado real)`);
      return count;
    }

    // 3b) Creative Center — popularidade pública → estimativa conservadora.
    const trending = await this.ccProducts.fetchTrendingProducts(20);
    for (const tp of trending) {
      const product = await this.upsertProduct({
        externalId: tp.externalId,
        title: tp.title,
        category: tp.category,
        price: tp.price,
        imageUrl: tp.imageUrl,
        storeName: null,
        tiktokUrl: null,
        radarScore: Math.round(tp.popularity),
      });
      const estimate = this.estimateFromPopularity(tp, Number(product.price));
      await this.upsertDailyMetric(product.id, today, estimate.sales, estimate.revenue);
      count += 1;
    }
    return count;
  }

  private async upsertProduct(data: {
    externalId: string;
    title: string;
    category: string;
    price: number;
    imageUrl: string | null;
    storeName: string | null;
    tiktokUrl: string | null;
    radarScore: number | null;
  }): Promise<Product> {
    const product =
      (await this.products.findOne({ where: { externalId: data.externalId } })) ??
      this.products.create({ externalId: data.externalId });
    product.title = data.title;
    product.category = data.category || product.category || 'geral';
    if (data.price > 0) product.price = data.price.toFixed(2);
    else if (!product.price) product.price = '0.00';
    product.imageUrl = data.imageUrl ?? product.imageUrl;
    product.storeName = data.storeName ?? product.storeName;
    product.tiktokUrl = data.tiktokUrl ?? product.tiktokUrl;
    if (data.radarScore !== null) product.radarScore = data.radarScore;
    return this.products.save(product);
  }

  private async upsertDailyMetric(
    productId: string,
    date: string,
    sales: number,
    revenue: number,
  ): Promise<void> {
    const metric =
      (await this.productMetrics.findOne({ where: { productId, date } })) ??
      this.productMetrics.create({ productId, date });
    metric.sales = Math.max(0, Math.round(sales));
    metric.revenue = Math.max(0, revenue).toFixed(2);
    await this.productMetrics.save(metric);
  }

  /**
   * Estimativa a partir do índice de popularidade (0–100) do Creative Center.
   * Curva conservadora: popularidade 100 ≈ 400 vendas/dia; sem preço público,
   * assume ticket médio de R$ 60 (mediana do TikTok Shop BR).
   */
  private estimateFromPopularity(
    tp: TrendingProduct,
    knownPrice: number,
  ): { sales: number; revenue: number } {
    const sales = Math.round((tp.popularity / 100) * 400);
    const ticket = knownPrice > 0 ? knownPrice : 60;
    return { sales, revenue: sales * ticket };
  }
}
