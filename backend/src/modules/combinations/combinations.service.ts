import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { VideoAssemblyService } from '../campaigns/video-assembly.service';
import { MEDIA_ROUTE, MediaMirrorService } from '../media/media-mirror.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ClipRole, CombinationClip } from './entities/combination-clip.entity';
import { CombinationPlan } from './entities/combination-plan.entity';
import { CombinationVideo } from './entities/combination-video.entity';

export interface Combination {
  code: string;
  filename: string;
  hook: string;
  body: string;
  cta: string;
}

/** Teto por bloco — o mesmo que a tela oferece. */
const LIMITES: Record<ClipRole, number> = { hook: 10, body: 5, cta: 3 };

/**
 * Quantos vídeos uma montagem produz de uma vez.
 *
 * 10 × 5 × 3 dá 150 arquivos, e cada um custa alguns segundos de ffmpeg no
 * mesmo processo que atende a API. Acima deste teto a montagem é recusada com
 * a conta explicada, em vez de derrubar o servidor por meia hora.
 */
const MAX_VIDEOS_POR_MONTAGEM = 60;

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
          });
        });
      });
    });
    return result;
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

  listVideos(userId: string, planId: string): Promise<CombinationVideo[]> {
    return this.videos.find({
      where: { userId, planId },
      order: { code: 'ASC' },
    });
  }

  /** Galeria: tudo que o usuário já montou, do mais novo para o mais velho. */
  listGallery(userId: string): Promise<CombinationVideo[]> {
    return this.videos.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 300,
    });
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
    const cache = new Map<string, Buffer | null>();

    const ler = async (clipId: string | undefined): Promise<Buffer | null> => {
      if (!clipId) return null;
      if (cache.has(clipId)) return cache.get(clipId) ?? null;
      const clip = await this.clips.findOneBy({ id: clipId, userId: plan.userId });
      const buffer = clip ? await this.lerClipe(clip.url) : null;
      cache.set(clipId, buffer);
      return buffer;
    };

    const linhas = await this.videos.find({
      where: { planId: plan.id, userId: plan.userId },
      order: { code: 'ASC' },
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

        const final = await this.assembly.juntar(partes, dim);
        const url = await this.mirror.putVideo(final, 'combination-videos', linha.id);
        if (!url) throw new Error('O vídeo montado não pôde ser guardado.');

        linha.url = url;
        linha.status = 'pronto';
        linha.error = null;
      } catch (error) {
        linha.status = 'falhou';
        linha.error = (error as Error).message.slice(0, 400);
        this.logger.warn(`Combinação ${linha.code} falhou: ${linha.error}`);
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
