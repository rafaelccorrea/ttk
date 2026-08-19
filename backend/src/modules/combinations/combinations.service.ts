import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { VideoAssemblyService } from '../campaigns/video-assembly.service';
import { MEDIA_ROUTE, MediaMirrorService } from '../media/media-mirror.service';
import { FAIXAS, situacao } from './clip-timing';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ClipRole, CombinationClip } from './entities/combination-clip.entity';
import { CombinationFolder } from './entities/combination-folder.entity';
import { CombinationPlan } from './entities/combination-plan.entity';
import {
  CombinationOriginality,
  CombinationVideo,
} from './entities/combination-video.entity';

export interface Combination {
  code: string;
  filename: string;
  hook: string;
  body: string;
  cta: string;
  /** Quão repetido este vídeo é em relação aos anteriores na ordem sugerida. */
  originality: CombinationOriginality;
  /** Posição na ordem recomendada de postagem, começando em 1. */
  postOrder: number;
}

/**
 * Um produto na galeria, com todos os vídeos que ele já rendeu.
 *
 * A galeria era uma lista corrida de até 300 arquivos de todos os produtos
 * misturados, ordenada por data — com dois ou três produtos em teste ao mesmo
 * tempo, achar "os criativos da cinta" virava rolar a tela procurando prefixo
 * de nome de arquivo. Agrupar por plano devolve a unidade com que o vendedor
 * realmente trabalha.
 */
export interface GaleriaGrupo {
  planId: string;
  sigla: string;
  format: string | null;
  /** `false` quando o plano foi apagado mas os vídeos continuam guardados. */
  planoExiste: boolean;
  /** Data do vídeo mais recente do grupo — é por ela que os grupos se ordenam. */
  atualizadoEm: Date;
  videos: CombinationVideo[];
}

/** Uma peça (gancho, corpo ou CTA) com o que os vídeos dela renderam. */
export interface PecaInsight {
  indice: number;
  /** `G2`, `C1`, `A3` — o mesmo código que aparece no nome do arquivo. */
  codigo: string;
  rotulo: string;
  /** Quantos vídeos com resultado lançado usam esta peça. */
  videos: number;
  /** `null` quando nenhum vídeo desta peça teve views lançadas. */
  mediaViews: number | null;
  totalVendas: number | null;
  /**
   * `true` quando a média vem de poucos vídeos para ser levada a sério.
   *
   * Uma peça com 1 vídeo de sorte encabeça o ranking com a mesma cara de quem
   * ganhou 15 vezes seguidas — e é justamente sobre o topo do ranking que o
   * vendedor decide o que gravar de novo. A peça continua ordenada pela média
   * (esconder seria pior), mas a tela precisa poder dizer "ainda é palpite".
   */
  dadoFraco: boolean;
}

export interface PlanoInsights {
  planId: string;
  sigla: string;
  videosLancados: number;
  videosTotais: number;
  mediaGeralViews: number | null;
  /** Quantos vídeos uma peça precisa ter para sair de `dadoFraco`. */
  minimoConfiavel: number;
  blocos: Record<'hook' | 'body' | 'cta', PecaInsight[]>;
}

