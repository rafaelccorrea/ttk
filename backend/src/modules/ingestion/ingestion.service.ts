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
import { ExternalDataProvider, ExternalProduct } from './external-data.provider';
import { evaluateProduct, filterSourcedProducts } from './product-gate';
import { ProductExtractorService } from './product-extractor.service';
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
    private readonly extractor: ProductExtractorService,
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
        // Chave normalizada: "#Beleza" e "#beleza" são a mesma hashtag.
        tag.hashtag = tag.hashtag.toLowerCase();
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

      // 2) Criadores/vídeos em alta — dado REAL do Creative Center (handle,
      //    seguidores, views, avatar, thumbnail e MP4 verdadeiros).
      //    São virais genéricos, não vídeos de produto: por isso entram
      //    marcados como 'trending' e a tela de Vídeos que Vendem os separa
      //    do conteúdo com produto atrelado.
      // A aba "Vídeos" do Creative Center força region=US (medido) e a de
      // criadores está "em breve" — por isso não usamos nenhuma das duas.
      // A fonte de vídeo BR é o Top Ads, tratado logo abaixo.
      const trendingCreators: Awaited<
        ReturnType<CreativeCenterSource['fetchTrendingCreators']>
      > = [];
      run.creatorsFetched = trendingCreators.length;
      for (const tc of trendingCreators) {
        // Handles do TikTok são case-insensitive; normaliza para não duplicar.
        tc.handle = tc.handle.toLowerCase();
        const creator =
          (await this.creators.findOne({ where: { handle: tc.handle } })) ??
          this.creators.create({ handle: tc.handle, category: tc.topic ?? 'geral' });
        creator.source = 'tiktok';
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
        video.kind = 'trending';
        video.caption = `Vídeo em alta de ${tc.name}${tc.topic ? ` · ${tc.topic}` : ''}`;
        video.creatorHandle = tc.handle;
        video.views = tc.videoViews;
        video.category = tc.topic ?? 'geral';
        video.thumbnailUrl = tc.thumbnailUrl ?? video.thumbnailUrl;
        video.playbackUrl = tc.playbackUrl ?? video.playbackUrl;
        await this.videos.save(video);
        run.videosUpserted += 1;
      }

      // 2b) Vídeos de anúncios BRASILEIROS (Top Ads) — reais e reproduzíveis.
      const adVideos = await this.ccProducts.fetchAdVideos(60);
      for (const ad of adVideos) {
        // O feed BR às vezes traz anúncio de outro mercado (árabe, asiático).
        // Alfabeto não latino = fora do Brasil, não entra.
        if (/[Ѐ-ӿ؀-ۿ぀-ヿ一-鿿가-힯]/.test(ad.caption)) continue;
        const video =
          (await this.videos.findOne({ where: { externalId: ad.externalId } })) ??
          this.videos.create({
            externalId: ad.externalId,
            postedAt: new Date().toISOString().slice(0, 10),
          });
        // Entra como 'pending': só vira 'product' depois que a análise
        // confirmar que vende produto físico. Assim "Vídeos que Vendem" nunca
        // mostra anúncio de banco, app ou institucional.
        if (!video.kind || video.kind === 'trending') video.kind = 'pending';
        video.caption = ad.caption || 'Anúncio em alta no TikTok Brasil';
        video.creatorHandle = ad.brand ?? 'anunciante';
        video.category = ad.category;
        video.likes = ad.likes;
        video.thumbnailUrl = ad.thumbnailUrl ?? video.thumbnailUrl;
        // MP4 expira em horas: sempre sobrescreve com a URL fresca.
        video.playbackUrl = ad.playbackUrl ?? video.playbackUrl;
        await this.videos.save(video);
        run.videosUpserted += 1;
      }

      // 2c) PRODUTOS a partir dos anúncios: o vídeo diz o que vende.
      //     Transcreve o áudio (Whisper) e extrai o produto da fala + legenda.
      //     É a única fonte de produto BR que conseguimos sem afiliado — e é
      //     derivada de anúncio real, não número inventado.
      run.productsIngested += await this.extractProductsFromAds(
        new Date().toISOString().slice(0, 10),
      );

      // 3) Produtos → tabelas products + product_metrics_daily.
      //    IMPORTANTE: só ingerimos produto de fonte confiável. O Top Ads foi
      //    descartado como fonte (medição: 117 anúncios coletados, apenas 2 de
      //    venda de produto — o resto era publicidade sem produto, poluindo o
      //    catálogo). Enquanto não houver fonte real de catálogo, roda apenas
      //    com fornecedor externo configurado (EXTERNAL_DATA_*).
      run.productsIngested += await this.ingestProducts();

      // 4) Galeria de imagens reais. Cobre tanto quem não tem foto nenhuma
      //    quanto quem tem só uma — a tela de detalhe mostra várias.
      const needImages = await this.products
        .createQueryBuilder('p')
        .where('p."imageUrl" IS NULL')
        .orWhere('p.images IS NULL')
        .orWhere('jsonb_array_length(p.images) < 2')
        .orderBy('p."imageUrl" IS NULL', 'DESC') // sem foto primeiro
        .take(40)
        .getMany();

      for (const product of needImages) {
        const images = await this.imageSearch.findProductImages(product.title, 5);
        if (images.length > 0) {
          product.images = images;
          product.imageUrl = product.imageUrl ?? images[0];
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

    // Abre a janela de cota ANTES de qualquer chamada paga.
    const allowance = await this.openApiAllowance();
    this.externalData.beginRun(allowance);
    if (allowance <= 0) {
      this.logger.warn('Cota mensal do EchoTik esgotada: nenhuma chamada será feita.');
      return 0;
    }

    // 3a) Fornecedor pago (EchoTik) — dado real, prioridade máxima.
    const external = await this.externalData.fetchTopProducts(50);

    // Portão estruturado: só entra no catálogo quem tem product_id + seller_id
    // + região BR + venda registrada. Sem isso, descarta.
    const { accepted, rejected } = filterSourcedProducts(external, {
      region: 'BR',
      minSales: 1,
    });

    for (const { reason } of rejected.slice(0, 10)) {
      this.logger.debug(`Produto externo recusado: ${reason}`);
    }
    if (rejected.length > 0) {
      this.logger.log(
        `${rejected.length} de ${external.length} produtos externos recusados pelo portão`,
      );
    }

    // Produtos com mais GMV primeiro: se a cota acabar no meio, o que entrou
    // é o que mais importa.
    const ordered = accepted.sort((a, b) => b.revenueTotal - a.revenueTotal);

    // O CDN do EchoTik recusa hotlink (403). Assinar é obrigatório para a
    // imagem aparecer — e não consome cota, então vale para todas de uma vez.
    const signed = await this.externalData.signImageUrls(
      ordered.flatMap((p) => p.images),
    );
    const sign = (url: string | null) => (url ? (signed.get(url) ?? url) : null);

    for (const ext of ordered) {
      const gallery = ext.images.map((u) => sign(u)).filter((u): u is string => !!u);
      const product = await this.upsertProduct({
        externalId: ext.externalId,
        title: ext.cleanTitle,
        category: ext.category,
        price: ext.price,
        imageUrl: gallery[0] ?? null,
        images: gallery,
        storeName: ext.storeName,
        tiktokUrl: ext.tiktokUrl,
        radarScore: null,
      });
      await this.upsertDailyMetric(product.id, today, ext.salesDaily, ext.revenueDaily);
      count += 1;

      // Associações custam 2 requests por produto. Só vale para quem vende de
      // verdade — e só enquanto sobrar cota.
      if (!this.externalData.budgetExhausted && ext.salesTotal > 0) {
        await this.ingestProductVideos(product, ext);
        await this.ingestProductCreators(ext);
      }
    }
    await this.closeApiAllowance();

    if (count > 0) {
      this.logger.log(
        `${count} produtos do EchoTik (dado real, ${this.externalData.requestsUsed} requests gastos)`,
      );
      return count;
    }

    // 3b) Sem fornecedor externo não inventamos catálogo: melhor nenhum
    //     produto novo do que produto que não é produto.
    this.logger.warn(
      'Nenhuma fonte confiável de produtos configurada (EXTERNAL_DATA_*). Nenhum produto ingerido.',
    );
    return count;
  }

  /**
   * Vídeos que efetivamente venderam este produto.
   *
   * O `playbackUrl` NÃO é gravado aqui: a URL assinada do CDN expira em horas
   * e foi a causa dos vídeos que não tocavam. Guardamos `videoUrl` (canônica,
   * estável) e resolvemos o MP4 na hora de exibir, via resolveMedia().
   */
  private async ingestProductVideos(
    product: Product,
    ext: ExternalProduct,
  ): Promise<number> {
    const videos = await this.externalData.fetchProductVideos(
      ext.tiktokProductId,
      10,
    );
    if (videos.length === 0) return 0;

    // O @handle não vem na lista de vídeos, só o user_id — e sem ele a URL do
    // post fica inválida e o embed não abre. 1 request resolve até 10 autores.
    const authors = await this.externalData.fetchCreatorDetails(
      videos.map((v) => v.userId),
    );
    const signed = await this.externalData.signImageUrls(
      videos.map((v) => v.coverUrl).filter((u): u is string => !!u),
    );

    let saved = 0;

    for (const v of videos) {
      if (!v.videoId) continue;
      const handle = authors.get(v.userId)?.handle ?? null;
      const externalId = `echotik-v-${v.videoId}`;
      const video =
        (await this.videos.findOne({ where: { externalId } })) ??
        this.videos.create({ externalId });

      video.caption = v.caption || product.title;
      video.creatorHandle = handle ?? v.userId;
      video.views = v.views;
      video.likes = v.likes;
      // GMV do vídeo vem em USD: converte com o câmbio derivado do produto.
      video.revenueEstimate = this.usdToBrl(v.salesGmvUsd, ext).toFixed(2);
      video.postedAt = v.createdAt.slice(0, 10);
      // Sem @handle a URL do post não existe — melhor nula do que quebrada.
      video.videoUrl = handle
        ? `https://www.tiktok.com/@${handle}/video/${v.videoId}`
        : video.videoUrl;
      video.thumbnailUrl =
        (v.coverUrl ? (signed.get(v.coverUrl) ?? v.coverUrl) : null) ??
        video.thumbnailUrl;
      video.productId = product.id;
      video.category = product.category;
      // Veio da associação de venda: é produto por construção, não "pending".
      video.kind = 'product';

      await this.videos.save(video);
      saved += 1;
    }

    if (saved > 0) {
      this.logger.debug(`${saved} vídeos vinculados a "${product.title.slice(0, 40)}"`);
    }
    return saved;
  }

  /**
   * Criadores que venderam este produto.
   *
   * Duas chamadas por lote: a lista por produto traz GMV real mas NÃO traz o
   * @handle; `influencer/detail` completa em lote de 10.
   */
  private async ingestProductCreators(ext: ExternalProduct): Promise<number> {
    const creators = await this.externalData.fetchProductCreators(
      ext.tiktokProductId,
      10,
    );
    if (creators.length === 0) return 0;

    const details = await this.externalData.fetchCreatorDetails(
      creators.map((c) => c.userId),
    );
    const signedAvatars = await this.externalData.signImageUrls(
      [...details.values()]
        .map((d) => d.avatarUrl)
        .filter((u): u is string => !!u),
    );

    let saved = 0;
    for (const c of creators) {
      const detail = details.get(c.userId);
      // Sem @handle não gravamos: a coluna é única e o perfil ficaria sem link.
      if (!detail) continue;

      const creator =
        (await this.creators.findOne({ where: { externalId: c.userId } })) ??
        (await this.creators.findOne({ where: { handle: detail.handle } })) ??
        this.creators.create({ externalId: c.userId });

      creator.externalId = c.userId;
      creator.handle = detail.handle;
      creator.name = detail.nickName || c.nickName;
      creator.followers = detail.followers || c.followers;
      creator.gmvPeriod = this.usdToBrl(detail.totalGmvUsd, ext).toFixed(2);
      creator.salesPeriod = detail.totalSales;
      creator.category = detail.category ?? c.category ?? 'geral';
      creator.avatarUrl = detail.avatarUrl
        ? (signedAvatars.get(detail.avatarUrl) ?? detail.avatarUrl)
        : (creator.avatarUrl ?? c.avatarUrl);
      creator.source = 'echotik';

      await this.creators.save(creator);
      saved += 1;
    }
    return saved;
  }

  /**
   * O EchoTik devolve GMV em USD mesmo com region=BR. O câmbio é derivado do
   * próprio produto (preço BRL ÷ preço USD) — sem depender de cotação externa.
   */
  private usdToBrl(usd: number, ext: ExternalProduct): number {
    if (!usd) return 0;
    const rate = ext.priceUsd > 0 ? ext.price / ext.priceUsd : 1;
    return usd * rate;
  }

  /**
   * Para cada vídeo de anúncio ainda sem produto: transcreve, extrai o
   * produto e vincula. Limitado por execução para controlar custo de API
   * (Whisper ~US$0,006/min) — o cron cobre o resto nos dias seguintes.
   */
  private async extractProductsFromAds(today: string): Promise<number> {
    if (!this.extractor.enabled) {
      this.logger.warn('OPENAI_API_KEY ausente: extração de produto desligada.');
      return 0;
    }

    const pending = await this.videos.find({
      where: { productId: IsNull(), kind: 'pending' },
      order: { likes: 'DESC' },
      take: 30,
    });

    let created = 0;
    for (const video of pending) {
      if (!video.playbackUrl) continue;

      const transcript = video.transcript ?? (await this.extractor.transcribe(video.playbackUrl));
      if (transcript) video.transcript = transcript;

      // Anúncio em inglês/espanhol não serve para o mercado BR.
      if (transcript && !this.looksPortuguese(transcript)) {
        video.kind = 'other';
        await this.videos.save(video);
        continue;
      }

      const extracted = await this.extractor.extract({
        caption: video.caption ?? '',
        brand: video.creatorHandle ?? null,
        transcript,
      });

      if (!extracted) {
        // Serviço, app, banco ou institucional: sai do radar de produto.
        video.kind = 'other';
        await this.videos.save(video);
        continue;
      }

      // O portão de qualidade vale aqui também: nome extraído ainda pode ser
      // frase de propaganda.
      const gate = evaluateProduct({ title: extracted.name });
      if (!gate.accepted || !gate.cleanTitle) {
        this.logger.debug(`Extraído recusado: "${extracted.name}" (${gate.reason})`);
        video.kind = 'other';
        await this.videos.save(video);
        continue;
      }

      const externalId = `ad-${this.slugify(gate.cleanTitle)}`;
      const product = await this.upsertProduct({
        externalId,
        title: gate.cleanTitle,
        category: extracted.category,
        price: extracted.priceBrl ?? 0,
        imageUrl: video.thumbnailUrl ?? null,
        storeName: video.creatorHandle ?? null,
        tiktokUrl: null,
        radarScore: Math.round(extracted.confidence * 100),
      });

      // O engajamento do anúncio é o sinal que temos: vira métrica do dia.
      await this.upsertDailyMetric(
        product.id,
        today,
        video.likes ?? 0,
        (video.likes ?? 0) * (extracted.priceBrl ?? 60),
      );

      video.productId = product.id;
      video.kind = 'product'; // confirmado: este anúncio vende produto
      await this.videos.save(video);
      created += 1;
      this.logger.log(`Produto extraído do anúncio: "${gate.cleanTitle}"`);
    }
    return created;
  }

  /**
   * Heurística de idioma: conta palavras funcionais do português contra as do
   * inglês/espanhol. Simples de propósito — só precisa separar mercado BR do
   * resto, não classificar idioma com precisão.
   */
  private looksPortuguese(text: string): boolean {
    const sample = text.toLowerCase().slice(0, 600);
    const pt = (
      sample.match(
        /\b(você|voce|não|nao|com|para|isso|aqui|muito|tem|uma|que|por|mais|seu|sua|está|esta|vai|agora|gente)\b/g,
      ) ?? []
    ).length;
    const other = (
      sample.match(
        /\b(the|you|your|and|with|this|that|for|are|have|will|from|what|when|como está|muy|pero|todo|esto)\b/g,
      ) ?? []
    ).length;
    if (pt === 0 && other === 0) return true; // sem fala: não descarta
    return pt >= other;
  }

  // ------------------------------------------------------------------ cota
  //
  // Estratégia: a API paga é chamada SÓ pelo cron (3x ao dia), nunca por
  // request de usuário. O orçamento mensal é dividido pelas execuções que ainda
  // faltam no mês, então o consumo é linear e nunca acaba antes do dia 30.
  // O contador vive no banco para sobreviver a restart e deploy.

  /** Quantos requests esta execução pode gastar. */
  private async openApiAllowance(): Promise<number> {
    const setting = await this.getSetting();
    const monthKey = new Date().toISOString().slice(0, 7);

    // Virou o mês: zera o contador.
    if (setting.apiMonthKey !== monthKey) {
      setting.apiMonthKey = monthKey;
      setting.apiRequestsUsed = 0;
      await this.settings.save(setting);
    }

    // Sem teto configurado, não limitamos (útil no trial e em dev).
    if (setting.apiMonthlyBudget <= 0) return Number.MAX_SAFE_INTEGER;

    const remaining = setting.apiMonthlyBudget - setting.apiRequestsUsed;
    if (remaining <= 0) return 0;

    // Divide o que sobrou pelas execuções restantes do mês, com uma folga de
    // 10% para não gastar tudo e ficar sem margem para reprocessar.
    const now = new Date();
    const daysInMonth = new Date(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      0,
    ).getUTCDate();
    const runsPerDay = this.runsPerDay(setting.cronExpr);
    const runsLeft = Math.max(
      1,
      (daysInMonth - now.getUTCDate() + 1) * runsPerDay,
    );
    return Math.max(1, Math.floor((remaining / runsLeft) * 0.9));
  }

  /** Persiste o consumo depois da execução. */
  private async closeApiAllowance(): Promise<void> {
    const used = this.externalData.requestsUsed;
    if (used <= 0) return;
    const setting = await this.getSetting();
    setting.apiRequestsUsed += used;
    await this.settings.save(setting);
    if (setting.apiMonthlyBudget > 0) {
      const pct = Math.round(
        (setting.apiRequestsUsed / setting.apiMonthlyBudget) * 100,
      );
      this.logger.log(
        `Cota EchoTik: ${setting.apiRequestsUsed}/${setting.apiMonthlyBudget} (${pct}%) em ${setting.apiMonthKey}`,
      );
    }
  }

  /** Conta quantas execuções por dia a expressão cron dispara (campo hora). */
  private runsPerDay(cronExpr: string): number {
    const hour = cronExpr.trim().split(/\s+/)[2];
    if (!hour || hour === '*') return 24;
    if (hour.startsWith('*/')) {
      const step = Number(hour.slice(2));
      return step > 0 ? Math.floor(24 / step) : 1;
    }
    return hour.split(',').filter(Boolean).length || 1;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }

  private async upsertProduct(data: {
    externalId: string;
    title: string;
    category: string;
    price: number;
    imageUrl: string | null;
    images?: string[];
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
    // A URL assinada expira em ~3 dias: sempre sobrescreve com a mais recente.
    if (data.images?.length) product.images = data.images;
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
