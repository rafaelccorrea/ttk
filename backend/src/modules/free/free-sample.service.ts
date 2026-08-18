import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { toRange } from '../../common/format/sales-range';
import { FREE_SAMPLE } from '../billing/billing.config';
import { Creator } from '../creators/entities/creator.entity';
import { ProductFavorite } from '../products/entities/product-favorite.entity';
import { Product } from '../products/entities/product.entity';
import { Video } from '../videos/entities/video.entity';
import { FreeSample } from './entities/free-sample.entity';

/** Um produto como a conta gratuita vê: prova, não entrega. */
export interface FreeProduct {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  price: number;
  /** Faixa de vendas ("25 mil+"), nunca o número exato. */
  salesRange: string;
  /** Crescimento no período, arredondado para inteiro. */
  growthPct: number | null;
  /** Favoritado por esta conta? Favoritar é permitido DENTRO da amostra. */
  isFavorite?: boolean;
}

/**
 * Um criador como a conta gratuita vê.
 *
 * Sem GMV e sem vendas exatas — é o que se paga para saber. Seguidores em
 * faixa, pelo mesmo motivo dos produtos.
 */
export interface FreeCreator {
  id: string;
  handle: string;
  name: string;
  category: string;
  avatarUrl: string | null;
  followersRange: string;
}

/** Um vídeo como a conta gratuita vê: capa, faixas e o link do original. */
export interface FreeVideo {
  id: string;
  caption: string;
  creatorHandle: string;
  category: string;
  thumbnailUrl: string | null;
  viewsRange: string;
  likesRange: string;
  postedAt: string;
  /** Link para o TikTok. Não servimos playback para quem não paga. */
  videoUrl: string | null;
}

export interface FreeSnapshot {
  products: FreeProduct[];
  videos: FreeVideo[];
  creators: FreeCreator[];
  /** Quando a amostra troca. A tela anuncia isso em vez de esconder. */
  refreshAt: string;
  limits: {
    products: number;
    videos: number;
    creators: number;
    refreshDays: number;
  };
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A amostra da conta gratuita — ver `docs/CONTA-FREE.md`.
 *
 * Três invariantes sustentam o modo inteiro, e cada uma tem um teste:
 *
 *  1. **Global e congelada.** Um único conjunto por janela de 7 dias, igual
 *     para todas as contas. F5 não revela item novo; conta nova não revela
 *     nada. É o que dispensa qualquer defesa contra multi-conta.
 *  2. **Sem parâmetro.** Nenhuma busca, filtro, ordenação ou paginação — é
 *     parâmetro que transforma amostra em ferramenta, e o limite de 20 não
 *     protegeria nada contra um `search`.
 *  3. **O detalhe é fechado ao conjunto.** Um id fora da amostra responde 403.
 *     Sem isso o limite é decorativo: bastaria descobrir ids (a vitrine pública
 *     já expõe alguns) para transformar o detalhe em consulta ilimitada.
 *
 * O que este serviço NÃO faz: chamar fornecedor. Tudo sai do que já está
 * ingerido no banco, então uma conta gratuita custa zero por visita — que é a
 * razão de a conta gratuita ter sido removida da primeira vez.
 */
@Injectable()
export class FreeSampleService {
  private readonly logger = new Logger(FreeSampleService.name);

  constructor(
    @InjectRepository(FreeSample)
    private readonly samples: Repository<FreeSample>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    @InjectRepository(Creator)
    private readonly creators: Repository<Creator>,
    /*
     * Favoritar é a única ESCRITA que a conta gratuita faz no catálogo, e ela
     * é barata (uma linha) e cria hábito — por isso está liberada, desde que
     * dentro da amostra (ver `alternarFavorito`).
     */
    @InjectRepository(ProductFavorite)
    private readonly favoritos: Repository<ProductFavorite>,
  ) {}

  /**
   * Janela atual, alinhada à época Unix.
   *
   * Alinhar à época (e não à primeira geração) é o que faz a troca acontecer no
   * mesmo instante para todo mundo: sem isso, a data de rotação passaria a
   * depender de qual visitante acordou o snapshot primeiro — e uma promessa de
   * "atualiza em N dias" que varia por servidor não é uma promessa.
   */
  private slotAtual(now = Date.now()): number {
    return Math.floor(now / (DIA_MS * FREE_SAMPLE.refreshDays));
  }

