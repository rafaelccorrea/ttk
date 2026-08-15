import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExternalDataProvider } from '../ingestion/external-data.provider';
import { MediaMirrorService } from '../media/media-mirror.service';
import { QueryVideosDto } from './dto/query-videos.dto';
import { SavedVideo } from './entities/saved-video.entity';
import { Video } from './entities/video.entity';

export interface VideoItem {
  id: string;
  caption: string;
  creatorHandle: string;
  views: number;
  likes: number;
  revenueEstimate: number;
  postedAt: string;
  transcript: string | null;
  productId: string | null;
  category: string;
  isSaved: boolean;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  playbackUrl: string | null;
  /** Foto do produto associado: capa de fallback quando não há thumbnail. */
  productImageUrl: string | null;
}

/** Validade do cache da vitrine — curto o bastante para não servir dado velho. */
const SECTIONS_TTL_MS = 60 * 1000;

@Injectable()
export class VideosService {
  /**
   * Cache do resultado bruto da vitrine, compartilhado entre requisições.
   * Guarda só as LINHAS do banco; a marcação de "salvo" continua por usuário.
   */
  private static readonly sectionsCache = new Map<
    string,
    { rows: any[]; expiresAt: number }
  >();

  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    @InjectRepository(SavedVideo)
    private readonly savedVideos: Repository<SavedVideo>,
    private readonly externalData: ExternalDataProvider,
    private readonly mirror: MediaMirrorService,
  ) {}

  /**
   * Categorias que realmente têm vídeo, para montar o filtro da tela.
   * Sai do banco (e não da lista fixa) para não oferecer opção que não
   * devolveria nenhum resultado.
   */
  async categories(): Promise<string[]> {
    const rows = await this.videos
      .createQueryBuilder('v')
      .select('DISTINCT v.category', 'category')
      .where('v.category IS NOT NULL')
      .orderBy('category', 'ASC')
      .getRawMany<{ category: string }>();
    return rows.map((r) => r.category).filter(Boolean);
  }

  /**
   * Vídeos agrupados em seções por categoria — mesma vitrine dos produtos.
   *
   * Numa query só, com `ROW_NUMBER` particionado: buscar categoria a categoria
   * seriam dezenas de idas ao banco por carregamento de tela.
   */
  async sections(
    perSection = 12,
    maxSections = 10,
    userId?: string,
    /** Abaixo disso a categoria não vira seção. */
    minItems = 4,
    /** Quantas seções pular — cursor do scroll infinito. */
    offsetSections = 0,
  ): Promise<{
    sections: Array<{ category: string; total: number; items: VideoItem[] }>;
    /** Há mais seções depois desta página. */
    hasMore: boolean;
  }> {
    // A janela do ROW_NUMBER varre a tabela inteira e custa ~2s. Como o scroll
    // infinito pede lote após lote com os MESMOS parâmetros (só muda o
    // offset), guardamos o resultado por pouco tempo: a primeira rolagem paga,
    // as seguintes vêm de memória.
    const cacheKey = `sections:${perSection}`;
    const cached = VideosService.sectionsCache.get(cacheKey);
    const rows: Array<
      Video & { categoryTotal: string; productImageUrl: string | null }
    > = cached && cached.expiresAt > Date.now()
      ? cached.rows
      : await this.videos.query(
        `
        WITH ranked AS (
          SELECT v.*,
                 -- Foto do produto: é o fallback do card quando o vídeo não
                 -- tem thumbnail própria. Sem este join o card cai no
                 -- gradiente de categoria, que fica horrível na vitrine.
                 p."imageUrl" AS "productImageUrl",
                 ROW_NUMBER() OVER (
                   PARTITION BY v.category ORDER BY v.views DESC, v.id ASC
                 ) AS rn,
                 COUNT(*) OVER (PARTITION BY v.category)   AS "categoryTotal",
                 SUM(v.views) OVER (PARTITION BY v.category) AS "categoryViews"
            FROM videos v
            LEFT JOIN products p ON p.id = v."productId"
           WHERE v.kind = 'product' AND v.category IS NOT NULL
        )
        SELECT * FROM ranked
         WHERE rn <= $1
         ORDER BY "categoryViews" DESC, category ASC, rn ASC
        `,
        [perSection],
      );

    if (!cached || cached.expiresAt <= Date.now()) {
      VideosService.sectionsCache.set(cacheKey, {
        rows,
        expiresAt: Date.now() + SECTIONS_TTL_MS,
      });
    }

    const savedIds = userId
      ? new Set(
          (await this.savedVideos.find({ where: { userId } })).map(
            (s) => s.videoId,
          ),
        )
      : new Set<string>();

    const byCategory = new Map<
      string,
      { category: string; total: number; items: VideoItem[] }
    >();
    for (const row of rows) {
      let section = byCategory.get(row.category);
      if (!section) {
        section = {
          category: row.category,
          total: Number(row.categoryTotal),
          items: [],
        };
        byCategory.set(row.category, section);
      }
      // A query traz `productImageUrl` em coluna própria (não pela relação),
      // então injeta no formato que o `toItem` espera.
      section.items.push({
        ...this.toItem(row, savedIds),
        productImageUrl: row.productImageUrl ?? null,
      });
    }

    const elegiveis = [...byCategory.values()]
      // Compara com o TOTAL da categoria, não com a lista truncada: senão
      // pedir `perSection` menor que `minItems` zera todas as seções.
      .filter((s) => s.total >= minItems);

    return {
      sections: elegiveis.slice(offsetSections, offsetSections + maxSections),
      hasMore: offsetSections + maxSections < elegiveis.length,
    };
  }

  /**
   * Devolve um MP4 tocável para o vídeo.
   *
   * Por que não fica no banco: a URL que a TikTok assina expira em poucas horas
   * (a que vem na listagem do fornecedor já chega vencida, respondendo 403) —
   * era exatamente por isso que o player não abria.
   *
   * Ordem de preferência:
   *  1. `playbackUrl` já espelhado no S3 — permanente, não custa cota;
   *  2. resolve no fornecedor e espelha, passando a valer para sempre;
   *  3. resolve no fornecedor e devolve a URL temporária (sem S3 configurado).
   */
  async resolvePlayback(id: string): Promise<{
    playbackUrl: string | null;
    permanent: boolean;
    /**
     * Player oficial do TikTok. Sempre presente quando conhecemos o id, e é o
     * que garante que o vídeo TOQUE mesmo sem cota no fornecedor — sem ele, o
     * card fica preto quando a API paga não responde.
     */
    embedUrl: string | null;
  }> {
    const video = await this.videos.findOneBy({ id });
    if (!video) throw new NotFoundException(`Vídeo ${id} não encontrado`);

    // `externalId` guarda "echotik-v-<video_id>".
    const tiktokId =
      video.externalId?.replace(/^echotik-v-/, '') ??
      video.videoUrl?.match(/\/video\/(\d+)/)?.[1] ??
      null;
    const embedUrl = /^\d+$/.test(tiktokId ?? '')
      ? `https://www.tiktok.com/embed/v2/${tiktokId}`
      : null;

    // Espelhado no S3: permanente, nada a resolver.
    if (video.playbackUrl && video.playbackExpiresAt === null) {
      return { playbackUrl: video.playbackUrl, permanent: true, embedUrl };
    }

    // URL temporária ainda válida: evita os 6–17s da chamada ao fornecedor.
    if (video.playbackUrl && (video.playbackExpiresAt?.getTime() ?? 0) > Date.now()) {
      return { playbackUrl: video.playbackUrl, permanent: false, embedUrl };
    }

    if (!tiktokId) {
      return { playbackUrl: video.playbackUrl ?? null, permanent: false, embedUrl };
    }

    const media = await this.externalData.resolveMedia(tiktokId);
    if (!media) {
      // Sem cota o MP4 não vem — o embed assume e o vídeo toca assim mesmo.
      return { playbackUrl: video.playbackUrl ?? null, permanent: false, embedUrl };
    }

    // Sem marca d'água quando o fornecedor entrega; senão o play normal.
    const source = media.playUrl;

    // Aproveita para corrigir a URL canônica, se ainda faltava.
    if (!video.videoUrl && media.homeUrl) video.videoUrl = media.homeUrl;

    if (this.mirror.enabled) {
      const mirrored = await this.mirror.mirror(source, 'videos', tiktokId);
      if (mirrored) {
        video.playbackUrl = mirrored;
        video.playbackExpiresAt = null; // nossa URL, não expira
        await this.videos.save(video);
        return { playbackUrl: mirrored, permanent: true, embedUrl };
      }
    }

    // Sem S3: guarda a URL temporária com validade conservadora. A assinatura
    // da TikTok dura horas; 2h dá margem de sobra antes de renovar.
    video.playbackUrl = source;
    video.playbackExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await this.videos.save(video);

    return { playbackUrl: source, permanent: false, embedUrl };
  }

  private toItem(video: Video, savedIds: Set<string>): VideoItem {
    return {
      id: video.id,
      caption: video.caption,
      creatorHandle: video.creatorHandle,
      views: video.views,
      likes: video.likes,
      revenueEstimate: Number(video.revenueEstimate),
      postedAt: video.postedAt,
      transcript: video.transcript,
      productId: video.productId,
      category: video.category,
      isSaved: savedIds.has(video.id),
      videoUrl: video.videoUrl ?? null,
      thumbnailUrl: video.thumbnailUrl ?? null,
      playbackUrl: video.playbackUrl ?? null,
      productImageUrl: video.product?.imageUrl ?? null,
    };
  }

  async list(
    query: QueryVideosDto,
    userId: string,
  ): Promise<{ items: VideoItem[]; total: number; page: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;

    const savedIds = new Set(
      (await this.savedVideos.find({ where: { userId } })).map(
        (s) => s.videoId,
      ),
    );

    // Desempate por id para paginação estável (sort do Postgres não é estável).
    const qb = this.videos
      .createQueryBuilder('v')
      // Traz o produto para usar a foto dele como capa quando falta thumbnail.
      .leftJoinAndSelect('v.product', 'product')
      .orderBy('v.views', 'DESC')
      .addOrderBy('v.id', 'ASC');

    if (query.saved) {
      if (savedIds.size === 0) {
        return { items: [], total: 0, page };
      }
      qb.andWhere('v.id IN (:...savedIds)', { savedIds: [...savedIds] });
    }
    if (query.productId) {
      qb.andWhere('v.productId = :productId', { productId: query.productId });
    }
    if (query.category) {
      qb.andWhere('v.category = :category', { category: query.category });
    }
    if (query.kind) {
      qb.andWhere('v.kind = :kind', { kind: query.kind });
    } else if (!query.saved && !query.productId) {
      // Vídeos que Vendem = só anúncio confirmado como venda de produto.
      // 'pending' (ainda não analisado) e 'other' (serviço/app/outro idioma)
      // ficam de fora — era o que trazia "Ton", "Inverno" e anúncio em inglês.
      qb.andWhere('v.kind = :defaultKind', { defaultKind: 'product' });
    }
    // Vídeo sem mídia não abre e frustra o usuário ("não consigo executar
    // nenhum vídeo"). Por padrão listamos só o que realmente reproduz.
    if (query.playable !== false && !query.saved) {
      qb.andWhere(
        '(v."playbackUrl" IS NOT NULL OR v."videoUrl" IS NOT NULL)',
      );
    }
    if (query.search) {
      qb.andWhere('(v.caption ILIKE :search OR v.creatorHandle ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items: rows.map((v) => this.toItem(v, savedIds)), total, page };
  }

  async findOne(id: string, userId: string) {
    const video = await this.videos.findOne({
      where: { id },
      relations: { product: true },
    });
    if (!video) {
      throw new NotFoundException(`Vídeo ${id} não encontrado`);
    }
    const isSaved = Boolean(
      await this.savedVideos.findOneBy({ userId, videoId: id }),
    );
    return {
      ...this.toItem(video, isSaved ? new Set([id]) : new Set<string>()),
      product: video.product
        ? {
            id: video.product.id,
            title: video.product.title,
            category: video.product.category,
            price: Number(video.product.price),
            imageUrl: video.product.imageUrl,
          }
        : null,
    };
  }

  async toggleSave(
    userId: string,
    videoId: string,
  ): Promise<{ isSaved: boolean }> {
    const existing = await this.savedVideos.findOneBy({ userId, videoId });
    if (existing) {
      await this.savedVideos.delete({ id: existing.id });
      return { isSaved: false };
    }
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video) {
      throw new NotFoundException(`Vídeo ${videoId} não encontrado`);
    }
    await this.savedVideos.save(this.savedVideos.create({ userId, videoId }));
    return { isSaved: true };
  }
}
