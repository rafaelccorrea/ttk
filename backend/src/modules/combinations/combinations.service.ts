import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { VideoAssemblyService } from '../campaigns/video-assembly.service';
import { MEDIA_ROUTE, MediaMirrorService } from '../media/media-mirror.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ClipRole, CombinationClip } from './entities/combination-clip.entity';
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

/** Teto de vídeos trazidos para a galeria de uma vez. */
const GALERIA_MAX = 300;

/** Teto por bloco — o mesmo que a tela oferece. */
const LIMITES: Record<ClipRole, number> = { hook: 10, body: 5, cta: 3 };

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
export class CombinationsService {
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
    private readonly mirror: MediaMirrorService,
    private readonly assembly: VideoAssemblyService,
    private readonly billing: BillingService,
  ) {}

  // ------------------------------------------------------------- clipes

  /** Guarda o clipe enviado e devolve o registro pronto para a tela. */
  async uploadClip(
    userId: string,
    role: ClipRole,
    label: string,
    buffer: Buffer,
  ): Promise<CombinationClip> {
    const jaTem = await this.clips.count({ where: { userId, role } });
    if (jaTem >= LIMITES[role]) {
      throw new ConflictException(
        `Limite de ${LIMITES[role]} clipes atingido neste bloco. Remova um antes de enviar outro.`,
      );
    }

    const url = await this.mirror.putVideo(buffer, 'combination-clips', crypto.randomUUID());
    if (!url) {
      throw new ConflictException(
        'O vídeo não pôde ser guardado. Verifique o tamanho (máx. 40MB) e tente de novo.',
      );
    }

    return this.clips.save(
      this.clips.create({
        userId,
        role,
        label: label.slice(0, 120) || 'clipe.mp4',
        url,
        sizeBytes: buffer.byteLength,
      }),
    );
  }

  listClips(userId: string): Promise<CombinationClip[]> {
    return this.clips.find({ where: { userId }, order: { createdAt: 'ASC' } });
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