  private expiraEm(slot: number): Date {
    return new Date((slot + 1) * DIA_MS * FREE_SAMPLE.refreshDays);
  }

  /**
   * A amostra vigente, gerando-a se a janela ainda estiver vazia.
   *
   * A troca é por EXPIRAÇÃO, não por agendador. Existe um job semanal, mas ele
   * é só aquecimento: quem decide é o slot lido na requisição. Um produto que
   * depende do cron para funcionar quebra em silêncio no primeiro domingo em
   * que o cron não rodar.
   */
  async currentSample(): Promise<FreeSample> {
    const slot = this.slotAtual();
    const existente = await this.samples.findOneBy({ slot });
    if (existente) return existente;

    const [productIds, videoIds, creatorIds] = await Promise.all([
      this.escolherProdutos(),
      this.escolherVideos(),
      this.escolherCriadores(),
    ]);

    try {
      return await this.samples.save(
        this.samples.create({
          slot,
          expiresAt: this.expiraEm(slot),
          productIds,
          videoIds,
          creatorIds,
        }),
      );
    } catch {
      /*
       * Corrida perdida: outra requisição gravou o snapshot desta janela entre
       * o SELECT e o INSERT, e o UNIQUE de `slot` recusou o segundo. Ler de
       * volta é a resposta certa — o conjunto tem que ser o mesmo para os dois
       * usuários, e "o meu foi o segundo" não é motivo para eles verem listas
       * diferentes na mesma semana.
       */
      const gravado = await this.samples.findOneBy({ slot });
      if (gravado) return gravado;
      throw new Error(`Não foi possível gerar a amostra gratuita (slot ${slot})`);
    }
  }

  /**
   * O snapshot já formatado para a tela.
   *
   * `userId` entra só para marcar o que esta conta favoritou — o CONJUNTO é o
   * mesmo para todo mundo, e continua sendo. É a única coisa nesta resposta
   * que varia por usuário, e ela não revela nada do catálogo.
   */
  async snapshot(userId?: string): Promise<FreeSnapshot> {
    const sample = await this.currentSample();
    const [products, videos, creators] = await Promise.all([
      this.hidratarProdutos(sample.productIds, userId),
      this.hidratarVideos(sample.videoIds),
      this.hidratarCriadores(sample.creatorIds ?? []),
    ]);
    return {
      products,
      videos,
      creators,
      refreshAt: sample.expiresAt.toISOString(),
      limits: {
        products: FREE_SAMPLE.products,
        videos: FREE_SAMPLE.videos,
        creators: FREE_SAMPLE.creators,
        refreshDays: FREE_SAMPLE.refreshDays,
      },
    };
  }

  /**
   * Favoritos desta conta — só os que estão na amostra vigente.
   *
   * O filtro pela amostra não é detalhe: um produto favoritado numa semana pode
   * sair da amostra na seguinte, e devolvê-lo assim mesmo transformaria a lista
   * de favoritos num jeito de acumular catálogo semana após semana — 20 itens
   * por semana viram 80 por mês, e o limite deixaria de existir.
   */
  async listarFavoritos(userId: string): Promise<FreeProduct[]> {
    const sample = await this.currentSample();
    const marcados = await this.favoritos.find({ where: { userId } });
    const naAmostra = marcados
      .map((f) => f.productId)
      .filter((id) => sample.productIds.includes(id));
    return this.hidratarProdutos(naAmostra, userId);
  }

  /**
   * Favoritar/desfavoritar — 403 fora da amostra.
   *
   * Sem a checagem, o toggle viraria uma forma silenciosa de confirmar que um
   * id existe no catálogo: bastaria favoritar um uuid qualquer e ver se deu
   * certo. É a mesma trava do detalhe, pela mesma razão.
   */
  async alternarFavorito(
    userId: string,
    productId: string,
  ): Promise<{ isFavorite: boolean }> {
    const sample = await this.currentSample();
    if (!sample.productIds.includes(productId)) throw this.foraDaAmostra();
    const existente = await this.favoritos.findOneBy({ userId, productId });
    if (existente) {
      await this.favoritos.delete({ id: existente.id });
      return { isFavorite: false };
    }
    await this.favoritos.save(this.favoritos.create({ userId, productId }));
    return { isFavorite: true };
  }