/** Contagem lançada: inteiro não-negativo, ou `null` para "não informado". */
function normalizarContagem(valor: number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const n = Math.trunc(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Vídeos lançados que uma peça precisa para a média valer como sinal.
 *
 * Três é baixo de propósito: com a matriz cheia cada gancho aparece em 15
 * combinações, mas o vendedor lança resultado aos poucos, e exigir dez seria
 * manter o ranking em "aguardando dados" justamente quando ele decide o que
 * gravar. Três já separa "aconteceu duas vezes" de "aconteceu uma vez".
 */
const MIN_VIDEOS_CONFIAVEL = 3;

/** Teto de vídeos trazidos para a galeria de uma vez. */
const GALERIA_MAX = 300;

/** Teto de pastas por usuário — acima disso a barra lateral deixa de ajudar. */
const MAX_PASTAS = 30;

/**
 * Só aceita `#rrggbb`.
 *
 * A cor vai direto para o `style` de um chip; sem esta checagem qualquer texto
 * enviado pelo cliente entraria no CSS da página.
 */
function normalizarCor(cor: string | undefined): string {
  return cor && /^#[0-9a-fA-F]{6}$/.test(cor) ? cor.toLowerCase() : '#fe2c55';
}

/** Teto por bloco — o mesmo que a tela oferece. */
const LIMITES: Record<ClipRole, number> = { hook: 10, body: 5, cta: 3 };

/** A letra que cada bloco recebe no código do arquivo (`G2C1A3`). */
const LETRA: Record<ClipRole, string> = { hook: 'G', body: 'C', cta: 'A' };

/**
 * Quantos vídeos uma montagem produz de uma vez.
 *
 * 10 × 5 × 3 dá 150 arquivos — a matriz cheia que a tela oferece. O teto é
 * exatamente esse número, e não menos: prometer 10 ganchos, 5 corpos e 3 CTAs
 * e depois recusar a combinação completa é vender o que não se entrega.
 *
 * Cada arquivo custa alguns segundos de ffmpeg no mesmo processo que atende a
 * API, então a fila roda um por vez (ver `montarTudo`) e a resposta sai antes,
 * com as linhas `pendente`. O teto existe só para barrar um plano corrompido
 * com mais itens do que os blocos permitem.
 */
const MAX_VIDEOS_POR_MONTAGEM =
  LIMITES.hook * LIMITES.body * LIMITES.cta; // 150

/** Resolução final por formato. */
const DIMENSOES = {
  '9:16': { largura: 1080, altura: 1920 },
  '16:9': { largura: 1920, altura: 1080 },
  '1:1': { largura: 1080, altura: 1080 },
} as const;

@Injectable()
export class CombinationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CombinationsService.name);

  /** Planos já em montagem, para um segundo clique não duplicar o trabalho. */
  private readonly montando = new Set<string>();

  constructor(
    @InjectRepository(CombinationPlan)
    private readonly plans: Repository<CombinationPlan>,
    @InjectRepository(CombinationClip)
    private readonly clips: Repository<CombinationClip>,
    @InjectRepository(CombinationVideo)
    private readonly videos: Repository<CombinationVideo>,
    @InjectRepository(CombinationFolder)
    private readonly folders: Repository<CombinationFolder>,
    private readonly mirror: MediaMirrorService,
    private readonly assembly: VideoAssemblyService,
    private readonly billing: BillingService,
  ) {}

  /**
   * Devolve o crédito de montagens que o servidor não terminou.
   *
   * A cobrança acontece na entrada e a fila roda em segundo plano, então um
   * deploy (ou qualquer queda) no meio de uma matriz deixa linhas presas em
   * `pendente`/`montando` com o crédito já debitado e sem ninguém para
   * estornar — numa matriz de 150 isso é a carteira do cliente evaporando por
   * causa de um restart nosso.
   *
   * Roda no boot porque é exatamente aí que se sabe que ninguém sobreviveu:
   * `montando` só é escrito por um processo vivo, e este acabou de nascer.
   */
  async onApplicationBootstrap(): Promise<void> {
    const presos = await this.videos.find({
      where: [{ status: 'pendente' }, { status: 'montando' }],
    });
    if (!presos.length) return;

    let estornados = 0;
    for (const linha of presos) {
      /*
       * O UPDATE condicional é o que impede o estorno em dobro num deploy
       * rolling: duas instâncias subindo juntas leem a mesma lista de presos
       * antes de qualquer gravação, e sem a condição de status as duas
       * devolveriam o crédito da mesma linha. Só quem tira a linha de
       * `pendente`/`montando` é que paga o estorno.
       */
      const marcou = await this.videos.update(
        { id: linha.id, status: In(['pendente', 'montando']) },
        {
          status: 'falhou',
          error:
            'A montagem foi interrompida (o servidor reiniciou). O crédito foi devolvido — clique em Montar vídeos de novo.',
        },
      );
      if (!marcou.affected) continue;
      estornados += 1;
      await this.billing
        .refund(
          linha.userId,
          'assembly',
          `Estorno: ${linha.filename} não terminou de montar`,
        )
        .catch((e) =>
          this.logger.error(`Falha no estorno de ${linha.code}: ${e}`),
        );
    }
    if (estornados) {
      this.logger.warn(
        `${estornados} montagem(ns) interrompida(s) por reinício: estornadas.`,
      );
    }
  }

  // ------------------------------------------------------------- resultados

  /**
   * Lança (ou apaga) o desempenho de um vídeo publicado.
   *
   * Passar `null` num campo limpa o valor — é como o vendedor desfaz um número
   * digitado errado sem precisar de outra rota.
   */
  async setResult(
    userId: string,
    id: string,
    dados: { views?: number | null; sales?: number | null; postUrl?: string | null },
  ): Promise<CombinationVideo> {
    const video = await this.videos.findOneBy({ id, userId });
    if (!video) throw new NotFoundException(`Vídeo ${id} não encontrado`);

    if (dados.views !== undefined) video.views = normalizarContagem(dados.views);
    if (dados.sales !== undefined) video.sales = normalizarContagem(dados.sales);
    if (dados.postUrl !== undefined) {
      const url = dados.postUrl?.trim();
      video.postUrl = url ? url.slice(0, 500) : null;
    }
    return this.videos.save(video);
  }

  /**
   * Lança o desempenho de vários vídeos numa tacada.
   *
   * O `setResult` de um vídeo por vez é o que mantinha o `insights` vazio na
   * prática: ninguém abre 150 diálogos para digitar 150 números, então o dado
   * que faz a análise funcionar nunca chegava. Aqui a tela manda a planilha
   * inteira de uma vez e o vendedor digita numa sentada só.
   *
   * Cada item é opcional em cada campo, igual ao lançamento individual —
   * mandar `views` sem `sales` não apaga as vendas já lançadas.
   */
  async setResultsBulk(
    userId: string,
    itens: Array<{
      id: string;
      views?: number | null;
      sales?: number | null;
      postUrl?: string | null;
    }>,
  ): Promise<CombinationVideo[]> {
    if (!itens.length) return [];

    /*
     * Uma busca só, filtrada por dono.
     *
     * Buscar dentro do laço seria uma consulta por linha — com a matriz cheia,
     * 150 idas ao banco para uma tela de lançamento. E o `userId` no `where` é
     * o que garante que um id de outra conta simplesmente não apareça no mapa.
     */
    const encontrados = await this.videos.find({
      where: { id: In(itens.map((i) => i.id)), userId },
    });
    const porId = new Map(encontrados.map((v) => [v.id, v]));

    const paraSalvar: CombinationVideo[] = [];
    for (const item of itens) {
      const video = porId.get(item.id);
      if (!video) continue;
      if (item.views !== undefined) video.views = normalizarContagem(item.views);
      if (item.sales !== undefined) video.sales = normalizarContagem(item.sales);
      if (item.postUrl !== undefined) {
        const url = item.postUrl?.trim();
        video.postUrl = url ? url.slice(0, 500) : null;
      }
      paraSalvar.push(video);
    }
    return this.videos.save(paraSalvar);
  }

  /**
   * Ranking das peças de um plano pelo desempenho dos vídeos já lançados.
   *
   * O truque está na matriz: cada gancho aparece em `corpos × ctas`
   * combinações, sempre acompanhado de corpos e CTAs diferentes. Então a média
   * dos vídeos que usam o gancho 2 já isola o efeito dele — o vendedor está
   * rodando um experimento fatorial sem saber, e aqui a conta é só de média.
   *
   * Só entram vídeos COM resultado lançado. Sem isso, tratar não-lançado como
   * zero faria a peça mais usada parecer a pior.
   */
  async insights(userId: string, planId: string): Promise<PlanoInsights> {
    const plan = await this.plans.findOneBy({ id: planId, userId });
    if (!plan) throw new NotFoundException(`Plano ${planId} não encontrado`);

    const lancados = (
      await this.videos.find({ where: { planId, userId } })
    ).filter((v) => v.views !== null || v.sales !== null);

    const rotulos: Record<'hook' | 'body' | 'cta', string[]> = {
      hook: plan.hooks,
      body: plan.bodies,
      cta: plan.ctas,
    };
    const blocos = {} as PlanoInsights['blocos'];
    for (const papel of ['hook', 'body', 'cta'] as const) {
      const porIndice = new Map<number, CombinationVideo[]>();
      for (const video of lancados) {
        const [g, c, a] = this.indices(video.code);
        const indice = papel === 'hook' ? g : papel === 'body' ? c : a;
        if (indice < 0) continue;
        porIndice.set(indice, [...(porIndice.get(indice) ?? []), video]);
      }

      const pecas: PecaInsight[] = [...porIndice.entries()].map(
        ([indice, videos]) => {
          const comViews = videos.filter((v) => v.views !== null);
          const comVendas = videos.filter((v) => v.sales !== null);
          return {
            indice,
            codigo: `${LETRA[papel]}${indice + 1}`,
            rotulo: rotulos[papel][indice] ?? `${LETRA[papel]}${indice + 1}`,
            videos: videos.length,
            mediaViews: comViews.length
              ? Math.round(
                  comViews.reduce((s, v) => s + (v.views ?? 0), 0) / comViews.length,
                )
              : null,
            totalVendas: comVendas.length
              ? comVendas.reduce((s, v) => s + (v.sales ?? 0), 0)
              : null,
            dadoFraco: videos.length < MIN_VIDEOS_CONFIAVEL,
          };
        },
      );

      // Sem média de views a peça vai para o fim: ordenar `null` como 0 faria
      // parecer a pior, quando na verdade ela só não tem dado.
      pecas.sort((a, b) => (b.mediaViews ?? -1) - (a.mediaViews ?? -1));
      blocos[papel] = pecas;
    }

    const todasAsViews = lancados
      .filter((v) => v.views !== null)
      .map((v) => v.views as number);
    return {
      planId,
      sigla: plan.sigla,
      videosLancados: lancados.length,
      videosTotais: await this.videos.count({ where: { planId, userId } }),
      minimoConfiavel: MIN_VIDEOS_CONFIAVEL,
      mediaGeralViews: todasAsViews.length
        ? Math.round(todasAsViews.reduce((s, v) => s + v, 0) / todasAsViews.length)
        : null,
      blocos,
    };
  }

  /**
   * Cria um plano novo contendo só as peças que venceram no plano atual.
   *
   * É o que fecha o ciclo do Multiplicador. Sem isto o `insights` termina num
   * ranking bonito e num beco: o vendedor lê "G2 rende 3× a média" e a única
   * saída é remontar tudo à mão, escolhendo clipe por clipe de memória. Aqui a
   * própria descoberta vira a próxima matriz — as peças fracas saem, as fortes
   * se recombinam entre si, e o segundo round já nasce mais enxuto e mais caro
   * por vídeo em atenção, não em crédito.
   *
   * Peça sem dado NÃO é peça ruim: quem não tem média fica de fora da poda em
   * vez de ser eliminada por silêncio — se o bloco inteiro está sem dado, ele
   * passa inteiro para o plano novo.
   */
  async derive(userId: string, planId: string) {
    const plan = await this.plans.findOneBy({ id: planId, userId });
    if (!plan) throw new NotFoundException(`Plano ${planId} não encontrado`);

    const dados = await this.insights(userId, planId);

    const rotulos: Record<ClipRole, string[]> = {
      hook: plan.hooks,
      body: plan.bodies,
      cta: plan.ctas,
    };
    const clipes: Record<ClipRole, string[]> = {
      hook: plan.hookClipIds,
      body: plan.bodyClipIds,
      cta: plan.ctaClipIds,
    };

    const escolhidos = {} as Record<ClipRole, number[]>;
    for (const papel of ['hook', 'body', 'cta'] as const) {
      const total = rotulos[papel].length;
      if (!total) {
        escolhidos[papel] = [];
        continue;
      }

      /*
       * Só peças com média E com dado suficiente disputam a poda. `dadoFraco`
       * fora daqui seria o pior dos mundos: a tela avisa que a média de 1 vídeo
       * é palpite, e o botão em seguida trataria esse palpite como veredito.
       */
      const ranqueadas = dados.blocos[papel].filter(
        (p) => p.mediaViews !== null && !p.dadoFraco,
      );

      // Menos de duas peças com dado não é ranking, é lista: não há o que podar
      // sem inventar critério.
      if (ranqueadas.length < 2) {
        escolhidos[papel] = rotulos[papel].map((_, i) => i);
        continue;
      }

      // Metade para cima, nunca menos de duas: cortar para uma peça mataria a
      // combinação — um plano com um gancho só não é uma matriz.
      const quantas = Math.max(2, Math.ceil(ranqueadas.length / 2));
      const vencedoras = ranqueadas.slice(0, quantas).map((p) => p.indice);
      // Ordena pelo índice original para o plano novo manter a ordem em que o
      // vendedor gravou — G1, G2, G3 na tela, não a ordem do ranking.
      escolhidos[papel] = vencedoras.sort((a, b) => a - b);
    }

    if (!escolhidos.hook.length) {
      throw new ConflictException(
        'Este plano não tem ganchos para levar adiante.',
      );
    }

    const pegar = (papel: ClipRole, de: string[]) =>
      escolhidos[papel].map((i) => de[i]).filter((v) => v !== undefined);

    const novo = await this.plans.save(
      this.plans.create({
        userId,
        sigla: this.siglaDerivada(plan.sigla),
        format: plan.format,
        hooks: pegar('hook', rotulos.hook),
        bodies: pegar('body', rotulos.body),
        ctas: pegar('cta', rotulos.cta),
        hookClipIds: pegar('hook', clipes.hook),
        bodyClipIds: pegar('body', clipes.body),
        ctaClipIds: pegar('cta', clipes.cta),
      }),
    );

    return { ...novo, combinations: this.expand(novo) };
  }

  /**
   * `ASP` → `ASP2`, `ASP2` → `ASP3`.
   *
   * A sigla entra no nome de cada arquivo, então a do plano derivado precisa
   * distinguir os vídeos do segundo round dos do primeiro na galeria — e
   * continuar cabendo nos 10 caracteres da coluna.
   */
  private siglaDerivada(sigla: string): string {
    const m = /^(.*?)(\d+)$/.exec(sigla);
    const base = m ? m[1] : sigla;
    const proximo = m ? Number(m[2]) + 1 : 2;
    const sufixo = String(proximo);
    return `${base.slice(0, 10 - sufixo.length)}${sufixo}`;
  }

  // ------------------------------------------------------------- pastas

  listFolders(userId: string): Promise<CombinationFolder[]> {
    return this.folders.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  async createFolder(
    userId: string,
    name: string,
    color?: string,
  ): Promise<CombinationFolder> {
    const nome = name.trim().slice(0, 60);
    if (!nome) {
      throw new BadRequestException('Dê um nome para a pasta.');
    }
    const quantas = await this.folders.count({ where: { userId } });
    if (quantas >= MAX_PASTAS) {
      throw new ConflictException(
        `Limite de ${MAX_PASTAS} pastas atingido. Apague uma antes de criar outra.`,
      );
    }
    return this.folders.save(
      this.folders.create({ userId, name: nome, color: normalizarCor(color) }),
    );
  }

  async renameFolder(
    userId: string,
    id: string,
    name?: string,
    color?: string,
  ): Promise<CombinationFolder> {
    const pasta = await this.folders.findOneBy({ id, userId });
    if (!pasta) throw new NotFoundException(`Pasta ${id} não encontrada`);
    if (name !== undefined) {
      const nome = name.trim().slice(0, 60);
      if (!nome) throw new BadRequestException('Dê um nome para a pasta.');
      pasta.name = nome;
    }
    if (color !== undefined) pasta.color = normalizarCor(color);
    return this.folders.save(pasta);
  }

  /**
   * Apaga a pasta e solta os vídeos — nenhum arquivo é removido.
   *
   * Uma pasta é uma etiqueta, não um lugar: quem arrasta um vídeo para dentro
   * dela não está pedindo para o arquivo sumir junto quando ela for embora.
   */
  async deleteFolder(userId: string, id: string): Promise<void> {
    const pasta = await this.folders.findOneBy({ id, userId });
    if (!pasta) throw new NotFoundException(`Pasta ${id} não encontrada`);
    await this.videos.update({ folderId: id, userId }, { folderId: null });
    await this.folders.delete({ id, userId });
  }

  /** Move vídeos para uma pasta, ou para fora dela quando `folderId` é null. */
  async moveVideos(
    userId: string,
    videoIds: string[],
    folderId: string | null,
  ): Promise<void> {
    if (!videoIds.length) return;
    if (folderId) {
      const pasta = await this.folders.findOneBy({ id: folderId, userId });
      if (!pasta) throw new NotFoundException(`Pasta ${folderId} não encontrada`);
    }
    // O `userId` no critério é o que impede mover o vídeo de outra conta com
    // um id adivinhado — o update simplesmente não acha a linha.
    await this.videos.update({ id: In(videoIds), userId }, { folderId });
  }

  // ------------------------------------------------------------- clipes

  /** Guarda o clipe enviado e devolve o registro pronto para a tela. */
  async uploadClip(
    userId: string,
    role: ClipRole,
    label: string,
    buffer: Buffer,
    produto?: string,
  ): Promise<CombinationClip> {
    const jaTem = await this.clips.count({ where: { userId, role } });
    if (jaTem >= LIMITES[role]) {
      throw new ConflictException(
        `Limite de ${LIMITES[role]} clipes atingido neste bloco. Remova um antes de enviar outro.`,
      );
    }

    /*
     * O clipe é de graça — quem custa é a montagem. Mas subir dezenas de vídeos
     * com a carteira zerada leva a um só lugar: a matriz montada, o botão
     * apertado, e o 402 no fim, com todo o trabalho de curadoria já feito.
     *
     * O piso é uma montagem. Não promete que a matriz inteira cabe no saldo (a
     * conta real depende de quantas combinações ele escolher), só recusa quem
     * não faria nenhuma — e recusa no primeiro upload, que é quando a notícia
     * ainda é barata de receber.
     */
    await this.billing.assertSaldo(userId, [
      { action: 'assembly', quantidade: 1 },
    ]);

    const url = await this.mirror.putVideo(buffer, 'combination-clips', crypto.randomUUID());
    if (!url) {
      throw new ConflictException(
        'O vídeo não pôde ser guardado. Verifique o tamanho (máx. 40MB) e tente de novo.',
      );
    }

    /*
     * Mede aqui, uma vez, e não na montagem.
     *
     * É o único momento em que o vendedor ainda pode trocar o arquivo sem
     * custo — descobrir na hora de montar que o gancho tem 12s é descobrir
     * tarde, com a matriz já planejada em cima dele. A medição não pode
     * derrubar o upload: ffprobe indisponível vira 0 ("não medido"), e o
     * clipe entra igual.
     */
    const segundos = await this.assembly
      .duracaoDoBuffer(buffer, label)
      .catch(() => null);

    return this.clips.save(
      this.clips.create({
        userId,
        role,
        label: label.slice(0, 120) || 'clipe.mp4',
        produto: produto?.trim().slice(0, 60) || null,
        url,
        sizeBytes: buffer.byteLength,
        durationMs: segundos ? Math.round(segundos * 1000) : 0,
      }),
    );
  }

  listClips(userId: string): Promise<CombinationClip[]> {
    return this.clips.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  /** Edita a etiqueta de produto do clipe. Vazio limpa (`null`). */
  async updateClip(
    userId: string,
    id: string,
    produto: string | undefined,
  ): Promise<CombinationClip> {
    const clip = await this.clips.findOneBy({ id, userId });
    if (!clip) throw new NotFoundException(`Clipe ${id} não encontrado`);
    if (produto !== undefined) {
      clip.produto = produto.trim().slice(0, 60) || null;
    }
    return this.clips.save(clip);
  }

  async deleteClip(userId: string, id: string): Promise<void> {
    const result = await this.clips.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(`Clipe ${id} não encontrado`);
    }
  }

  // ------------------------------------------------------------- planos

  /**
   * Expande a matriz completa Gancho × Corpo × CTA.
   *
   * Corpo e CTA podem estar vazios (o vendedor desligou o bloco): nesse caso o
   * bloco vira um único vazio, para o produto cartesiano não zerar e o código
   * não ganhar uma letra que não corresponde a nada.
   */
  expand(plan: CombinationPlan): Combination[] {
    const now = new Date();
    const ddmm =
      String(now.getDate()).padStart(2, '0') +
      String(now.getMonth() + 1).padStart(2, '0');

    const bodies = plan.bodies.length ? plan.bodies : [''];
    const ctas = plan.ctas.length ? plan.ctas : [''];

    const result: Combination[] = [];
    plan.hooks.forEach((hook, g) => {
      bodies.forEach((body, c) => {
        ctas.forEach((cta, a) => {
          const code = [
            `G${g + 1}`,
            plan.bodies.length ? `C${c + 1}` : '',
            plan.ctas.length ? `A${a + 1}` : '',
          ].join('');
          result.push({
            code,
            filename: `${plan.sigla}_${code}_${ddmm}.mp4`,
            hook,
            body,
            cta,
            originality: 'original',
            postOrder: 0,
          });
        });
      });
    });
    return this.ordenarParaPostar(result);
  }

  /**
   * Ordena a matriz pela ordem em que vale a pena postar, e etiqueta cada
   * vídeo com o quanto ele repete o que já foi postado antes.
   *
   * O problema: na ordem do código (G1C1A1, G1C1A2, G1C2A1…) os primeiros
   * vídeos da fila são justamente os que compartilham o mesmo gancho. Postar
   * nessa ordem entrega ao algoritmo três aberturas idênticas seguidas — e os
   * 3 primeiros segundos são o que decide se o vídeo é servido ou tratado como
   * repost.
   *
   * A solução é gulosa: a cada passo escolhe a combinação que traz mais peça
   * inédita, com o gancho pesando mais que o corpo e o corpo mais que o CTA.
   * Isso naturalmente coloca os N ganchos distintos na frente, um por vez, e só
   * depois começa a reciclar. Empate desempata pelo que menos repete o vídeo
   * imediatamente anterior, e depois pela posição original — para o mesmo plano
   * sempre render a mesma ordem.
   */
  private ordenarParaPostar(matriz: Combination[]): Combination[] {
    // Peso por bloco: o gancho é o que segura o scroll, o CTA é o que menos
    // muda a percepção de "já vi esse vídeo".
    const PESOS = { hook: 4, body: 2, cta: 1 } as const;

    const usados = { hook: new Set<string>(), body: new Set<string>(), cta: new Set<string>() };
    const restantes = matriz.map((c, indice) => ({ c, indice }));
    const ordenado: Combination[] = [];
    let anterior: Combination | null = null;

    const ineditos = (c: Combination) =>
      (usados.hook.has(c.hook) ? 0 : PESOS.hook) +
      (usados.body.has(c.body) ? 0 : PESOS.body) +
      (usados.cta.has(c.cta) ? 0 : PESOS.cta);

    const repeteOAnterior = (c: Combination) =>
      anterior
        ? Number(c.hook === anterior.hook) +
          Number(c.body === anterior.body) +
          Number(c.cta === anterior.cta)
        : 0;

    while (restantes.length) {
      let melhor = 0;
      for (let i = 1; i < restantes.length; i++) {
        const a = restantes[i].c;
        const b = restantes[melhor].c;
        const ganho = ineditos(a) - ineditos(b);
        if (ganho > 0) melhor = i;
        else if (ganho === 0 && repeteOAnterior(a) < repeteOAnterior(b)) melhor = i;
      }

      const { c } = restantes.splice(melhor, 1)[0];

      // A etiqueta é lida ANTES de marcar as peças como usadas: ela descreve o
      // que este vídeo acrescenta em relação a tudo que já veio na fila.
      const ganchoInedito = !usados.hook.has(c.hook);
      const corpoInedito = !usados.body.has(c.body);
      c.originality = ganchoInedito
        ? 'original'
        : corpoInedito
          ? 'parecido'
          : 'muito-parecido';
      c.postOrder = ordenado.length + 1;

      usados.hook.add(c.hook);
      usados.body.add(c.body);
      usados.cta.add(c.cta);
      anterior = c;
      ordenado.push(c);
    }

    return ordenado;
  }

  async create(userId: string, dto: CreatePlanDto) {
    // Clipe é do dono ou não existe: o id vem do cliente, e sem esta checagem
    // um plano montaria o vídeo de outro usuário.
    const validar = async (ids: string[] | undefined, role: ClipRole) => {
      if (!ids?.length) return [];
      const achados = await this.clips.find({
        where: { id: In(ids), userId, role },
      });
      if (achados.length !== ids.length) {
        throw new BadRequestException('Um dos clipes enviados não existe mais.');
      }
      return ids;
    };

    const hookClipIds = await validar(dto.hookClipIds, 'hook');
    const bodyClipIds = await validar(dto.bodyClipIds, 'body');
    const ctaClipIds = await validar(dto.ctaClipIds, 'cta');

    // A matriz é indexada pela posição: se há clipes, precisa haver um rótulo
    // para cada um, senão o vídeo G3 sairia com o nome do gancho 1.
    const conferirTamanho = (ids: string[], rotulos: string[], bloco: string) => {
      if (ids.length && ids.length !== rotulos.length) {
        throw new BadRequestException(
          `A lista de ${bloco} não bate com a de clipes enviados.`,
        );
      }
    };
    conferirTamanho(hookClipIds, dto.hooks, 'ganchos');
    conferirTamanho(bodyClipIds, dto.bodies, 'corpos');
    conferirTamanho(ctaClipIds, dto.ctas, 'CTAs');

    const plan = await this.plans.save(
      this.plans.create({
        userId,
        sigla: dto.sigla.trim().toUpperCase(),
        format: dto.format,
        hooks: dto.hooks,
        bodies: dto.bodies,
        ctas: dto.ctas,
        hookClipIds,
        bodyClipIds,
        ctaClipIds,
      }),
    );
    return { ...plan, combinations: this.expand(plan) };
  }

  async list(userId: string) {
    const plans = await this.plans.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return plans.map((plan) => ({
      ...plan,
      total: this.expand(plan).length,
    }));
  }

  async findOne(userId: string, id: string) {
    const plan = await this.plans.findOneBy({ id, userId });
    if (!plan) {
      throw new NotFoundException(`Plano ${id} não encontrado`);
    }
    return { ...plan, combinations: this.expand(plan) };
  }

  async delete(userId: string, id: string): Promise<void> {
    const result = await this.plans.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(`Plano ${id} não encontrado`);
    }
    await this.videos.delete({ planId: id, userId });
  }

  // ------------------------------------------------------------- montagem

  /**
   * Vídeos do plano na ordem sugerida de postagem.
   *
   * `postOrder` é 0 nas montagens anteriores à etiqueta de originalidade; o
   * desempate por código mantém essas listas antigas estáveis.
   */
  listVideos(userId: string, planId: string): Promise<CombinationVideo[]> {
    return this.videos.find({
      where: { userId, planId },
      order: { postOrder: 'ASC', code: 'ASC' },
    });
  }

  /**
   * Remove um vídeo montado que o usuário descartou.
   *
   * O arquivo sai junto do bucket: guardar MP4 que o dono já rejeitou é conta
   * de storage sem contrapartida. A linha some mesmo se o S3 recusar — o que
   * manda é o que o usuário pediu, e um objeto órfão é problema menor.
   *
   * O plano continua de pé: remontar recria esta combinação. É descarte de
   * arquivo, não edição da matriz.
   */
  async deleteVideo(userId: string, id: string): Promise<void> {
    const video = await this.videos.findOneBy({ id, userId });
    if (!video) {
      throw new NotFoundException(`Vídeo ${id} não encontrado`);
    }

    const prefixo = `${MEDIA_ROUTE}/`;
    if (video.url?.startsWith(prefixo)) {
      await this.mirror.deleteObject(video.url.slice(prefixo.length));
    }
    await this.videos.delete({ id, userId });
  }

  /** Galeria: tudo que o usuário já montou, do mais novo para o mais velho. */
  async listGallery(userId: string): Promise<GaleriaGrupo[]> {
    const videos = await this.videos.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: GALERIA_MAX,
    });
    if (!videos.length) return [];

    const planIds = [...new Set(videos.map((v) => v.planId))];
    const planos = await this.plans.find({
      where: { id: In(planIds), userId },
    });
    const porId = new Map(planos.map((p) => [p.id, p]));

    // A ordem de chegada dos vídeos (mais novo primeiro) define a ordem dos
    // grupos: o produto em que o vendedor está trabalhando agora fica no topo.
    const grupos = new Map<string, GaleriaGrupo>();
    for (const video of videos) {
      let grupo = grupos.get(video.planId);
      if (!grupo) {
        const plano = porId.get(video.planId);
        grupo = {
          planId: video.planId,
          // O plano pode ter sido apagado com os vídeos ainda no bucket; o
          // nome do arquivo carrega a sigla, então o grupo não fica sem título.
          sigla: plano?.sigla ?? video.filename.split('_')[0] ?? 'SEM NOME',
          format: plano?.format ?? null,
          planoExiste: Boolean(plano),
          atualizadoEm: video.createdAt,
          videos: [],
        };
        grupos.set(video.planId, grupo);
      }
      grupo.videos.push(video);
    }

    // Dentro do produto vale a ordem de postagem, não a de criação.
    for (const grupo of grupos.values()) {
      grupo.videos.sort(
        (a, b) => a.postOrder - b.postOrder || a.code.localeCompare(b.code),
      );
    }
    return [...grupos.values()];
  }

  /**
   * Enfileira a montagem de todas as combinações do plano.
   *
   * Devolve na hora a lista de vídeos `pendente` — a tela acompanha o status.
   * O trabalho pesado roda em segundo plano, um vídeo por vez, porque cada
   * ffmpeg já usa a CPU inteira.
   */
  async render(userId: string, planId: string) {
    const plan = await this.plans.findOneBy({ id: planId, userId });
    if (!plan) throw new NotFoundException(`Plano ${planId} não encontrado`);
    if (!this.assembly.enabled) {
      throw new ConflictException(
        'A montagem não está disponível neste servidor (ffmpeg ausente).',
      );
    }
    if (!plan.hookClipIds.length) {
      throw new ConflictException(
        'Envie os vídeos dos ganchos antes de montar — o plano está só com os nomes.',
      );
    }
    if (this.montando.has(planId)) {
      return this.listVideos(userId, planId);
    }

    await this.conferirDuracoes(plan);

    const combinacoes = this.expand(plan);
    if (combinacoes.length > MAX_VIDEOS_POR_MONTAGEM) {
      throw new ConflictException(
        `São ${combinacoes.length} vídeos, acima do limite de ${MAX_VIDEOS_POR_MONTAGEM} por montagem. Reduza um dos blocos.`,
      );
    }

    /*
     * Cobra a montagem inteira ANTES de enfileirar.
     *
     * Não há IA no caminho, mas há custo: CPU da emenda e um MP4 por
     * combinação guardado no S3. Cobrar na entrada também é o que impede um
     * clique distraído em "Montar" numa matriz de 150 sem o vendedor perceber
     * o tamanho do que pediu — e cada vídeo que falhar volta como estorno.
     */
    await this.billing.charge(userId, 'assembly', combinacoes.length);

    // Remonta do zero: a matriz pode ter mudado desde a última vez.
    await this.videos.delete({ planId, userId });
    const pendentes = await this.videos.save(
      combinacoes.map((c) =>
        this.videos.create({
          userId,
          planId,
          code: c.code,
          filename: c.filename,
          status: 'pendente' as const,
          originality: c.originality,
          postOrder: c.postOrder,
        }),
      ),
    );

    this.montando.add(planId);
    // Sem `await`: a resposta sai agora e a fila roda atrás.
    void this.montarTudo(plan)
      .catch((error) => this.logger.error(`Montagem do plano ${planId} falhou: ${error}`))
      .finally(() => this.montando.delete(planId));

    return pendentes;
  }

  /**
   * Recusa a montagem quando algum clipe estoura o teto de duração do bloco.
   *
   * Roda ANTES da cobrança porque é aqui que o erro é barato: um clipe acima
   * do limite quase sempre é o vídeo inteiro subido no lugar do gancho, e cada
   * peça do Multiplicador se repete em dezenas de combinações — deixar passar
   * é debitar 150 créditos para produzir 150 vídeos que o vendedor vai jogar
   * fora.
   *
   * Só o teto duro (`limite`) bloqueia. Estar fora da faixa ideal vira aviso na
   * tela e nada mais: 4,2s de gancho pode ser exatamente o que o criativo pede.
   */
  private async conferirDuracoes(plan: CombinationPlan): Promise<void> {
    const porBloco: [ClipRole, string[]][] = [
      ['hook', plan.hookClipIds],
      ['body', plan.bodyClipIds],
      ['cta', plan.ctaClipIds],
    ];
    const ids = porBloco.flatMap(([, lista]) => lista);
    if (!ids.length) return;

    const clipes = await this.clips.find({
      where: { id: In(ids), userId: plan.userId },
    });
    const porId = new Map(clipes.map((c) => [c.id, c]));

    const problemas: string[] = [];
    for (const [role, lista] of porBloco) {
      lista.forEach((id, i) => {
        const clip = porId.get(id);
        if (!clip) return;
        if (situacao(role, clip.durationMs) !== 'acima-do-limite') return;
        problemas.push(
          `${LETRA[role]}${i + 1} (${clip.label}) tem ${(clip.durationMs / 1000).toFixed(
            1,
          )}s — o limite do bloco é ${FAIXAS[role].limite}s`,
        );
      });
    }

    if (problemas.length) {
      throw new ConflictException(
        `Estes clipes são longos demais para o bloco em que estão: ${problemas.join(
          '; ',
        )}. Corte-os (o alvo é ${FAIXAS.hook.alvo}s de gancho, ${FAIXAS.body.alvo}s de corpo e ${FAIXAS.cta.alvo}s de CTA) e envie de novo.`,
      );
    }
  }

  /** Monta cada combinação em sequência, gravando o resultado linha a linha. */
  private async montarTudo(plan: CombinationPlan): Promise<void> {
    const dim = DIMENSOES[plan.format] ?? DIMENSOES['9:16'];

    /**
     * Cada clipe é normalizado UMA vez para o plano inteiro.
     *
     * Um gancho aparece em `corpos × ctas` combinações — com a matriz cheia,
     * 15 vezes. Normalizando dentro do laço, o mesmo arquivo era recodificado
     * 15 vezes para produzir 15 resultados idênticos: numa matriz de 150
     * vídeos isso é ~450 codificações onde 18 bastam.
     *
     * O cache guarda a peça já pronta, então a montagem de cada combinação vira
     * só a emenda (concat sem recodificar) — que é o que torna viável usar um
     * preset de compressão mais lento e entregar imagem melhor.
     */
    const cache = new Map<string, Buffer | null>();

    const ler = async (clipId: string | undefined): Promise<Buffer | null> => {
      if (!clipId) return null;
      if (cache.has(clipId)) return cache.get(clipId) ?? null;

      const clip = await this.clips.findOneBy({ id: clipId, userId: plan.userId });
      const bruto = clip ? await this.lerClipe(clip.url) : null;
      let pronto: Buffer | null = null;
      if (bruto) {
        try {
          pronto = await this.assembly.normalizar(bruto, dim);
        } catch (error) {
          // Um clipe corrompido derruba só as combinações que dependem dele —
          // o `null` faz cada linha falhar com motivo, em vez de abortar a fila.
          this.logger.warn(`Clipe ${clipId} não pôde ser normalizado: ${error}`);
        }
      }
      cache.set(clipId, pronto);
      return pronto;
    };

    // Monta na ordem de postagem: o vendedor pode começar a baixar e postar os
    // primeiros enquanto a fila ainda roda, e são justamente os mais originais.
    const linhas = await this.videos.find({
      where: { planId: plan.id, userId: plan.userId },
      order: { postOrder: 'ASC', code: 'ASC' },
    });

    // A ordem das linhas é a mesma de `expand`, mas o casamento é pelo código:
    // ordenação alfabética e cartesiana coincidem só até 9 itens por bloco.
    const porCodigo = new Map(this.expand(plan).map((c, i) => [c.code, i]));

    for (const linha of linhas) {
      const indice = porCodigo.get(linha.code);
      if (indice === undefined) continue;

      // Reconstrói quais clipes formam esta célula a partir do código.
      const [g, c, a] = this.indices(linha.code);
      linha.status = 'montando';
      await this.videos.save(linha);

      try {
        const partes = (
          await Promise.all([
            ler(plan.hookClipIds[g]),
            ler(plan.bodyClipIds[c]),
            ler(plan.ctaClipIds[a]),
          ])
        ).filter((b): b is Buffer => Boolean(b));

        if (!partes.length) {
          throw new Error('Nenhum clipe pôde ser lido.');
        }

        // As partes já saíram normalizadas do cache: aqui é só a emenda.
        const final = await this.assembly.juntarNormalizadas(partes);
        const url = await this.mirror.putVideo(final, 'combination-videos', linha.id);
        if (!url) throw new Error('O vídeo montado não pôde ser guardado.');

        linha.url = url;
        linha.status = 'pronto';
        linha.error = null;
      } catch (error) {
        linha.status = 'falhou';
        linha.error = (error as Error).message.slice(0, 400);
        this.logger.warn(`Combinação ${linha.code} falhou: ${linha.error}`);
        // Vídeo que não saiu não se cobra. O estorno é por linha porque a fila
        // segue: as outras combinações continuam valendo o que foi debitado.
        await this.billing
          .refund(plan.userId, 'assembly', `Estorno: ${linha.filename} falhou`)
          .catch((e) =>
            this.logger.error(`Falha no estorno de ${linha.code}: ${e}`),
          );
      }
      await this.videos.save(linha);
    }
  }

  /** `G2C1A3` → índices zero-based [1, 0, 2]. Bloco ausente vira -1. */
  private indices(code: string): [number, number, number] {
    const pegar = (letra: string) => {
      const m = new RegExp(`${letra}(\\d+)`).exec(code);
      return m ? Number(m[1]) - 1 : -1;
    };
    return [pegar('G'), pegar('C'), pegar('A')];
  }

  /** Lê o MP4 do clipe — do nosso bucket quando é nosso, da URL quando não. */
  private async lerClipe(url: string): Promise<Buffer | null> {
    const prefixo = `${MEDIA_ROUTE}/`;
    if (url.startsWith(prefixo)) {
      const objeto = await this.mirror.readObject(url.slice(prefixo.length));
      return objeto?.body ?? null;
    }
    try {
      const resposta = await fetch(url);
      if (!resposta.ok) return null;
      return Buffer.from(await resposta.arrayBuffer());
    } catch {
      return null;
    }
  }
}
