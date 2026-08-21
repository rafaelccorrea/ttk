import {
  BadRequestException,
  HttpException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { garantirConteudoPermitido } from '../../common/moderacao';
import { BillingService } from '../billing/billing.service';
import { ACTION_PRICES } from '../billing/billing.config';
import { MEDIA_ROUTE, MediaMirrorService } from '../media/media-mirror.service';
import { Product } from '../products/entities/product.entity';
import { AiService } from '../studio/ai.service';
import { Video } from '../videos/entities/video.entity';
import { VideogenService } from '../videogen/videogen.service';
import {
  CreateCampaignDto,
  CreatePersonaDto,
  CreateUserProductDto,
  UpdateCampaignDto,
  UpdatePersonaDto,
  UpdateSceneDto,
} from './dto/campaigns.dto';
import { Campaign, SEM_NARRACAO } from './entities/campaign.entity';
import {
  CampaignScene,
  SceneKind,
  cenaComApresentador,
  cenaSemPessoa,
} from './entities/campaign-scene.entity';
import { Persona } from './entities/persona.entity';
import { UserProduct } from './entities/user-product.entity';
import { VideoAssemblyService } from './video-assembly.service';
import { precosPorExtensoNoTexto } from '../../common/preco-por-extenso';
import {
  PERSONA_GROUPS,
  PersonaAttributes,
  TTS_POR_VOZ,
  fragmentoDeVoz,
  montarFragmento,
  rotularPersona,
  timbreTts,
  tomDaPersona,
  validarAtributos,
} from './persona-catalog';

/** Cada geração de vídeo rende ~5s; a duração escolhida define o nº de cenas. */
const SEGUNDOS_POR_CENA = 5;

/** Quantos ganchos da categoria entram como referência no roteiro. */
const MAX_REFERENCIAS = 8;

/**
 * Quantas legendas candidatas o ranking semântico compara por roteiro.
 *
 * É o equilíbrio entre cobertura e custo: 200 legendas são ~6k tokens de
 * embedding (décimos de centavo) e uma chamada só. Mais que isso melhora
 * pouco — as candidatas já chegam ordenadas por views, então o que o ranking
 * faz é escolher as 8 mais PARECIDAS com o produto dentro das 200 que mais
 * venderam.
 */
const CANDIDATAS_SEMANTICAS = 200;

/** Página da lista de campanhas — e também o teto que o cliente pode pedir. */
const CAMPANHAS_POR_PAGINA = 10;

/**
 * Paleta de gestos e câmera, indexada pela ordem da cena.
 *
 * Todas as cenas de apresentador partem do MESMO retrato-semente, e com a
 * mesma instrução fixa de "gestos naturais" o modelo repetia o MESMO gesto em
 * todas — o vídeo parecia um loop. A variação é determinística pela ordem:
 * duas renderizações da mesma cena saem parecidas (bom para retry), mas duas
 * cenas vizinhas nunca ganham a mesma direção.
 */
const GESTOS_POR_CENA = [
  'leans slightly toward the camera while talking, hands relaxed',
  'makes one soft open-hand gesture, then lets the hand rest',
  'tilts the head with a gentle smile while talking',
  'raises the eyebrows once, with a single small outward hand gesture',
  'gives one slow nod while talking, hands mostly still',
  'shifts weight naturally to one side, one hand moves briefly',
];

/**
 * Gesto da paleta como FALLBACK, não como segunda ordem: a acaoVisual do
 * roteiro já traz o próprio gesto, e duas direções de movimento no mesmo
 * prompt saíam como o apresentador repetindo/emendando gestos sem parar.
 */
function gestoDaCena(ordem: number): string {
  return (
    'Fallback gesture (use ONLY if the scene action lacks one): ' +
    GESTOS_POR_CENA[(ordem - 1) % GESTOS_POR_CENA.length] +
    '. One gesture total, performed once, slowly.'
  );
}

/**
 * Teto da Higgsfield para prompt de image-to-video. Passou disso, a geração é
 * recusada na hora ("prompt must be at most 2500 characters") — aconteceu em
 * produção quando os blocos fixos engordaram. Margem de 100 sobre o limite
 * real, porque quem estoura por 3 caracteres estoura de novo amanhã.
 */
const PROMPT_MAX = 2400;

/**
 * Voz coerente com a persona — e amarrada à pessoa EM QUADRO.
 *
 * O default antigo era "voice of a young Brazilian woman" fixo: persona homem
 * saiu com voz de mulher em produção, e com a voz descolada do rosto o modelo
 * tratava a fala como narração em off — o apresentador nem abria a boca.
 * Dizer que é a pessoa NA TELA que fala é o que liga o áudio ao lip-sync.
 * Timbre e tom saem do catálogo da persona (atributos `voz` e `energia`).
 */
function vozDaPersona(attrs: Partial<PersonaAttributes> | null | undefined): string {
  const a = attrs ?? {};
  return (
    'the ON-SCREEN presenter speaks this line on camera — ' +
    `${fragmentoDeVoz(a)}, ${tomDaPersona(a).video}`
  );
}

/** Voz do narrador em off das cenas de produto — a MESMA voz da persona. */
function vozDeNarrador(attrs: Partial<PersonaAttributes> | null | undefined): string {
  const a = attrs ?? {};
  return `off-screen narrator — ${fragmentoDeVoz(a)}, ${tomDaPersona(a).video}`;
}

/**
 * O SUJEITO das cenas sem pessoa, por formato. Os três partem da mesma foto
 * real e da mesma trava de identidade do produto; o que muda é quem "atua":
 * a câmera (close), as mãos usando, ou as mãos abrindo a embalagem.
 */
function sujeitoSemPessoa(
  tipo: SceneKind,
  nomeProduto: string | undefined,
  comoUsa: string | null,
): string {
  const nome = nomeProduto ? ` — "${nomeProduto}"` : '';
  const identidade =
    '. Keep its shape, colors, label and packaging IDENTICAL — never redesign it. ';
  if (tipo === 'unboxing') {
    return (
      `Close-up of a pair of hands unboxing the exact product in the starting frame${nome}` +
      identidade +
      'Hands open the box or packaging naturally and reveal the product to the camera — ' +
      'peel, lift the lid or slide it out, one step at a time, as in a real unboxing video. ' +
      'The reveal is the moment: the product ends the clip clearly visible.'
    );
  }
  if (tipo === 'mao_produto') {
    return (
      `Close-up of a pair of hands using the exact product in the starting frame${nome}` +
      identidade +
      (comoUsa
        ? `The hands actually USE it — how (in Portuguese): ${comoUsa}. `
        : 'The hands use it the way THIS type of product is used in real life (a pen writes, a lipstick is applied, a cream is spread). ') +
      'Natural, unhurried handling — never a generic "hold and rotate".'
    );
  }
  return (
    `Close-up demonstration of the exact product in the starting frame${nome}` +
    identidade +
    // O gesto vem do roteirista, que conhece o produto; os exemplos são
    // só a rede para roteiro antigo/fallback sem `comoUsa`.
    (comoUsa
      ? `Show the product actually being used — how (in Portuguese): ${comoUsa}. `
      : 'Show the product the way THIS type of product is used in real life (a pen writes, a lipstick is applied, a garment is worn). ') +
    'Never a generic "hold and rotate" when it has a natural use gesture.'
  );
}

/**
 * O texto que o modelo NARRA, com preço inteiro por extenso.
 *
 * "R$ 10" saiu como dólar; "99,89 reais" saiu com o número lido errado — o
 * modelo tropeça em algarismo. "noventa e nove reais e oitenta e nove
 * centavos" não tem como errar. A fala ORIGINAL (com dígitos) continua sendo
 * o que vai para a legenda queimada, onde dígito lê melhor.
 */
function falaParaAudio(fala: string): string {
  return precosPorExtensoNoTexto(fala);
}

/**
 * Prompt de renderização em BLOCOS rotulados, num idioma só por bloco.
 *
 * A versão anterior emendava fragmento da persona (inglês), ação do roteiro
 * (português) e a ordem de fala no meio de tudo — prompt bilíngue sem
 * estrutura, e o modelo respondia com áudio à deriva (espanhol saiu em
 * produção). Blocos rotulados dizem ao modelo o que é direção, o que é
 * diálogo e em que língua cada coisa está.
 *
 * "No on-screen text" não é preciosismo: o modelo às vezes inventa legenda
 * própria queimada no quadro — que depois briga com a NOSSA legenda na
 * montagem.
 *
 * Cada bloco fixo é escrito CURTO de propósito: o total compete com o teto de
 * caracteres da fornecedora (`PROMPT_MAX`), e o que passa do teto é cortado
 * começando pelos extras.
 */
function montarPromptDeCena(opts: {
  sujeito: string;
  acaoVisual: string;
  extras?: string[];
  fala?: string | null;
  vozDescricao?: string;
  /** Cena SEM rosto (demonstração): mãos podem aparecer, pessoa não. */
  semPessoa?: boolean;
}): string {
  const partes = [
    // ------------------------------------------------------------- SUJEITO
    opts.sujeito,
    // --------------------------------------------------------------- CENA
    `Scene action (in Portuguese): ${opts.acaoVisual}`,
    ...(opts.extras ?? []),
    // ------------------------------------------------------- CONTINUIDADE
    // O clipe parte de um frame real: o modelo tende a "recriar" o sujeito
    // no meio do movimento. Travar identidade e cenário é o que impede o
    // rosto (ou o produto) de trocar entre o primeiro e o último segundo.
    'Continuity: one continuous shot, no cuts. Keep the subject EXACTLY as in the starting frame — ' +
      'same face, hair, outfit, background, lighting. No morphing, no people or objects added or removed.',
    // ------------------------------------------------------------ ESTÉTICA
    'Look: realistic UGC smartphone video, vertical 9:16, soft natural light, real skin texture, slightly handheld.',
    'Motion: natural timing, no slow motion. Each gesture happens ONCE — never loop a movement. Calm, unhurried.',
    // A montagem corta seco de uma cena para a outra: clipe que termina "em
    // repouso" denuncia a emenda. Terminar em movimento suave faz uma cena
    // parecer continuação da anterior.
    'Flow: start and end mid-motion (never frozen), so consecutive scenes cut together seamlessly.',
  ];

  // ----------------------------------------------------------------- ÁUDIO
  if (opts.fala?.trim()) {
    partes.push(
      // "VERBATIM": o modelo "corrigia" a concordância sozinho ("o dia todo"
      // saiu "o dia toda" em produção).
      `Dialogue — say VERBATIM, word for word, in BRAZILIAN PORTUGUESE (pt-BR): "${falaParaAudio(opts.fala.trim())}"`,
      // Cada frase abaixo cobre um defeito que JÁ saiu em produção: espanhol,
      // palavra flexionada, preço em dólar, clipe abrindo com risada e fala
      // cortada no fim dos 5s. Compacto de propósito — ver PROMPT_MAX.
      // O TOM não é mais fixo aqui: vem no `vozDescricao` (persona), senão o
      // tom fixo "calmo" brigava com a energia "animada" escolhida na persona.
      `Audio: ${opts.vozDescricao ?? 'natural Brazilian voice, calm conversational tone'} — ` +
        'never shouting, never a radio announcer. ' +
        'Brazilian Portuguese ONLY (never Spanish or English). ' +
        // O exemplo literal pesa mais que a regra abstrata: "verbatim" sozinho
        // não impediu a voz feminina de flexionar "todo" para "toda".
        'Every word EXACTLY as written — endings NEVER change ("todo" never becomes "toda"); ' +
        'prices are Brazilian reais, never dollars. ' +
        // Sorriso é expressão; risada é SOM — e o som é o defeito. Separar os
        // dois evita que o modelo troque o sorriso por cara fechada.
        'NO laughing or giggling sounds (smiling is fine). ' +
        'Speech starts at the first frame and ends within the 5-second clip, natural pace. ' +
        'Word-by-word lip-sync. No music.',
    );
  } else {
    partes.push('Audio: no speech, no music — subtle ambient sound only.');
  }

  // -------------------------------------------------------------- PROIBIDO
  partes.push(
    'Strictly forbidden: on-screen text, captions, logos, watermarks, UI; extra people; ' +
      'deformed or extra fingers; flicker, glitches; ' +
      (opts.semPessoa
        ? 'faces or full people in frame (hands and forearms allowed).'
        : "changing the presenter's face, age, hair or clothes."),
  );

  /*
   * Trava do teto da fornecedora: se mesmo compacto o total passar, os EXTRAS
   * caem primeiro (gesto de fallback e câmera são os únicos dispensáveis — o
   * resto é identidade, idioma e proibições). Só então, em último caso, o
   * texto é cortado no limite: prompt truncado gera um vídeo pior; prompt
   * estourado não gera vídeo nenhum.
   */
  let prompt = partes.join('\n');
  const extras = opts.extras ?? [];
  for (let i = extras.length - 1; i >= 0 && prompt.length > PROMPT_MAX; i--) {
    prompt = partes.filter((p) => !extras.slice(i).includes(p)).join('\n');
  }
  return prompt.length > PROMPT_MAX ? prompt.slice(0, PROMPT_MAX) : prompt;
}

const CAMERAS_POR_CENA = [
  'Camera slowly pushes in.',
  'Subtle handheld sway.',
  'Camera drifts slightly to the side.',
  'Slow push-in with a gentle tilt.',
];

/** Teto de fotos por produto — mais que isso ninguém usa no storyboard. */
const MAX_FOTOS = 5;

/**
 * Piso de fotos para abrir campanha.
 *
 * Cada cena de produto parte de uma foto (`produto.images[i % length]`): com
 * uma só, todas as cenas animam a MESMA imagem e o anúncio fica visivelmente
 * repetido. Barrar na criação — e não na renderização — evita que o vendedor
 * gaste o crédito do roteiro para só então descobrir o problema.
 */
const MIN_FOTOS = 3;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  /**
   * Campanhas com montagem em voo. O polling chama o refresh a cada 6s e
   * cada refresh sem vídeo final tentava montar DE NOVO — montagens idênticas
   * empilhadas disputando o ffmpeg (e o limite de processos da hospedagem)
   * entre si e com as dublagens.
   */
  private readonly montagensEmVoo = new Set<string>();

  /**
   * Campanhas cuja fila está avançando NESTE instante. O polling chega a cada
   * 6s e um disparo leva alguns segundos: sem a trava, dois refreshes
   * sobrepostos veriam a mesma cena 'pendente' e a disparariam (e cobrariam)
   * duas vezes.
   */
  private readonly filasEmVoo = new Set<string>();

  constructor(
    @InjectRepository(UserProduct)
    private readonly produtos: Repository<UserProduct>,
    @InjectRepository(Persona)
    private readonly personas: Repository<Persona>,
    @InjectRepository(Campaign)
    private readonly campanhas: Repository<Campaign>,
    @InjectRepository(CampaignScene)
    private readonly cenas: Repository<CampaignScene>,
    @InjectRepository(Product)
    private readonly catalogo: Repository<Product>,
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly ai: AiService,
    private readonly videogen: VideogenService,
    private readonly mirror: MediaMirrorService,
    private readonly billing: BillingService,
    private readonly assembly: VideoAssemblyService,
  ) {}

  // ------------------------------------------------------------------ preços
  /** Tabela que a tela mostra antes de qualquer clique que cobra. */
  precos(durationSeconds = 15) {
    const cenas = this.cenasPara(durationSeconds);
    return {
      persona: ACTION_PRICES.image.credits,
      roteiro: ACTION_PRICES.script.credits,
      cena: ACTION_PRICES.video.credits,
      cenas,
      // O que o vendedor gasta do zero até o vídeo pronto, sem reuso.
      totalCampanha:
        ACTION_PRICES.script.credits + ACTION_PRICES.video.credits * cenas,
    };
  }

  private cenasPara(durationSeconds: number): number {
    return Math.max(1, Math.round(durationSeconds / SEGUNDOS_POR_CENA));
  }

  // ---------------------------------------------------------------- produtos
  async criarProduto(userId: string, dto: CreateUserProductDto): Promise<UserProduct> {
    let { name, priceBrl, benefit, problemSolved } = dto;
    // Estes campos entram DIRETO nos prompts de roteiro e de vídeo. Barrar
    // aqui é imediato e grátis; barrar na fornecedora é depois da cobrança.
    garantirConteudoPermitido({ name, benefit, problemSolved });

    // Importado do catálogo: os campos vêm preenchidos e o vendedor ajusta.
    if (dto.sourceProductId) {
      const origem = await this.catalogo.findOneBy({ id: dto.sourceProductId });
      if (!origem) {
        throw new NotFoundException('Produto do catálogo não encontrado.');
      }
      name = name || origem.title;
      priceBrl = priceBrl ?? Number(origem.price);
    }

    // As fotos são espelhadas antes de salvar: URL de terceiro expira, e um
    // produto sem foto não vira B-roll de cena nenhuma.
    const images = await this.espelharFotos(dto.images ?? []);

    return this.produtos.save(
      this.produtos.create({
        userId,
        name,
        priceBrl: priceBrl ?? null,
        benefit: benefit ?? null,
        problemSolved: problemSolved ?? null,
        images,
        sourceProductId: dto.sourceProductId ?? null,
      }),
    );
  }

  /**
   * Só aceita o que o espelhamento conseguiu decodificar como imagem. Guardar
   * a URL crua abriria dois buracos de uma vez: ela expira, e o servidor
   * passaria a buscar um endereço escolhido pelo cliente.
   */
  private async espelharFotos(urls: string[]): Promise<string[]> {
    const saida: string[] = [];
    for (const url of urls.slice(0, 5)) {
      if (!/^https:\/\//i.test(url)) continue;
      const espelhada = await this.mirror.mirror(url, 'user-products', randomUUID());
      if (espelhada) saida.push(espelhada);
    }
    return saida;
  }

  /**
   * Anexa uma foto enviada pelo vendedor.
   *
   * A foto não é enfeite de cadastro: ela vira o frame base das cenas de
   * demonstração. Sem ela, a IA inventa um objeto parecido e o anúncio mostra
   * um produto que não é o que ele vende.
   */
  async adicionarFoto(
    userId: string,
    productId: string,
    arquivo: Buffer,
  ): Promise<UserProduct> {
    const produto = await this.produtos.findOneBy({ id: productId, userId });
    if (!produto) throw new NotFoundException('Produto não encontrado.');
    if (produto.images.length >= MAX_FOTOS) {
      throw new ConflictException(`Máximo de ${MAX_FOTOS} fotos por produto.`);
    }

    // `contain`: a foto do produto tem que caber INTEIRA. Recortar em 9:16
    // cortaria o produto ao meio, e é essa mesma imagem que vira o frame da
    // cena de demonstração.
    const url = await this.mirror.putImage(
      arquivo,
      'user-products',
      produto.id,
      'contain',
    );
    if (!url) {
      throw new BadRequestException(
        'Não foi possível ler a imagem. Envie um JPG, PNG ou WebP.',
      );
    }
    // A chave no S3 é o hash do conteúdo: reenviar a MESMA foto devolve a
    // mesma URL. Antes isso virava um no-op silencioso — o upload dava 200, a
    // galeria não mudava e o vendedor ficava clicando achando que travou.
    // Recusar com mensagem é o único jeito de ele saber que precisa de uma
    // foto DIFERENTE (e o mínimo de fotos existe justamente por isso).
    if (produto.images.includes(url)) {
      throw new ConflictException(
        'Essa mesma foto já está no produto. Envie uma imagem diferente — cada cena parte de um ângulo distinto.',
      );
    }
    produto.images = [...produto.images, url];
    return this.produtos.save(produto);
  }

  async removerFoto(
    userId: string,
    productId: string,
    url: string,
  ): Promise<UserProduct> {
    const produto = await this.produtos.findOneBy({ id: productId, userId });
    if (!produto) throw new NotFoundException('Produto não encontrado.');
    produto.images = produto.images.filter((foto) => foto !== url);
    return this.produtos.save(produto);
  }

  listarProdutos(userId: string): Promise<UserProduct[]> {
    return this.produtos.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async removerProduto(userId: string, id: string): Promise<void> {
    /*
     * A FK das campanhas é ON DELETE RESTRICT de propósito: apagar o produto
     * em cascata levaria junto campanhas com cenas JÁ PAGAS. Mas o RESTRICT
     * sozinho virava um 500 de banco que o usuário lia como "a deleção não
     * funciona" — a recusa precisa vir ANTES, com o motivo e o caminho.
     */
    const emUso = await this.campanhas.count({
      where: { userId, userProductId: id },
    });
    if (emUso) {
      throw new ConflictException(
        `Este produto tem ${emUso} campanha(s). Exclua as campanhas dele primeiro — elas carregam cenas já pagas.`,
      );
    }
    const r = await this.produtos.delete({ id, userId });
    if (!r.affected) throw new NotFoundException('Produto não encontrado.');
  }

  // ---------------------------------------------------------------- personas
  /** Catálogo de atributos para a tela montar os seletores. */
  opcoesDePersona() {
    return PERSONA_GROUPS;
  }

  /**
   * Cria a persona e dispara o retrato-semente. Cobra como imagem, uma única
   * vez — a persona é reusada em quantas campanhas o vendedor quiser.
   */
  async criarPersona(userId: string, dto: CreatePersonaDto): Promise<Persona> {
    // O rótulo entra no prompt do roteiro ("Quem apresenta: ...").
    garantirConteudoPermitido({ label: dto.label });
    let attrs;
    try {
      attrs = validarAtributos(dto.attrs as never);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const promptFragment = montarFragmento(attrs);
    // "closed-mouth smile, about to speak": retrato no meio da risada fazia o
    // vídeo ABRIR com risada sonora — o modelo anima a expressão que recebe.
    const retrato = `portrait of ${promptFragment}, looking at camera, waist up, gentle closed-mouth smile, about to start speaking`;

    // A cobrança acontece aqui dentro, com estorno automático se a API recusar.
    const media = await this.videogen.generate(userId, {
      kind: 'image',
      prompt: retrato,
      aspectRatio: '9:16',
    });

    return this.personas.save(
      this.personas.create({
        userId,
        label: dto.label?.trim() || rotularPersona(attrs),
        attrs,
        promptFragment,
        status: 'gerando',
        seedMediaId: media.id,
        seedImageUrl: null,
      }),
    );
  }

  listarPersonas(userId: string): Promise<Persona[]> {
    return this.personas.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Consulta a geração do retrato e, quando pronta, espelha no S3.
   *
   * O espelhamento não é detalhe: a URL da fornecedora expira, e uma persona
   * que perde o retrato perde a consistência de rosto de toda campanha futura.
   */
  async atualizarPersona(userId: string, id: string): Promise<Persona> {
    const persona = await this.personas.findOneBy({ id, userId });
    if (!persona) throw new NotFoundException('Persona não encontrada.');
    if (persona.status !== 'gerando' || !persona.seedMediaId) return persona;

    const media = await this.videogen.refresh(userId, persona.seedMediaId);
    if (media.status === 'completed') {
      const origem = media.outputUrl ?? media.imageUrl;
      const espelhada = origem
        ? await this.mirror.mirror(origem, 'personas', persona.id)
        : null;
      if (espelhada) {
        persona.seedImageUrl = espelhada;
        persona.status = 'pronta';
      } else {
        persona.status = 'falhou';
        this.logger.warn(`Retrato da persona ${persona.id} não pôde ser espelhado.`);
      }
    } else if (['failed', 'nsfw', 'canceled'].includes(media.status)) {
      persona.status = 'falhou';
    }
    return this.personas.save(persona);
  }

  /**
   * Edita apelido e voz da persona — grátis, porque nenhum dos dois entra no
   * prompt do retrato. A voz nova vale já para a próxima renderização e para a
   * próxima dublagem; cenas já renderizadas mantêm o áudio que têm.
   */
  async editarPersona(
    userId: string,
    id: string,
    dto: UpdatePersonaDto,
  ): Promise<Persona> {
    const persona = await this.personas.findOneBy({ id, userId });
    if (!persona) throw new NotFoundException('Persona não encontrada.');

    if (dto.label !== undefined) {
      const limpo = dto.label.trim();
      // Apelido apagado volta ao nome pelos atributos — nunca fica sem nome.
      persona.label = limpo || rotularPersona(persona.attrs);
    }

    if (dto.voz !== undefined) {
      // Mesma contenção da criação: só ids do catálogo, nunca texto livre —
      // o fragment da voz entra verbatim no prompt de vídeo.
      const grupoVoz = PERSONA_GROUPS.find((g) => g.key === 'voz')!;
      if (!grupoVoz.options.some((o) => o.id === dto.voz)) {
        throw new BadRequestException('Escolha uma voz do catálogo.');
      }
      persona.attrs = { ...persona.attrs, voz: dto.voz };
    }

    return this.personas.save(persona);
  }

  async removerPersona(userId: string, id: string): Promise<void> {
    const persona = await this.personas.findOneBy({ id, userId });
    if (!persona) throw new NotFoundException('Persona não encontrada.');
    await this.personas.delete({ id, userId });
    // O retrato-semente só serve a esta persona; sem ela, é um rosto órfão
    // parado em "Minhas Gerações".
    await this.videogen.deleteMany(userId, [persona.seedMediaId]);
  }

  // --------------------------------------------------------------- campanhas
  async criarCampanha(userId: string, dto: CreateCampaignDto): Promise<Campaign> {
    const produto = await this.produtos.findOneBy({ id: dto.userProductId, userId });
    if (!produto) throw new NotFoundException('Produto não encontrado.');
    if (produto.images.length < MIN_FOTOS) {
      throw new BadRequestException(
        `Envie ao menos ${MIN_FOTOS} fotos do produto para criar a campanha (há ${produto.images.length}).`,
      );
    }
    const estilo = dto.estilo ?? 'misto';
    let personaId: string | null = null;
    let vozNarrador: string | null = null;
    if (estilo === 'sem_apresentador') {
      // Sem persona a única fonte de voz é a escolha explícita — e barrar um
      // id inventado aqui evita um TTS mudo lá na frente. `sem_narracao` é a
      // escolha deliberada de vídeo mudo: passa, e o roteiro nasce sem fala.
      if (
        !dto.vozNarrador ||
        (dto.vozNarrador !== SEM_NARRACAO && !TTS_POR_VOZ[dto.vozNarrador])
      ) {
        throw new BadRequestException(
          'Escolha a voz do narrador para uma campanha sem apresentador.',
        );
      }
      vozNarrador = dto.vozNarrador;
    } else {
      if (!dto.personaId) {
        throw new BadRequestException('Escolha quem apresenta a campanha.');
      }
      const persona = await this.personas.findOneBy({ id: dto.personaId, userId });
      if (!persona) throw new NotFoundException('Persona não encontrada.');
      personaId = persona.id;
    }

    return this.campanhas.save(
      this.campanhas.create({
        userId,
        userProductId: produto.id,
        personaId,
        estilo,
        vozNarrador,
        title: produto.name,
        durationSeconds: dto.durationSeconds ?? 15,
        status: 'rascunho',
      }),
    );
  }

  /**
   * Lista paginada, cada campanha com a foto de capa do seu produto.
   *
   * A foto vem daqui, e não de outra chamada, porque o card da lista é a
   * primeira coisa que a tela pinta — buscar o produto de cada campanha no
   * cliente seria N requests para mostrar N miniaturas.
   *
   * `comVideo` acompanha o total porque o stepper da tela marca o passo
   * "Vídeo" como cumprido quando ALGUMA campanha tem vídeo final — e com a
   * lista paginada a página atual não sabe responder isso sozinha.
   */
  /**
   * Preferências da campanha. Mudar a legenda com o final já montado descarta
   * o arquivo: ele carrega a escolha antiga, e a montagem automática refaz
   * com a nova no próximo refresh.
   */
  async atualizarCampanhaPreferencias(
    userId: string,
    id: string,
    dto: UpdateCampaignDto,
  ): Promise<Campaign> {
    const campanha = await this.campanhas.findOneBy({ id, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');
    if (dto.subtitles !== undefined && dto.subtitles !== campanha.subtitles) {
      campanha.subtitles = dto.subtitles;
      campanha.finalVideoUrl = null;
    }
    return this.campanhas.save(campanha);
  }

  /**
   * Desliga a fila de renderização.
   *
   * O que ainda não foi disparado não cobra nada — cancelar é de graça. A
   * cena que JÁ está renderizando termina: o crédito dela já foi debitado na
   * submissão, e abortar na fornecedora não estorna.
   */
  async cancelarFila(userId: string, campaignId: string) {
    const campanha = await this.campanhas.findOneBy({ id: campaignId, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');
    if (campanha.renderQueue) {
      await this.campanhas.update(campaignId, { renderQueue: false });
    }
    return this.detalharCampanha(userId, campaignId);
  }

  async listarCampanhas(
    userId: string,
    page = 1,
    limit = CAMPANHAS_POR_PAGINA,
    busca?: string,
  ) {
    const take = Math.min(Math.max(1, limit), CAMPANHAS_POR_PAGINA);
    const paginaAtual = Math.max(1, page);

    /*
     * A busca é do SERVIDOR, não um filtro da página atual: com a lista
     * paginada, filtrar no cliente só encontraria o que por acaso está na
     * página aberta. O termo alcança o título da campanha, o nome do produto e
     * o preço — vírgula vira ponto porque o vendedor digita "99,90" e o
     * `numeric` do Postgres imprime "99.90".
     */
    const termo = busca?.trim().slice(0, 120);
    const consulta = this.campanhas
      .createQueryBuilder('c')
      .where('c."userId" = :userId', { userId })
      .orderBy('c."createdAt"', 'DESC')
      .skip((paginaAtual - 1) * take)
      .take(take);
    if (termo) {
      consulta
        .leftJoin(UserProduct, 'p', 'p.id = c."userProductId"')
        .andWhere(
          '(c.title ILIKE :q OR p.name ILIKE :q OR CAST(p."priceBrl" AS text) ILIKE :q)',
          { q: `%${termo.replace(/,/g, '.')}%` },
        );
    }
    const [itens, total] = await consulta.getManyAndCount();

    const idsDeProduto = [...new Set(itens.map((c) => c.userProductId))];
    const produtos = idsDeProduto.length
      ? await this.produtos.findBy({ id: In(idsDeProduto) })
      : [];
    const capaPorProduto = new Map(
      produtos.map((p) => [p.id, p.images[0] ?? null]),
    );

    const comVideo = await this.campanhas.count({
      where: { userId, finalVideoUrl: Not(IsNull()) },
    });

    return {
      items: itens.map((c) => ({
        ...c,
        productImage: capaPorProduto.get(c.userProductId) ?? null,
      })),
      total,
      page: paginaAtual,
      pageCount: Math.max(1, Math.ceil(total / take)),
      comVideo,
    };
  }

  /** Campanha com cenas — é o que a tela de detalhe consome. */
  async detalharCampanha(userId: string, id: string) {
    const campanha = await this.campanhas.findOneBy({ id, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');
    const [produto, persona, cenas] = await Promise.all([
      this.produtos.findOneBy({ id: campanha.userProductId }),
      this.personaDaCampanha(campanha),
      this.cenas.find({ where: { campaignId: id }, order: { ordem: 'ASC' } }),
    ]);
    return { ...campanha, produto, persona, cenas };
  }

  /**
   * Gera o roteiro e o storyboard numa cobrança só, e regrava as cenas.
   * Rodar de novo substitui o storyboard inteiro — por isso é bloqueado
   * depois que alguma cena já foi renderizada (seria jogar crédito fora).
   */
  async gerarRoteiro(userId: string, campaignId: string) {
    const campanha = await this.campanhas.findOneBy({ id: campaignId, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');

    const jaRenderizou = await this.cenas.count({
      where: { campaignId, status: 'pronta' },
    });
    if (jaRenderizou) {
      throw new ConflictException(
        'Esta campanha já tem cenas renderizadas. Crie uma nova campanha para mudar o roteiro.',
      );
    }

    const produto = await this.produtos.findOneBy({ id: campanha.userProductId });
    const persona = await this.personaDaCampanha(campanha);
    if (!produto || (!persona && campanha.estilo !== 'sem_apresentador')) {
      throw new NotFoundException('Produto ou persona da campanha não existe mais.');
    }

    const pedido = {
      productName: produto.name,
      benefit: produto.benefit,
      problemSolved: produto.problemSolved,
      priceBrl: produto.priceBrl === null ? null : Number(produto.priceBrl),
      cenas: this.cenasPara(campanha.durationSeconds),
      persona:
        persona?.label ?? 'ninguém — vídeo sem apresentador, só narração em off',
      temFotoDoProduto: produto.images.length > 0,
      // Quantas fotos existem, não só se existe alguma: com cinco ângulos dá
      // para planejar mais de uma demonstração, e o roteiro deixava esse
      // material parado.
      fotosDoProduto: produto.images.length,
      referencias: await this.ganchosDaCategoria(produto),
      estilo: campanha.estilo,
    };

    const run = () => this.ai.generateCampaign(pedido);
    const resultado = this.ai.enabled
      ? await this.billing.withCharge(userId, 'script', run)
      : await run();

    // Regerar o roteiro descarta as cenas antigas — e as gerações delas, que
    // sem isto ficariam órfãs em "Minhas Gerações".
    const cenasAntigas = await this.cenas.find({
      where: { campaignId },
      select: { generatedMediaId: true },
    });
    await this.cenas.delete({ campaignId });
    await this.videogen.deleteMany(
      userId,
      cenasAntigas.map((c) => c.generatedMediaId),
    );
    // Contador PRÓPRIO das cenas de produto. Antes a rotação usava o índice de
    // todas as cenas, então num roteiro com uma demonstração só ela caía
    // sempre na mesma foto — o vendedor subia cinco e via uma.
    let demonstracao = 0;
    await this.cenas.save(
      resultado.cenas.map((cena, i) => {
        // O tipo vem normalizado do roteirista; a derivação dos campos
        // legados fica de rede para mocks e roteiros antigos.
        const tipo: SceneKind =
          cena.tipoCena ??
          (cena.mostraProduto
            ? 'produto_close'
            : cena.seguraProduto === true
              ? 'apresentador_produto'
              : 'apresentador');
        const semPessoa = cenaSemPessoa(tipo) && produto.images.length > 0;
        const foto = semPessoa
          ? produto.images[demonstracao++ % produto.images.length]
          : null;
        return this.cenas.create({
          campaignId,
          ordem: i + 1,
          fala: cena.fala,
          acaoVisual: cena.acaoVisual,
          // Sem foto a cena sem pessoa não tem de onde partir: cai para
          // apresentador — a mesma trava que o normalizador do roteirista já
          // aplica; aqui é só o cinto de segurança dos caminhos legados.
          tipo: cenaSemPessoa(tipo) && !semPessoa ? 'apresentador' : tipo,
          // Campanha criada sem narração: toda cena nasce muda, decida o que
          // o roteirista decidir — a escolha do vendedor vence a da IA.
          modoAudio:
            campanha.vozNarrador === SEM_NARRACAO
              ? 'sem_fala'
              : (cena.modoAudio ?? (semPessoa ? 'narracao' : 'fala')),
          seguraProduto: tipo === 'apresentador_produto',
          // Alterna entre as fotos disponíveis para não repetir o mesmo
          // enquadramento em duas demonstrações seguidas.
          baseImageUrl: foto,
          status: 'pendente',
        });
      }),
    );

    campanha.script = resultado.content;
    campanha.comoUsa = resultado.comoUsa ?? null;
    campanha.model = resultado.model;
    campanha.status = 'storyboard';
    if (this.ai.enabled) campanha.creditsSpent += ACTION_PRICES.script.credits;
    await this.campanhas.save(campanha);

    return this.detalharCampanha(userId, campaignId);
  }

  /**
   * Ganchos que estão vendendo na categoria do produto — é o dado que só o
   * PikPok tem, e o que separa este roteiro de um genérico.
   *
   * Por enquanto sai de uma busca por palavra na legenda. Quando o índice
   * semântico existir, é só esta consulta que muda: quem chama continua
   * recebendo uma lista de frases.
   */
  private async ganchosDaCategoria(produto: UserProduct): Promise<string[]> {
    // Ranking semântico primeiro: entende que "não sai com nada" e "à prova
    // d'água" falam do mesmo produto, coisa que ILIKE nunca vai ver. Quando
    // não dá (sem chave, API fora), cai no caminho textual logo abaixo.
    const semanticos = await this.ganchosSemanticos(produto);
    if (semanticos) return semanticos;

    const categoria = produto.sourceProductId
      ? (await this.catalogo.findOneBy({ id: produto.sourceProductId }))?.category
      : null;

    const consulta = this.videos
      .createQueryBuilder('v')
      .select('v.caption', 'caption')
      .innerJoin(Product, 'p', 'p.id = v."productId"')
      .andWhere("v.caption IS NOT NULL AND length(v.caption) > 20")
      .orderBy('v.views', 'DESC')
      .limit(MAX_REFERENCIAS);

    if (categoria) {
      consulta.where('p.category = :categoria', { categoria });
    } else {
      /*
       * Produto digitado à mão não tem categoria — e era exatamente o caso
       * mais comum. O retorno vazio aqui significava que o roteirista escrevia
       * ÀS CEGAS, sem nenhum gancho real, justamente para o vendedor típico.
       *
       * Sem categoria, casamos pelo nome: as palavras significativas do
       * produto contra o título do produto do catálogo e a legenda do vídeo.
       * É mais grosseiro que a categoria, mas gancho de "batom" serve a batom
       * — e gancho nenhum não serve a nada.
       */
      const palavras = produto.name
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((p) => p.length >= 4)
        .slice(0, 3);
      if (!palavras.length) return [];
      palavras.forEach((palavra, i) => {
        const clausula = `(p.title ILIKE :p${i} OR v.caption ILIKE :p${i})`;
        const valor = { [`p${i}`]: `%${palavra}%` };
        if (i === 0) consulta.where(clausula, valor);
        else consulta.orWhere(clausula, valor);
      });
    }

    const linhas = await consulta.getRawMany<{ caption: string }>();
    return linhas.map((l) => l.caption);
  }

  /**
   * As ${MAX_REFERENCIAS} legendas mais parecidas com o produto, por cosseno.
   *
   * O universo de busca são as `CANDIDATAS_SEMANTICAS` legendas de maior
   * view — restringir por categoria quando ela existe, e o catálogo inteiro
   * quando não (produto digitado à mão). A consulta é o produto como o
   * vendedor o descreveu: nome, benefício e problema — que é exatamente o que
   * o roteiro precisa ecoar.
   *
   * Devolve `null` quando o ranking não pôde rodar (sem chave, sem legendas,
   * API fora) — null significa "use o fallback", enquanto `[]` significaria
   * "não há ganchos", que é informação diferente.
   */
  private async ganchosSemanticos(produto: UserProduct): Promise<string[] | null> {
    if (!this.ai.enabled) return null;

    const categoria = produto.sourceProductId
      ? (await this.catalogo.findOneBy({ id: produto.sourceProductId }))?.category
      : null;

    const consulta = this.videos
      .createQueryBuilder('v')
      .select('v.caption', 'caption')
      .innerJoin(Product, 'p', 'p.id = v."productId"')
      .andWhere("v.caption IS NOT NULL AND length(v.caption) > 20")
      .orderBy('v.views', 'DESC')
      .limit(CANDIDATAS_SEMANTICAS);
    if (categoria) consulta.where('p.category = :categoria', { categoria });

    const linhas = await consulta.getRawMany<{ caption: string }>();
    const legendas = [...new Set(linhas.map((l) => l.caption))];
    if (legendas.length < MAX_REFERENCIAS) return null; // pouco material: fallback decide

    const pergunta = [produto.name, produto.benefit, produto.problemSolved]
      .filter(Boolean)
      .join('. ');

    // Um batch só: consulta na posição 0, candidatas em seguida.
    const vetores = await this.ai.embed([pergunta, ...legendas]);
    if (!vetores) return null;

    const [alvo, ...docs] = vetores;
    const cosseno = (a: number[], b: number[]) => {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
    };

    return docs
      .map((v, i) => ({ legenda: legendas[i], score: cosseno(alvo, v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_REFERENCIAS)
      .map((d) => d.legenda);
  }

  /** O vendedor ajusta fala e ação antes de gastar crédito de vídeo. */
  async editarCena(userId: string, sceneId: string, dto: UpdateSceneDto) {
    const cena = await this.cenaDoUsuario(userId, sceneId);
    if (cena.status === 'pronta') {
      throw new ConflictException('Cena já renderizada não pode ser editada.');
    }
    // A fala e a ação editadas vão para o prompt da renderização sem outra
    // revisão — este é o último ponto onde dá para recusar de graça.
    garantirConteudoPermitido({ fala: dto.fala, acaoVisual: dto.acaoVisual });
    if (dto.fala !== undefined) cena.fala = dto.fala;
    if (dto.acaoVisual !== undefined) cena.acaoVisual = dto.acaoVisual;

    if (dto.tipoCena !== undefined && dto.tipoCena !== cena.tipo) {
      const campanha = await this.campanhas.findOneByOrFail({ id: cena.campaignId });
      if (cenaComApresentador(dto.tipoCena)) {
        // O estilo escolhido na criação continua valendo no storyboard.
        if (campanha.estilo === 'sem_apresentador' || !campanha.personaId) {
          throw new ConflictException(
            'Esta campanha foi criada sem apresentador — só cabem cenas de produto, mãos e unboxing.',
          );
        }
      } else if (!cena.baseImageUrl) {
        // Cena sem pessoa parte de uma foto real; a capa entra como default e
        // "Trocar foto" muda depois.
        const produto = await this.produtos.findOneBy({ id: campanha.userProductId });
        if (!produto?.images.length) {
          throw new ConflictException(
            'Este formato de cena parte de uma foto real do produto. Envie uma foto antes.',
          );
        }
        cena.baseImageUrl = produto.images[0];
      }
      cena.tipo = dto.tipoCena;
      cena.seguraProduto = dto.tipoCena === 'apresentador_produto';
      // O modo de áudio acompanha o formato quando o pedido não o trouxe.
      if (dto.modoAudio === undefined && cena.modoAudio !== 'sem_fala') {
        cena.modoAudio = cenaSemPessoa(dto.tipoCena) ? 'narracao' : 'fala';
      }
      // O prompt gravado descreve o formato antigo; a renderização refaz.
      cena.promptFinal = null;
    }

    if (dto.modoAudio !== undefined) {
      if (dto.modoAudio === 'fala' && cenaSemPessoa(cena.tipo)) {
        throw new ConflictException(
          'Cena sem pessoa em quadro não tem lábios para sincronizar — use narração ou sem fala.',
        );
      }
      if (dto.modoAudio === 'narracao' && cenaComApresentador(cena.tipo)) {
        throw new ConflictException(
          'Na cena de apresentador a voz nasce sincronizada com os lábios — narração por cima dessincronizaria a boca.',
        );
      }
      if (dto.modoAudio !== 'sem_fala') {
        // Campanha criada sem narração não tem voz de narrador nem persona
        // para emprestar a dela — não há de onde tirar o áudio.
        const campanha = await this.campanhas.findOneByOrFail({
          id: cena.campaignId,
        });
        if (campanha.vozNarrador === SEM_NARRACAO) {
          throw new ConflictException(
            'Esta campanha foi criada sem narração — as cenas ficam só com o som ambiente.',
          );
        }
      }
      cena.modoAudio = dto.modoAudio;
    }

    if (dto.baseImageUrl !== undefined) {
      // Vale para a demonstração (a foto É o frame) e para a cena do
      // apresentador com o produto na mão (a foto entra como referência da
      // composição). Cena de apresentador comum não usa foto nenhuma — mas
      // recusar aqui obrigaria a UI a repetir a regra; guardar não custa e a
      // renderização só usa quando a ação pede o produto.
      const campanha = await this.campanhas.findOneByOrFail({ id: cena.campaignId });
      const produto = await this.produtos.findOneBy({ id: campanha.userProductId });
      // A URL tem que ser uma das fotos JÁ espelhadas do produto. Sem esta
      // conferência, o cliente escolheria qualquer imagem da internet como
      // frame do vídeo — é a diferença entre trocar a foto e injetar uma.
      if (!produto?.images.includes(dto.baseImageUrl)) {
        throw new BadRequestException('Escolha uma das fotos cadastradas no produto.');
      }
      cena.baseImageUrl = dto.baseImageUrl;
    }

    return this.cenas.save(cena);
  }

  /**
   * Liga a fila de renderização: dispara a PRIMEIRA cena que falta e deixa o
   * polling (`atualizarCampanha`) avançar as demais, uma por vez.
   *
   * A versão anterior disparava todas as cenas dentro deste request — o mesmo
   * padrão que o proxy da hospedagem já derrubou na redublagem: com 6 cenas o
   * request passava do timeout, o navegador via erro de rede e ninguém sabia
   * quantas cenas tinham sido cobradas. Uma cena em voo por vez também tira a
   * disputa pela fornecedora e pelo saldo: a próxima só é cobrada quando a
   * anterior terminou.
   *
   * A cobrança continua cena a cena, dentro do `renderizarCena`. Quem desiste
   * no meio desliga a fila tendo pago só o que já rendeu, e a montagem final
   * acontece sozinha quando a última fica pronta.
   */
  async renderizarTudo(userId: string, campaignId: string) {
    const campanha = await this.campanhas.findOneBy({ id: campaignId, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');

    const cenas = await this.cenas.find({
      where: { campaignId },
      order: { ordem: 'ASC' },
    });
    if (!cenas.length) throw new ConflictException('Gere o roteiro antes de renderizar.');

    // Cenas que já falharam voltam para a fila: o clique em "gerar tudo" é o
    // pedido explícito de tentar de novo. A fila em si só consome 'pendente',
    // então uma cena que falhar DURANTE esta rodada não entra em loop.
    const falhadas = cenas.filter((c) => c.status === 'falhou');
    for (const cena of falhadas) {
      cena.status = 'pendente';
      cena.error = null;
    }
    if (falhadas.length) await this.cenas.save(falhadas);

    const pendentes = cenas.filter(
      (c) => c.status === 'pendente' || c.status === 'falhou',
    );
    if (!pendentes.length) return this.detalharCampanha(userId, campaignId);

    // O retrato é pré-requisito das cenas de apresentador. Falhar ANTES de
    // disparar qualquer uma evita cobrar metade e travar na outra metade.
    if (pendentes.some((c) => cenaComApresentador(c.tipo))) {
      const persona = await this.personaDaCampanha(campanha);
      if (!persona?.seedImageUrl || persona.status !== 'pronta') {
        throw new ConflictException(
          'O retrato do apresentador ainda não está pronto. Aguarde alguns segundos e tente de novo.',
        );
      }
    }

    campanha.renderQueue = true;
    await this.campanhas.save(campanha);

    // Já existe cena em voo (ex.: um render individual clicado antes): a fila
    // fica armada e o polling assume dali — disparar outra agora quebraria a
    // regra de UMA por vez.
    const emVoo = cenas.some((c) => c.status === 'renderizando');
    if (!emVoo) {
      try {
        await this.renderizarCena(userId, pendentes[0].id);
      } catch (error) {
        // A primeira nem disparou: desliga a fila e sobe a causa — a de
        // negócio (saldo, retrato) como veio; a de infra, traduzida.
        await this.campanhas.update(campaignId, { renderQueue: false });
        this.logger.warn(
          `render-all: cena ${pendentes[0].ordem} da campanha ${campaignId} não disparou: ${error}`,
        );
        throw new ConflictException(
          `Nenhuma cena pôde ser disparada. Motivo: ${this.causaParaOCliente(error)}`,
        );
      }
    }

    return this.detalharCampanha(userId, campaignId);
  }

  /**
   * Renderiza UMA cena. A cobrança é aqui, cena a cena: cobrar a campanha
   * inteira na frente quebra quando o vendedor desiste na metade, porque
   * ninguém sabe quanto devolver.
   */
  async renderizarCena(userId: string, sceneId: string) {
    const cena = await this.cenaDoUsuario(userId, sceneId);
    if (cena.status === 'renderizando') {
      throw new ConflictException('Esta cena já está sendo gerada.');
    }
    if (cena.status === 'pronta') return cena;

    const campanha = await this.campanhas.findOneByOrFail({ id: cena.campaignId });

    /**
     * De onde a cena parte muda tudo:
     *
     *  - cena de produto anima a FOTO REAL enviada pelo vendedor, então o
     *    anúncio mostra o produto dele e não um objeto parecido inventado;
     *  - cena de apresentador parte do retrato-semente, que é o que mantém o
     *    mesmo rosto em todas as cenas.
     *
     * Em ambos os casos a aparência vem da imagem base e do fragmento da
     * persona — nunca do texto que o vendedor digitou. A montagem acontece
     * aqui, no servidor, e não chega pronta do cliente: é o que impede o campo
     * de ação de redefinir quem (ou o quê) aparece.
     */
    let imagemBase: string | null;
    let promptFinal: string;
    let promptExtra = '';

    // O nome entra no prompt das DUAS variantes de cena: sem ele o modelo de
    // vídeo não sabe que objeto está animando — e sem saber o que é, não sabe
    // COMO ele se usa (caneta escreve, batom passa nos lábios).
    const produtoDaCena = await this.produtos.findOneBy({
      id: campanha.userProductId,
    });
    // A persona também vale para a cena de produto: a voz do narrador em off
    // é a MESMA da apresentadora — narração feminina fixa numa campanha com
    // homem denunciava a montagem.
    const personaDaCampanha = await this.personaDaCampanha(campanha);

    if (cenaSemPessoa(cena.tipo)) {
      imagemBase = cena.baseImageUrl;
      if (!imagemBase) {
        throw new ConflictException(
          'Esta cena mostra o produto, mas a foto não está mais disponível. ' +
            'Envie uma foto e gere o roteiro de novo.',
        );
      }
      /*
       * O idioma vai NO PROMPT porque o modelo de vídeo gera áudio sozinho:
       * sem instrução, ele improvisa narração em inglês — saiu exatamente
       * assim em produção. A fala da cena entra como o texto a narrar, e o
       * pt-BR vira ordem, não esperança.
       */
      promptFinal = montarPromptDeCena({
        // "No people" seco brigava com ações como "mão abre, aplica nos
        // lábios" — o proibido agora permite mãos e barra só rosto/pessoa.
        sujeito: sujeitoSemPessoa(cena.tipo, produtoDaCena?.name, campanha.comoUsa),
        acaoVisual: cena.acaoVisual,
        // Sem fala a cena é só visual — o modelo não narra, e a dublagem TTS
        // também é pulada na colheita.
        fala: cena.modoAudio === 'sem_fala' ? null : cena.fala,
        vozDescricao: vozDeNarrador(
          campanha.vozNarrador && campanha.vozNarrador !== SEM_NARRACAO
            ? { voz: campanha.vozNarrador }
            : personaDaCampanha?.attrs,
        ),
        semPessoa: true,
      });
    } else {
      const persona = personaDaCampanha;
      if (!persona?.seedImageUrl || persona.status !== 'pronta') {
        throw new ConflictException(
          'O retrato do apresentador ainda não está pronto. Aguarde antes de renderizar.',
        );
      }
      imagemBase = persona.seedImageUrl;
      /**
       * O roteiro manda o apresentador "segurar o produto" — mas o modelo de
       * vídeo parte do retrato, onde produto nenhum existe, e sem saber O QUE
       * segurar ele ignorava a ordem ou inventava um objeto qualquer. O nome
       * (e o benefício, que descreve a aparência do resultado) entra no
       * prompt para a mão ter o que mostrar.
       */
      if (produtoDaCena) {
        // Só o NOME, e nada de texto de marketing: o benefício é claim em
        // português no meio do bloco inglês — não descreve nada visual e
        // ainda desestabilizava o idioma do áudio.
        promptExtra =
          `The product is "${produtoDaCena.name}". ` +
          (campanha.comoUsa
            ? `How it is used (in Portuguese): ${campanha.comoUsa}. `
            : '') +
          'When the action involves the product, it stays clearly visible in hand.';
      }

      /**
       * Cena "com o produto na mão": o frame é COMPOSTO com as duas imagens
       * reais — retrato da persona + foto do produto — e só então animado.
       *
       * Sem isso, o modelo de vídeo partia do retrato (onde produto nenhum
       * existe) e desenhava um objeto inventado parecido. Com as referências,
       * o que aparece na mão é a réplica da foto que o vendedor subiu. Custa
       * uma geração de imagem a mais dentro dos mesmos 60 créditos (margem
       * documentada no `generateComposedVideo`).
       */
      // O tipo da cena é a fonte; a flag e a regex ficam de fallback para
      // cenas gravadas antes dele existir (a regex não pegava "passa o batom"
      // nem "veste a camiseta", justamente as ações de uso real).
      const seguraProduto =
        cena.tipo === 'apresentador_produto' ||
        cena.seguraProduto ||
        /segur|na m[ãa]o|em m[ãa]os|mostra o produto/i.test(cena.acaoVisual ?? '');
      if (seguraProduto && produtoDaCena?.images.length) {
        // A foto que vai na mão é a escolhida em "Trocar foto"; sem escolha,
        // a capa do produto.
        const fotoEscolhida =
          cena.baseImageUrl && produtoDaCena.images.includes(cena.baseImageUrl)
            ? cena.baseImageUrl
            : produtoDaCena.images[0];
        const [retrato, fotoProduto] = await Promise.all([
          this.lerCena(persona.seedImageUrl),
          this.lerCena(fotoEscolhida),
        ]);
        if (retrato && fotoProduto) {
          const framePrompt =
            'Compose a photorealistic vertical 9:16 frame: the EXACT person from the first ' +
            'reference image, same face, hair and outfit, holding the EXACT product from the ' +
            `second reference image ("${produtoDaCena.name}") in hand, close to the face, ` +
            `label facing the camera. Scene: ${cena.acaoVisual}. ` +
            (campanha.comoUsa
              ? `The person is about to use the product (how it is used, in Portuguese: ${campanha.comoUsa}). `
              : '') +
            'Do not redesign or restyle the product — reproduce it faithfully.';
          const promptVideo = montarPromptDeCena({
            sujeito:
              `${persona.promptFragment}. ` +
              // Nomear o produto: "the same product" sozinho deixava o modelo
              // largar ou trocar o objeto no meio do clipe.
              `The person keeps holding the same product ("${produtoDaCena.name}") ` +
              'clearly visible in hand for the ENTIRE clip — it is never put down, ' +
              'never swapped and never disappears.',
            acaoVisual: cena.acaoVisual,
            extras: [
              gestoDaCena(cena.ordem),
              CAMERAS_POR_CENA[(cena.ordem - 1) % CAMERAS_POR_CENA.length],
            ],
            fala: cena.modoAudio === 'sem_fala' ? null : cena.fala,
            vozDescricao: vozDaPersona(persona.attrs),
          });
          const mediaComposta = await this.dispararGeracao(cena.id, () =>
            this.videogen.generateComposedVideo(userId, {
              framePrompt,
              referencias: [retrato, fotoProduto],
              videoPrompt: promptVideo,
            }),
          );
          cena.promptFinal = promptVideo;
          cena.generatedMediaId = mediaComposta.id;
          cena.status = 'renderizando';
          cena.error = null;
          await this.cenas.save(cena);
          campanha.creditsSpent += ACTION_PRICES.video.credits;
          campanha.status = 'renderizando';
          await this.campanhas.save(campanha);
          return cena;
        }
        // Referência ilegível: segue o caminho normal — cena sem a réplica é
        // melhor que cena nenhuma, e o log diz por quê.
        this.logger.warn(
          `Cena ${cena.id}: composição com referências indisponível (retrato ou foto ilegível).`,
        );
      }
      promptFinal = montarPromptDeCena({
        // O produto entra no SUJEITO, não nos extras: extras são os primeiros
        // cortados no teto de PROMPT_MAX, e era justamente a instrução do
        // produto que sumia — e com ela o produto da mão do apresentador.
        sujeito: promptExtra
          ? `${persona.promptFragment}. ${promptExtra.trim()}`
          : persona.promptFragment,
        acaoVisual: cena.acaoVisual,
        extras: [
          // Variação determinística por cena: a instrução FIXA de "gestos
          // naturais" fazia o modelo repetir o mesmo gesto em todas as cenas.
          gestoDaCena(cena.ordem),
          CAMERAS_POR_CENA[(cena.ordem - 1) % CAMERAS_POR_CENA.length],
        ],
        fala: cena.modoAudio === 'sem_fala' ? null : cena.fala,
        vozDescricao: vozDaPersona(persona.attrs),
      });
    }

    /**
     * O frame base espelhado pode estar numa rota RELATIVA (sem
     * AWS_S3_PUBLIC_BASE o espelho devolve `/api/v1/media/s3/...`), que o
     * driver não alcança por fetch. Nesse caso o objeto é lido do bucket aqui
     * e segue como buffer — era a causa de nenhuma cena renderizar enquanto o
     * retrato (texto → imagem) funcionava.
     */
    let frame: Buffer | undefined;
    const prefixoEspelho = `${MEDIA_ROUTE}/`;
    if (imagemBase.startsWith(prefixoEspelho)) {
      const chave = imagemBase.slice(prefixoEspelho.length);
      const objeto = await this.mirror.readObject(chave);
      if (!objeto?.body?.length) {
        throw new ConflictException(
          'O frame base desta cena não pôde ser lido do armazenamento. ' +
            'Reenvie a foto do produto (ou aguarde o retrato) e tente de novo.',
        );
      }
      frame = objeto.body;
      /*
       * O driver de API da Higgsfield NÃO aceita buffer — só busca o frame
       * por URL https. A pré-assinada resolve sem abrir o bucket: acesso
       * temporário só àquele objeto. Sem ela, campanha inteira parava aqui
       * com "precisa de URL pública" (aconteceu com o bucket privado local).
       * O buffer segue junto para o driver de CLI, que prefere arquivo.
       */
      const assinada = await this.mirror.presignedUrl(chave);
      if (assinada) imagemBase = assinada;
    }

    const media = await this.dispararGeracao(cena.id, () =>
      this.videogen.generateFromImage(userId, imagemBase, promptFinal, frame),
    );

    cena.promptFinal = promptFinal;
    cena.generatedMediaId = media.id;
    cena.status = 'renderizando';
    cena.error = null;
    await this.cenas.save(cena);

    campanha.creditsSpent += ACTION_PRICES.video.credits;
    campanha.status = 'renderizando';
    await this.campanhas.save(campanha);

    return cena;
  }

  /** Colhe UMA cena em voo: consulta a fornecedora, espelha e dubla. */
  private async colherCena(
    userId: string,
    cena: CampaignScene,
    campanha: Campaign,
  ): Promise<void> {
    const media = await this.videogen.refresh(userId, cena.generatedMediaId!);
    if (media.status === 'completed' && media.outputUrl) {
      // Espelha antes de guardar: o MP4 da fornecedora expira em horas.
      cena.outputUrl =
        (await this.mirror.mirror(media.outputUrl, 'campaign-scenes', cena.id)) ??
        media.outputUrl;
      /**
       * Dublagem em pt-BR por TTS, trocando a trilha do clipe.
       *
       * O modelo de vídeo fala — mas mastiga o português a ponto de não se
       * entender (aconteceu em produção). A voz passa a vir de um TTS de
       * verdade; o áudio original é o defeito, não um fundo a preservar.
       * Best-effort: se o TTS ou o remux falhar, a cena fica com o áudio
       * original — pior áudio é melhor que cena travada em "renderizando".
       */
      cena.outputUrl = (await this.dublarCena(cena)) ?? cena.outputUrl;
      cena.status = 'pronta';
    } else if (['failed', 'nsfw', 'canceled'].includes(media.status)) {
      // O estorno já aconteceu dentro do refresh do videogen.
      cena.status = 'falhou';
      cena.error = media.error ?? 'A geração falhou.';
      campanha.creditsSpent = Math.max(
        0,
        campanha.creditsSpent - ACTION_PRICES.video.credits,
      );
    }
    await this.cenas.save(cena);
  }

  /** Consulta as cenas em andamento e fecha a campanha quando todas concluem. */
  async atualizarCampanha(userId: string, campaignId: string) {
    const campanha = await this.campanhas.findOneBy({ id: campaignId, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');

    const cenas = await this.cenas.find({ where: { campaignId } });
    for (const cena of cenas) {
      if (cena.status !== 'renderizando' || !cena.generatedMediaId) continue;
      /*
       * Cada cena tem o seu try: um erro transitório da fornecedora (ou do
       * espelho) numa cena derrubava o refresh INTEIRO como 500 — a tela
       * parava de atualizar, a fila não avançava e uma geração já concluída
       * ficava presa em "renderizando" para sempre. Logar e seguir deixa o
       * próximo poll tentar de novo, que é o comportamento certo para falha
       * passageira.
       */
      try {
        await this.colherCena(userId, cena, campanha);
      } catch (error) {
        this.logger.warn(
          `Refresh da cena ${cena.id} (campanha ${campaignId}) falhou: ${error}`,
        );
      }
    }
    const atualizadas = await this.cenas.find({ where: { campaignId } });
    const todasProntas =
      atualizadas.length > 0 && atualizadas.every((c) => c.status === 'pronta');
    if (todasProntas) campanha.status = 'pronta';
    await this.campanhas.save(campanha);

    // A fila avança AQUI, dentro do polling: com a cena anterior resolvida
    // acima, este é o momento em que existe vaga para a próxima. Depois do
    // save de propósito — o disparo grava créditos e status por conta
    // própria, e um save posterior com o objeto velho os apagaria.
    if (campanha.renderQueue) await this.avancarFila(userId, campaignId);

    /**
     * Monta sozinho assim que a última cena fica pronta. É o que o vendedor
     * quer: ele pediu um vídeo, não seis pedaços. Falha aqui não pode derrubar
     * a consulta de status — as cenas continuam prontas e o botão de montar
     * de novo fica disponível.
     */
    if (
      todasProntas &&
      !campanha.finalVideoUrl &&
      this.assembly.enabled &&
      !this.montagensEmVoo.has(campaignId)
    ) {
      try {
        return await this.montar(userId, campaignId);
      } catch (error) {
        this.logger.warn(`Montagem automática falhou (${campaignId}): ${error}`);
      }
    }

    return this.detalharCampanha(userId, campaignId);
  }

  /**
   * Um passo da fila de renderização: se não há cena em voo, dispara a
   * próxima 'pendente'; se não sobrou nenhuma, desliga a fila.
   *
   * Regras que fazem a fila ser segura:
   *  - UMA cena em voo por vez — a próxima só é cobrada quando a anterior
   *    terminou, então desistir no meio nunca deixa cobrança órfã;
   *  - só consome 'pendente' — cena que falha na fornecedora vira 'falhou'
   *    (estornada) e NÃO é retentada sozinha, senão um defeito permanente
   *    viraria loop de disparo;
   *  - falha no DISPARO (saldo, CLI fora) marca a cena com a causa real e
   *    desliga a fila — repetir a mesma falha nas cenas seguintes a cada 6s
   *    só encheria a tela de erros idênticos.
   */
  /**
   * O que o CLIENTE lê quando um disparo falha.
   *
   * Erro de negócio (4xx: saldo insuficiente, retrato não pronto) passa como
   * veio — é acionável por ele. Erro de infra (5xx ou inesperado) NUNCA passa:
   * "configure AWS_S3_PUBLIC_BASE ou use o driver de CLI" chegou à tela de um
   * vendedor — é instrução para a gente, não para ele. A causa real fica no
   * log, que é onde o suporte procura.
   */
  /**
   * Chama a fornecedora com a tradução de erro aplicada NA ORIGEM: todo
   * caminho que dispara geração (fila, render-all, clique manual) passa por
   * aqui, então nenhum deles vaza detalhe de infra para a tela.
   */
  private async dispararGeracao<T>(
    cenaId: string,
    submit: () => Promise<T>,
  ): Promise<T> {
    try {
      return await submit();
    } catch (error) {
      this.logger.error(`Disparo da cena ${cenaId} falhou: ${error}`);
      if (error instanceof HttpException && error.getStatus() < 500) throw error;
      throw new ConflictException(this.causaParaOCliente(error));
    }
  }

  private causaParaOCliente(error: unknown): string {
    if (error instanceof HttpException && error.getStatus() < 500) {
      return String(
        (error.getResponse() as { message?: string })?.message ?? error.message,
      );
    }
    return (
      'instabilidade temporária na geração de vídeo. ' +
      'Nenhum crédito foi cobrado — tente de novo em alguns minutos.'
    );
  }

  private async avancarFila(userId: string, campaignId: string): Promise<void> {
    if (this.filasEmVoo.has(campaignId)) return;
    this.filasEmVoo.add(campaignId);
    try {
      const cenas = await this.cenas.find({
        where: { campaignId },
        order: { ordem: 'ASC' },
      });
      if (cenas.some((c) => c.status === 'renderizando')) return;

      const proxima = cenas.find((c) => c.status === 'pendente');
      if (!proxima) {
        // Acabaram as pendentes (prontas ou falhadas): a fila cumpriu o que
        // tinha; a montagem automática decide sozinha logo adiante.
        await this.campanhas.update(campaignId, { renderQueue: false });
        return;
      }

      try {
        await this.renderizarCena(userId, proxima.id);
        this.logger.log(
          `Fila da campanha ${campaignId}: cena ${proxima.ordem} disparada.`,
        );
      } catch (error) {
        this.logger.warn(
          `Fila da campanha ${campaignId}: cena ${proxima.ordem} não disparou: ${error}`,
        );
        proxima.status = 'falhou';
        proxima.error = `A cena não pôde ser disparada: ${this.causaParaOCliente(error)}`;
        await this.cenas.save(proxima);
        await this.campanhas.update(campaignId, { renderQueue: false });
      }
    } finally {
      this.filasEmVoo.delete(campaignId);
    }
  }

  /**
   * Monta as cenas prontas num único MP4.
   *
   * Não cobra créditos: é processamento nosso, sem chamada de IA. Exige TODAS
   * as cenas prontas de propósito — montar pela metade entrega um vídeo que
   * corta no meio da frase, e o vendedor publicaria sem perceber.
   */
  async montar(userId: string, campaignId: string) {
    const campanha = await this.campanhas.findOneBy({ id: campaignId, userId });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');
    if (!this.assembly.enabled) {
      throw new ConflictException(
        'A montagem não está disponível neste servidor (ffmpeg ausente).',
      );
    }
    if (this.montagensEmVoo.has(campaignId)) {
      throw new ConflictException('A montagem já está em andamento — aguarde.');
    }
    this.montagensEmVoo.add(campaignId);
    try {
      return await this.montarInterno(userId, campanha, campaignId);
    } finally {
      this.montagensEmVoo.delete(campaignId);
    }
  }

  private async montarInterno(
    userId: string,
    campanha: Campaign,
    campaignId: string,
  ) {

    const cenas = await this.cenas.find({
      where: { campaignId },
      order: { ordem: 'ASC' },
    });
    if (!cenas.length) {
      throw new ConflictException('Gere o roteiro antes de montar.');
    }
    const pendentes = cenas.filter((c) => c.status !== 'pronta');
    if (pendentes.length) {
      throw new ConflictException(
        `Faltam ${pendentes.length} cena(s) para renderizar antes de montar.`,
      );
    }

    // As cenas estão no nosso bucket: lê direto, sem passar pela rede pública.
    const arquivos: Buffer[] = [];
    for (const cena of cenas) {
      const buffer = await this.lerCena(cena.outputUrl);
      if (!buffer) {
        throw new ConflictException(
          `O vídeo da cena ${cena.ordem} não pôde ser lido. Renderize-a de novo.`,
        );
      }
      arquivos.push(buffer);
    }

    // As falas viram legenda queimada na montagem — é como a fala chega a
    // quem assiste sem som, que é a maioria.
    let final: Buffer;
    try {
      final = await this.assembly.juntar(
        arquivos,
        undefined,
        // Legenda é escolha da campanha; desligada, as cenas entram limpas.
        campanha.subtitles ? cenas.map((c) => c.fala ?? null) : [],
      );
    } catch (error) {
      // Sem isto o erro do ffmpeg subia como 500 "Internal server error" — a
      // montagem automática falhava em silêncio no log e o clique manual não
      // dizia nada de útil.
      this.logger.error(`Montagem da campanha ${campaignId} falhou: ${error}`);
      throw new ConflictException(
        `A montagem falhou no servidor: ${(error as Error).message ?? error}. ` +
          'As cenas continuam prontas — tente de novo em instantes.',
      );
    }
    const url = await this.mirror.putVideo(final, 'campaign-final', campanha.id);
    if (!url) {
      throw new ConflictException('O vídeo montado não pôde ser guardado.');
    }

    campanha.finalVideoUrl = url;
    campanha.status = 'pronta';
    await this.campanhas.save(campanha);
    this.logger.log(
      `Campanha ${campanha.id} montada: ${cenas.length} cenas, ${Math.round(final.byteLength / 1024)}KB`,
    );

    return this.detalharCampanha(userId, campaignId);
  }

  /**
   * Redublagem manual de uma cena já pronta.
   *
   * Existe para as cenas que nasceram ANTES da dublagem automática — com a
   * fala do modelo de vídeo em português mastigado — e para quando o vendedor
   * edita a fala e quer o áudio acompanhando. Não custa crédito: refazer voz
   * é TTS + remux (~R$ 0,01), não uma nova renderização.
   *
   * O vídeo final montado fica obsoleto na hora: ele carrega o áudio antigo
   * da cena, então é descartado e a montagem automática refaz com a voz nova.
   */
  async redublarCena(userId: string, sceneId: string) {
    const cena = await this.cenaDoUsuario(userId, sceneId);
    if (cena.status !== 'pronta' || !cena.outputUrl) {
      throw new ConflictException('Só uma cena já renderizada pode ser redublada.');
    }
    // Mesma regra da dublagem automática: TTS sobre o apresentador dessincroniza
    // os lábios — a voz dele já nasce sincronizada no próprio vídeo.
    if (!cenaSemPessoa(cena.tipo)) {
      throw new ConflictException(
        'A cena do apresentador mantém a voz original, sincronizada com os lábios. ' +
          'A regravação por narração vale só para cenas sem pessoa em quadro.',
      );
    }
    if (cena.modoAudio === 'sem_fala') {
      throw new ConflictException(
        'Esta cena foi gerada sem fala. Mude o áudio dela para narração e renderize de novo para ter voz.',
      );
    }
    if (!cena.fala?.trim()) {
      throw new ConflictException('Esta cena não tem fala para narrar.');
    }
    if (!this.assembly.enabled) {
      throw new ConflictException('A dublagem não está disponível neste servidor (ffmpeg ausente).');
    }

    /*
     * O trabalho pesado (TTS + ffmpeg + S3) roda FORA do request.
     *
     * Dentro dele, o proxy da hospedagem derrubava a conexão antes da
     * resposta: o navegador via um erro de rede genérico, o usuário lia
     * "não redublou" — e às vezes o servidor até terminava o serviço depois,
     * sem ninguém ficar sabendo. Responder já e processar em background é a
     * única forma de conviver com o timeout do proxy sem fila externa.
     */
    void this.processarRedublagem(cena.id).catch((error) =>
      this.logger.warn(`Redublagem em background falhou (${cena.id}): ${error}`),
    );
    return { ...cena, redublagem: 'processando' as const };
  }

  /**
   * A parte demorada da redublagem — SEMPRE fora do ciclo de request.
   *
   * Cada etapa tem nome, e a falha fica GRAVADA em `cena.error` mesmo com a
   * cena pronta: a versão anterior falhava em silêncio no log do servidor, e
   * a tela dizia "regravando" para uma regravação que nunca aconteceu — três
   * vezes seguidas, sem ninguém saber por quê.
   */
  private async processarRedublagem(sceneId: string): Promise<void> {
    const cena = await this.cenas.findOneByOrFail({ id: sceneId });

    const falhar = async (motivo: string) => {
      this.logger.warn(`Redublagem da cena ${sceneId}: ${motivo}`);
      cena.error = `Redublagem falhou: ${motivo}`;
      await this.cenas.save(cena);
    };

    const video = await this.lerCena(cena.outputUrl);
    if (!video) return falhar('o clipe da cena não pôde ser lido do armazenamento.');

    const narracao = await this.ai.narrar(
      falaParaAudio(cena.fala ?? ''),
      await this.vozTtsDaCampanha(cena.campaignId),
    );
    if (!narracao) {
      return falhar('a voz não pôde ser gerada (TTS indisponível ou sem chave).');
    }

    let dublado: Buffer;
    try {
      dublado = await this.assembly.dublar(video, narracao);
    } catch (error) {
      return falhar(`a troca de áudio falhou no ffmpeg — ${(error as Error).message}`);
    }

    const dublada = await this.mirror.putVideo(
      dublado,
      'campaign-scenes',
      `${cena.id}-ptbr`,
    );
    if (!dublada) return falhar('o clipe dublado não pôde ser guardado no S3.');

    cena.outputUrl = dublada;
    cena.error = null;
    await this.cenas.save(cena);

    // O vídeo final montado carrega o áudio antigo: descartar aqui faz a
    // montagem automática refazer com a voz nova no próximo refresh.
    const campanha = await this.campanhas.findOneByOrFail({ id: cena.campaignId });
    if (campanha.finalVideoUrl) {
      campanha.finalVideoUrl = null;
      await this.campanhas.save(campanha);
    }
    this.logger.log(`Cena ${sceneId} redublada em pt-BR.`);
  }

  /**
   * Timbre e tom do TTS conforme a persona da campanha. Nunca lança: sem
   * persona (apagada?) o TTS cai nos defaults — dublagem com voz padrão é
   * melhor que dublagem nenhuma.
   */
  /** Persona da campanha — null no estilo `sem_apresentador`. */
  private async personaDaCampanha(campanha: Campaign): Promise<Persona | null> {
    if (!campanha.personaId) return null;
    return this.personas.findOneBy({ id: campanha.personaId });
  }

  private async vozTtsDaCampanha(
    campaignId: string,
  ): Promise<{ timbre: string; estilo: string } | undefined> {
    try {
      const campanha = await this.campanhas.findOneByOrFail({ id: campaignId });
      // A voz escolhida na criação (campanha sem apresentador) vence a da
      // persona — é a única fonte de voz que esse estilo tem.
      if (campanha.vozNarrador === SEM_NARRACAO) return undefined;
      if (campanha.vozNarrador) {
        const attrs = { voz: campanha.vozNarrador };
        return { timbre: timbreTts(attrs), estilo: tomDaPersona(attrs).tts };
      }
      const persona = await this.personaDaCampanha(campanha);
      if (!persona) return undefined;
      return {
        timbre: timbreTts(persona.attrs),
        estilo: tomDaPersona(persona.attrs).tts,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Gera a narração da fala e devolve a URL do clipe dublado — ou null para
   * manter o original. Só toca no S3 quando TODA a cadeia deu certo.
   */
  private async dublarCena(cena: CampaignScene): Promise<string | null> {
    /*
     * SÓ cena de produto é dublada. Na cena de apresentador o modelo de vídeo
     * gera a fala COM os lábios sincronizados — trocar a trilha por TTS
     * deixava a boca dizendo uma coisa e o áudio outra, e a voz mudava de uma
     * cena para a seguinte (defeito grave visto em uso real). Na cena de
     * produto não há rosto na tela, então a narração TTS limpa só melhora.
     */
    if (!cenaSemPessoa(cena.tipo)) return null;
    // `sem_fala` fica com o áudio ambiente que o modelo gerou — dublar uma
    // cena muda deixaria narração órfã sobre um clipe que não a pediu.
    if (cena.modoAudio !== 'narracao') return null;
    if (!cena.fala?.trim() || !this.assembly.enabled) return null;
    try {
      const [video, narracao] = await Promise.all([
        this.lerCena(cena.outputUrl),
        this.vozTtsDaCampanha(cena.campaignId).then((voz) =>
          this.ai.narrar(falaParaAudio(cena.fala!), voz),
        ),
      ]);
      if (!video || !narracao) return null;
      const dublado = await this.assembly.dublar(video, narracao);
      // Sufixo no id: o espelho é content-addressed por origem, e regravar na
      // mesma chave do original serviria o vídeo antigo do cache.
      return await this.mirror.putVideo(dublado, 'campaign-scenes', `${cena.id}-ptbr`);
    } catch (error) {
      this.logger.warn(`Dublagem da cena ${cena.id} falhou: ${error}`);
      return null;
    }
  }

  /** Lê o MP4 da cena — do bucket quando é nosso, da URL quando ainda não é. */
  private async lerCena(url: string | null): Promise<Buffer | null> {
    if (!url) return null;
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

  async removerCampanha(userId: string, id: string): Promise<void> {
    // As gerações das cenas vão junto — coletadas ANTES do delete, porque a
    // cascata das cenas apaga a referência. Sem isso, "Minhas Gerações" fica
    // com vídeos de uma campanha que não existe mais (e cuja URL expira).
    const cenas = await this.cenas.find({
      where: { campaignId: id },
      select: { generatedMediaId: true },
    });
    const r = await this.campanhas.delete({ id, userId });
    if (!r.affected) throw new NotFoundException('Campanha não encontrada.');
    await this.videogen.deleteMany(
      userId,
      cenas.map((c) => c.generatedMediaId),
    );
  }

  /** Toda cena é alcançada pelo dono da campanha — nunca pelo id solto. */
  private async cenaDoUsuario(userId: string, sceneId: string): Promise<CampaignScene> {
    const cena = await this.cenas
      .createQueryBuilder('s')
      .innerJoin(Campaign, 'c', 'c.id = s."campaignId"')
      .where('s.id = :sceneId AND c."userId" = :userId', { sceneId, userId })
      .getOne();
    if (!cena) throw new NotFoundException('Cena não encontrada.');
    return cena;
  }
}