  /** Detalhe do produto — 403 fora da amostra (invariante 3). */
  async produto(id: string, userId?: string): Promise<FreeProduct> {
    const sample = await this.currentSample();
    if (!sample.productIds.includes(id)) throw this.foraDaAmostra();
    const [item] = await this.hidratarProdutos([id], userId);
    if (!item) throw this.foraDaAmostra();
    return item;
  }

  /** Detalhe do vídeo — mesma regra. */
  async video(id: string): Promise<FreeVideo> {
    const sample = await this.currentSample();
    if (!sample.videoIds.includes(id)) throw this.foraDaAmostra();
    const [item] = await this.hidratarVideos([id]);
    if (!item) throw this.foraDaAmostra();
    return item;
  }

  /*
   * A mesma mensagem para "não está na amostra" e para "sumiu do catálogo".
   *
   * Distinguir os dois casos entregaria de graça o que a amostra esconde: um
   * 404 confirmaria que o id existe na base e um 403 diria que não — um
   * varredor de ids mapearia o catálogo inteiro sem ver um produto sequer.
   */
  private foraDaAmostra(): ForbiddenException {
    return new ForbiddenException(
      'Este item está fora da amostra gratuita. Assine para ver o catálogo completo.',
    );
  }

  /**
   * Os produtos da janela: topo do ranking de 30 dias, com teto por categoria.
   *
   * O `ROW_NUMBER` particionado é o que impede a amostra de virar vinte itens
   * do mesmo nicho. `imageUrl IS NOT NULL` porque a amostra é, antes de tudo,
   * uma vitrine: um card sem foto prova menos que card nenhum.
   */
  private async escolherProdutos(): Promise<string[]> {
    const rows = await this.products.query(
      `
      WITH ranked AS (
        SELECT p.id,
               p."sales30d" AS sales,
               ROW_NUMBER() OVER (
                 PARTITION BY p.category ORDER BY p."sales30d" DESC, p.id ASC
               ) AS rn
          FROM products p
         WHERE p."isDuplicate" = false
           AND p."imageUrl" IS NOT NULL
      )
      SELECT id FROM ranked
       WHERE rn <= $1
       ORDER BY sales DESC, id ASC
       LIMIT $2
      `,
      [FREE_SAMPLE.maxPorCategoria, FREE_SAMPLE.products],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  /**
   * Os vídeos da janela. Só `kind = 'product'`: 'pending' é anúncio que ainda
   * não sabemos se vende produto, e a amostra não é lugar de aposta.
   */
  private async escolherVideos(): Promise<string[]> {
    const rows = await this.videos.query(
      `
      WITH ranked AS (
        SELECT v.id,
               v.views,
               ROW_NUMBER() OVER (
                 PARTITION BY v.category ORDER BY v.views DESC, v.id ASC
               ) AS rn
          FROM videos v
         WHERE v.kind = 'product'
      )
      SELECT id FROM ranked
       WHERE rn <= $1
       ORDER BY views DESC, id ASC
       LIMIT $2
      `,
      [FREE_SAMPLE.maxPorCategoria, FREE_SAMPLE.videos],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  /**
   * Os criadores da janela: a CAUDA do ranking.
   *
   * O ranking pago ordena por GMV decrescente; aqui pegamos o fim da fila entre
   * os perfis reais do TikTok (`source`), e depois exibimos na ordem natural.
   * É deliberado: o valor da tela paga é saber QUEM fatura mais, e entregar os
   * cinco primeiros seria entregar a resposta. A cauda mostra que a base existe
   * e como é a ficha, sem dar o ranking.
   *
   * O filtro exclui `seed` (dado de demonstração), e é por EXCLUSÃO e não por
   * lista: a primeira versão exigia `source = 'tiktok'` e devolvia zero
   * criadores em produção, onde a coleta grava `echotik`. Filtro que enumera
   * as fontes boas quebra em silêncio a cada fonte nova; filtro que exclui as
   * ruins só deixa de valer quando alguém cria uma fonte ruim nova.
   */
  private async escolherCriadores(): Promise<string[]> {
    const rows = await this.creators.query(
      `
      SELECT id FROM creators
       WHERE source <> 'seed'
       ORDER BY "gmvPeriod" ASC, id ASC
       LIMIT $1
      `,
      [FREE_SAMPLE.creators],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  private async hidratarCriadores(ids: string[]): Promise<FreeCreator[]> {
    if (!ids.length) return [];
    const rows = await this.creators.find({ where: { id: In(ids) } });
    const porId = new Map(rows.map((c) => [c.id, c]));
    return ids
      .map((id) => porId.get(id))
      .filter((c): c is Creator => Boolean(c))
      .map((c) => ({
        id: c.id,
        handle: c.handle,
        name: c.name,
        category: c.category,
        avatarUrl: c.avatarUrl ?? null,
        // Faixa, como em todo o resto da amostra: dá a ordem de grandeza sem
        // virar planilha.
        followersRange: toRange(c.followers),
      }));
  }

  /**
   * Ids → cards, preservando a ordem congelada.
   *
   * O `IN` do Postgres não devolve na ordem da lista, e a ordem faz parte do
   * que está congelado: uma amostra que embaralha a cada carregamento parece
   * uma lista viva, que é justamente a impressão que este modo não pode dar.
   *
   * Item que sumiu do catálogo simplesmente encolhe a amostra até a próxima
   * janela — é melhor do que um card quebrado, e é por isso que os ids não têm
   * FK.
   */
  private async hidratarProdutos(
    ids: string[],
    userId?: string,
  ): Promise<FreeProduct[]> {
    if (!ids.length) return [];
    const rows = await this.products.find({ where: { id: In(ids) } });
    const porId = new Map(rows.map((p) => [p.id, p]));
    const favoritos = userId
      ? new Set(
          (await this.favoritos.find({ where: { userId } })).map(
            (f) => f.productId,
          ),
        )
      : new Set<string>();
    return ids
      .map((id) => porId.get(id))
      .filter((p): p is Product => Boolean(p))
      .map((p) => ({
        id: p.id,
        title: p.title,
        category: p.category,
        imageUrl: p.imageUrl,
        price: Number(p.price),
        salesRange: toRange(p.sales30d),
        growthPct: this.crescimento(p),
        isFavorite: favoritos.has(p.id),
      }));
  }

  private async hidratarVideos(ids: string[]): Promise<FreeVideo[]> {
    if (!ids.length) return [];
    const rows = await this.videos.find({
      where: { id: In(ids) },
      relations: { product: true },
    });
    const porId = new Map(rows.map((v) => [v.id, v]));
    return ids
      .map((id) => porId.get(id))
      .filter((v): v is Video => Boolean(v))
      .map((v) => ({
        id: v.id,
        caption: v.caption,
        creatorHandle: v.creatorHandle,
        category: v.category,
        // Foto do produto como capa de reserva: card sem imagem não é vitrine.
        thumbnailUrl: v.thumbnailUrl ?? v.product?.imageUrl ?? null,
        viewsRange: toRange(v.views),
        likesRange: toRange(v.likes),
        postedAt: v.postedAt,
        videoUrl: v.videoUrl ?? null,
      }));
  }

  /**
   * Crescimento de 30 dias contra a janela anterior — a mesma conta do ranking
   * pago (`sales60d - sales30d` é o que sobra entre 60 e 30 dias). Sem base de
   * comparação devolve `null`, e não zero: "não sei" e "não cresceu" são coisas
   * diferentes na tela.
   */
  private crescimento(p: Product): number | null {
    const anterior = p.sales60d - p.sales30d;
    if (anterior <= 0) return null;
    return Math.round(((p.sales30d - anterior) * 100) / anterior);
  }

  /**
   * Aquecimento da janela.
   *
   * Roda todo dia, mas só trabalha quando a janela virou — `currentSample()` é
   * idempotente dentro do slot. Diário e não semanal porque um job semanal que
   * cai é um job que perde a única chance da semana; este perde uma tentativa e
   * tenta de novo em 24h.
   *
   * Não decide nada: só paga o custo da geração antes do primeiro visitante,
   * para que ele não espere pela query de ranking. Se falhar, o pior caso é o
   * que já era o comportamento normal — o primeiro acesso gera.
   */
  @Cron('0 4 * * *')
  async warmUp(): Promise<void> {
    try {
      const sample = await this.currentSample();
      this.logger.log(
        `Amostra gratuita da janela ${sample.slot}: ${sample.productIds.length} produtos, ${sample.videoIds.length} vídeos, ${(sample.creatorIds ?? []).length} criadores.`,
      );
    } catch (e) {
      this.logger.warn(`Falha ao aquecer a amostra gratuita: ${e}`);
    }
  }
}
