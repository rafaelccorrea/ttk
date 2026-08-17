import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { readFile, unlink } from 'node:fs/promises';
import { In, LessThan, Repository } from 'typeorm';
import {
  ACTION_PRICES,
  TRANSCRIBE_MAX_MINUTES,
  transcribeBlocks,
} from '../billing/billing.config';
import { BillingService } from '../billing/billing.service';
import { AiService, ProdutoExtraido } from '../studio/ai.service';
import { TranscriptionService } from '../studio/transcription.service';
import { AudioChunkerService, FatiaDeAudio } from './audio-chunker.service';
import {
  AtualizarFaqDto,
  AtualizarProdutoDto,
  CriarFaqDto,
  CriarLiveSessionDto,
  CriarProdutoDto,
} from './dto/live.dto';
import { LiveFaq } from './entities/live-faq.entity';
import { LiveProduct } from './entities/live-product.entity';
import { LiveSession } from './entities/live-session.entity';

/**
 * Tamanho mínimo do bloco que vai ao Claude, em segundos.
 *
 * As fatias de áudio existem por causa do limite de upload do Whisper (15 min
 * cada) e são pequenas demais para servir de unidade de extração: um produto
 * anunciado no fim de uma fatia tem o preço dito no começo da seguinte, e o
 * modelo, vendo só metade, inventa a outra. Juntar fatias até passar de vinte
 * minutos põe apresentação, preço e objeções do mesmo item na mesma leitura, e
 * ainda cabe folgado na janela do Sonnet.
 *
 * É um PISO, não um teto, e a diferença é o que fazia a versão anterior nunca
 * agrupar nada: com fatias de 15 min, exigir que a soma coubesse em 20 min
 * rejeitava toda junção (15+15=30) e cada bloco acabava sendo exatamente uma
 * fatia — o problema que o agrupamento existe para resolver, intacto, e uma
 * chamada de LLM por fatia. Fechando o bloco quando ele PASSA do piso, duas
 * fatias viram um bloco de 30 min e a fronteira cai pela metade.
 */
const SEGUNDOS_POR_BLOCO = 20 * 60;

/**
 * Trava de tamanho do bloco, em caracteres.
 *
 * O corte por tempo depende de o ffmpeg conseguir medir cada fatia; quando ele
 * não consegue, a duração vem zero e o critério de tempo nunca fecha o bloco —
 * a live inteira viraria uma chamada só, com transcrição de horas dentro. Este
 * teto é o cinto de segurança: ~60 mil caracteres é bem menos que a janela do
 * Sonnet e mais do que 20 minutos de fala jamais ocupam.
 */
const MAX_CHARS_POR_BLOCO = 60_000;

/**
 * Quantos pipelines de live podem rodar ao mesmo tempo neste processo.
 *
 * Cada um mantém um ffmpeg vivo, um arquivo de gravação em disco e uma fila de
 * requests ao Whisper. Sem teto, N uploads simultâneos viram N ffmpegs
 * disputando CPU e N gravações ocupando o tmp — e o processo da API, que é o
 * mesmo, para de responder. Quem chegar além do teto recebe uma mensagem para
 * tentar de novo em vez de degradar a instância para todo mundo.
 */
const MAX_PIPELINES_SIMULTANEOS = 2;

/**
 * De quanto em quanto tempo o pipeline vivo assina presença no banco.
 *
 * O cron decide quem morreu olhando `processingStartedAt`; se esse carimbo só
 * fosse escrito no início, qualquer live longa (a transcrição de 4h passa de
 * uma hora) seria declarada morta enquanto ainda roda — e o usuário reenviaria
 * a gravação, criando um segundo pipeline sobre a mesma sessão. Com o batimento
 * o carimbo significa "estava vivo agora há pouco", que é o que o cron precisa.
 */
const INTERVALO_DE_BATIMENTO_MS = 60_000;

/**
 * Quanto do fim da fatia anterior vai como `prompt` da próxima.
 *
 * É contexto léxico para o Whisper (ver `transcribeBuffer`), não instrução:
 * duzentos caracteres bastam para carregar os nomes próprios que acabaram de
 * ser ditos — o nome do produto, a marca, o cupom — sem empurrar o modelo a
 * repetir a frase anterior.
 */
const CHARS_DE_CONTEXTO = 200;

/**
 * A partir de quando uma sessão em processamento é considerada morta.
 *
 * Uma live de 4h passa por dezesseis chamadas ao Whisper e mais algumas ao
 * Claude; quinze minutos é maior que qualquer etapa isolada e menor que a
 * paciência de quem está olhando a tela.
 */
const MINUTOS_ATE_CONSIDERAR_TRAVADA = 15;

@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);

  /**
   * Sessões com pipeline vivo NESTE processo. Serve para duas coisas: limitar a
   * concorrência e impedir que um reenvio abra um segundo pipeline sobre uma
   * sessão que ainda está sendo processada aqui.
   */
  private readonly emAndamento = new Set<string>();

  constructor(
    @InjectRepository(LiveSession)
    private readonly sessoes: Repository<LiveSession>,
    @InjectRepository(LiveProduct)
    private readonly produtos: Repository<LiveProduct>,
    @InjectRepository(LiveFaq)
    private readonly faq: Repository<LiveFaq>,
    private readonly chunker: AudioChunkerService,
    private readonly transcricao: TranscriptionService,
    private readonly ai: AiService,
    private readonly billing: BillingService,
  ) {}

  // ---------------------------------------------------------------- sessões
  async criarSessao(userId: string, dto: CriarLiveSessionDto) {
    return this.sessoes.save(
      this.sessoes.create({
        userId,
        title: dto.title.trim(),
        status: 'rascunho',
        sourceKind: 'gravada',
      }),
    );
  }

  async listarSessoes(userId: string) {
    return this.sessoes.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async obterSessao(userId: string, id: string) {
    const sessao = await this.acharSessao(userId, id);
    const [produtos, faq] = await Promise.all([
      this.produtos.find({
        where: { userId, liveSessionId: id },
        // Confiança baixa primeiro: a tela existe para revisar, e o que a IA
        // menos garantiu é justamente o que precisa do olho do vendedor antes.
        order: { active: 'DESC', confidence: 'ASC', createdAt: 'ASC' },
      }),
      this.faq.find({
        where: { userId, liveSessionId: id },
        order: { priority: 'DESC', createdAt: 'ASC' },
      }),
    ]);
    return { ...sessao, produtos, faq };
  }

  async apagarSessao(userId: string, id: string) {
    const sessao = await this.acharSessao(userId, id);
    // Produtos e FAQ saem por CASCADE/SET NULL declarados nas entidades.
    await this.sessoes.remove(sessao);
  }

  // ----------------------------------------------------------------- upload
  /**
   * Recebe a gravação e devolve na hora.
   *
   * Transcrever uma live de 4h leva dezenas de minutos: segurar a request até
   * o fim significaria um timeout de proxy garantido e o usuário sem saber se
   * o trabalho continuou do outro lado. Então a rota faz só o que é barato —
   * checar o dono, checar que não há outro processamento em voo, marcar o
   * status — e solta o pipeline em background. O front acompanha por `status`,
   * que é exatamente para isso que a coluna existe.
   *
   * A gravação em si nunca entra em memória: o Multer já a escreveu em disco
   * (ver `PASTA_DE_UPLOAD` no controller) e o que trafega daqui para baixo é o
   * caminho do arquivo, apagado pelo pipeline quando ele termina.
   */
  async processarUpload(
    userId: string,
    sessionId: string,
    file: Express.Multer.File,
  ) {
    const caminho = file?.path;
    try {
      const sessao = await this.acharSessao(userId, sessionId);
      /*
       * Dois guardas, não um. O status no banco pega o caso normal; o conjunto
       * em memória pega o caso que já custou caro: uma sessão marcada como
       * 'erro' pelo cron enquanto o pipeline dela ainda roda neste processo.
       * Sem ele, o reenvio abriria um segundo pipeline sobre a mesma sessão —
       * dois débitos, dois `gravarBase`, e o delete de origem 'ia' de um
       * apagando o que o outro acabou de escrever.
       */
      if (
        this.emAndamento.has(sessionId) ||
        sessao.status === 'transcrevendo' ||
        sessao.status === 'extraindo'
      ) {
        throw new ConflictException(
          'Esta live já está sendo processada. Aguarde terminar antes de enviar outra gravação.',
        );
      }
      if (!caminho || !file.size) {
        throw new BadRequestException('Envie a gravação da live.');
      }
      if (!this.chunker.enabled) {
        throw new BadRequestException(
          'Processamento de live indisponível: o ffmpeg não está instalado neste ambiente.',
        );
      }
      if (!this.transcricao.isConfigured) {
        throw new BadRequestException(
          'Processamento de live indisponível: a transcrição não está configurada.',
        );
      }
      /*
       * A IA é checada na rota junto com o ffmpeg e o Whisper porque, sem
       * chave, `extrairConhecimentoDaLive` apenas loga e devolve vazio — não
       * lança. Sem esta guarda o usuário pagava a transcrição e a extração para
       * receber uma base vazia, sem erro nenhum na tela.
       */
      if (!this.ai.enabled) {
        throw new BadRequestException(
          'Processamento de live indisponível: a extração por IA não está configurada.',
        );
      }
      if (this.emAndamento.size >= MAX_PIPELINES_SIMULTANEOS) {
        throw new ConflictException(
          'Já há lives demais sendo processadas agora. Tente novamente em alguns minutos.',
        );
      }

      sessao.status = 'transcrevendo';
      sessao.processingStartedAt = new Date();
      sessao.errorMessage = null;
      await this.sessoes.save(sessao);

      const nome = file.originalname || 'live.mp4';
      this.emAndamento.add(sessionId);
      void this.executarPipeline(userId, sessao.id, caminho, nome).catch(
        (error) => {
          // O pipeline já grava o erro na sessão; este catch é a última rede
          // para que uma falha em background não vire unhandled rejection.
          this.logger.error(`Pipeline da live ${sessao.id} falhou: ${error}`);
        },
      );

      return sessao;
    } catch (error) {
      // Recusado antes de começar: o arquivo em disco não tem mais dono.
      if (caminho) await unlink(caminho).catch(() => undefined);
      throw error;
    }
  }

  private async executarPipeline(
    userId: string,
    sessionId: string,
    entradaPath: string,
    nome: string,
  ): Promise<void> {
    // Enquanto este intervalo bate, o cron sabe que a sessão está viva.
    const batimento = setInterval(() => {
      void this.sessoes
        .update({ id: sessionId, userId }, { processingStartedAt: new Date() })
        .catch((e) =>
          this.logger.warn(`Batimento da live ${sessionId} falhou: ${e}`),
        );
    }, INTERVALO_DE_BATIMENTO_MS);
    batimento.unref?.();

    try {
      await this.chunker.comAudioExtraido(
        entradaPath,
        nome,
        async ({ audioPath, durationSeconds, pasta }) => {
          /*
           * A duração só é conhecida aqui, depois da extração — o `mimetype` e
           * o tamanho do upload não dizem quantas horas o arquivo tem. Por isso
           * o teto é checado neste ponto e não na rota: gastar um `-vn` de
           * ffmpeg para descobrir que o arquivo é absurdo é barato perto de
           * mandar 6h de áudio para o Whisper.
           */
          if (durationSeconds && durationSeconds > TRANSCRIBE_MAX_MINUTES * 60) {
            throw new BadRequestException(
              `A gravação tem ${Math.round(durationSeconds / 60)} minutos e o limite é de ${TRANSCRIBE_MAX_MINUTES}. Corte a live em partes e envie uma de cada vez.`,
            );
          }

          // Sem duração legível, cobra-se o mínimo de um bloco. É o único
          // palpite honesto disponível, e ele erra a favor do usuário.
          const blocosCobrados = transcribeBlocks(durationSeconds ?? 0);
          const fatias = await this.chunker.fatiar(audioPath, pasta);

          /*
           * A cobrança é registrada na sessão ANTES do trabalho começar, e é
           * isso que permite estornar depois de um restart: `withCharge` só
           * estorna quando há exceção, e um processo morto não lança nada.
           * Com o débito anotado em `pendingTranscribeBlocks`, o estorno passa
           * a ser possível tanto no `catch` daqui quanto no cron.
           */
          await this.billing.charge(userId, 'transcribe', blocosCobrados);
          await this.sessoes.update(
            { id: sessionId, userId },
            { pendingTranscribeBlocks: blocosCobrados },
          );

          const trechos = await this.transcreverFatias(fatias);

          const transcript = trechos
            .map((t) => t.texto)
            .filter(Boolean)
            .join('\n\n')
            .trim();

          await this.sessoes.update(
            { id: sessionId, userId },
            {
              status: 'extraindo',
              transcript,
              durationSeconds: durationSeconds ?? null,
              processingStartedAt: new Date(),
              creditsSpent: ACTION_PRICES.transcribe.credits * blocosCobrados,
            },
          );

          await this.billing.charge(userId, 'live_extract');
          await this.sessoes.update(
            { id: sessionId, userId },
            { pendingExtractCharge: true },
          );

          const base = await this.extrairBase(trechos);
          if (!base.produtos.length && !base.faq.length) {
            /*
             * Base vazia é falha, não resultado. Sair daqui com 'pronta' e uma
             * tela em branco cobraria a live inteira por nada — e as duas
             * causas reais (recusa do modelo, erro engolido no MAP) são
             * exatamente as que o usuário não tem como diagnosticar. Lançar põe
             * a sessão em erro e devolve os créditos.
             */
            throw new Error(
              'Não consegui identificar nenhum produto ou pergunta nesta gravação. Confira se o áudio tem a fala da live e tente novamente.',
            );
          }

          /*
           * Gravar a base faz parte da entrega, então acontece ANTES de a
           * cobrança ser dada por paga: se o `save` falhar (constraint,
           * deadlock, queda do Postgres), o `catch` estorna tudo. Deixar a
           * persistência fora da região protegida cobrava o usuário por uma
           * base que nunca chegou ao banco.
           */
          await this.gravarBase(userId, sessionId, base.produtos, base.faq);

          await this.sessoes.update(
            { id: sessionId, userId },
            {
              status: 'pronta',
              processingStartedAt: null,
              errorMessage: null,
              // Entregue: não há mais nada a estornar.
              pendingTranscribeBlocks: 0,
              pendingExtractCharge: false,
              creditsSpent:
                ACTION_PRICES.transcribe.credits * blocosCobrados +
                ACTION_PRICES.live_extract.credits,
            },
          );
        },
      );
    } catch (error) {
      const mensagem =
        error instanceof Error ? error.message : 'Falha desconhecida.';
      this.logger.error(`Live ${sessionId}: ${mensagem}`);
      await this.estornarPendentes(sessionId, 'Live: processamento falhou');
      await this.sessoes
        .update(
          { id: sessionId, userId },
          {
            status: 'erro',
            processingStartedAt: null,
            errorMessage: mensagem.slice(0, 500),
          },
        )
        .catch((e) =>
          this.logger.error(`Não consegui marcar a live ${sessionId} como erro: ${e}`),
        );
    } finally {
      clearInterval(batimento);
      this.emAndamento.delete(sessionId);
      // O upload é nosso desde `processarUpload`; ninguém mais vai apagá-lo.
      await unlink(entradaPath).catch(() => undefined);
    }
  }

  /**
   * Devolve o que foi debitado e ainda não virou entrega.
   *
   * Lê os marcadores da própria sessão em vez de receber valores por parâmetro
   * porque o chamador mais importante é o cron, que só encontra o rastro da
   * cobrança no banco — o processo que debitou já não existe.
   *
   * Zerar os marcadores não basta para impedir o estorno em dobro: num deploy
   * rolling, ou com duas instâncias disparando o cron no mesmo minuto, as duas
   * leem os marcadores cheios antes de qualquer gravação e ambas devolveriam o
   * mesmo crédito. Por isso o UPDATE repete os valores lidos na condição e o
   * estorno só acontece para quem conseguiu zerá-los — é o mesmo cuidado que o
   * `combinations.service.ts` toma no estorno de montagem interrompida.
   */
  private async estornarPendentes(
    sessionId: string,
    motivo: string,
  ): Promise<void> {
    try {
      const sessao = await this.sessoes.findOneBy({ id: sessionId });
      if (!sessao) return;
      const blocos = sessao.pendingTranscribeBlocks ?? 0;
      const extracao = sessao.pendingExtractCharge ?? false;
      if (!blocos && !extracao) return;

      const zerou = await this.sessoes.update(
        {
          id: sessionId,
          pendingTranscribeBlocks: blocos,
          pendingExtractCharge: extracao,
        },
        { pendingTranscribeBlocks: 0, pendingExtractCharge: false },
      );
      if (!zerou.affected) return;

      if (blocos > 0) {
        await this.billing.refund(sessao.userId, 'transcribe', motivo, blocos);
      }
      if (extracao) {
        await this.billing.refund(sessao.userId, 'live_extract', motivo);
      }
      this.logger.warn(
        `Live ${sessionId}: estornados ${blocos} bloco(s) de transcrição${extracao ? ' + extração' : ''}.`,
      );
    } catch (e) {
      this.logger.error(`Falha ao estornar a live ${sessionId}: ${e}`);
    }
  }

  /**
   * Transcreve as fatias em sequência, cada uma sabendo o que veio antes.
   *
   * Sequencial de propósito, embora paralelizar fosse trivial: o `prompt` de
   * uma fatia é o fim da transcrição da anterior, e é ele que segura a grafia
   * do nome do produto ao longo das horas de live. Em paralelo, nenhuma fatia
   * teria esse contexto e o mesmo item sairia escrito de três formas — que a
   * consolidação depois trataria como três produtos diferentes.
   */
  private async transcreverFatias(
    fatias: FatiaDeAudio[],
  ): Promise<Array<{ texto: string; inicioSec: number; duracaoSec: number }>> {
    const trechos: Array<{ texto: string; inicioSec: number; duracaoSec: number }> =
      [];
    let offsetSec = 0;
    let contexto = '';

    for (let i = 0; i < fatias.length; i += 1) {
      // Uma fatia por vez em memória, e liberada assim que a request termina:
      // é o que mantém o pico do pipeline em alguns MB em vez de gigabytes.
      const conteudo = await readFile(fatias[i].caminho);
      const { transcript } = await this.transcricao.transcribeBuffer(
        conteudo,
        `fatia-${String(i).padStart(3, '0')}.ogg`,
        {
          mimetype: 'audio/ogg',
          prompt: contexto || undefined,
        },
      );

      /*
       * Os tempos que o Whisper devolve são relativos ao início da FATIA, e o
       * que a base precisa é o segundo da live — é por ele que o vendedor volta
       * na gravação para conferir o preço. Somar o offset acumulado é o que
       * traduz um para o outro.
       *
       * A duração é a do ARQUIVO, medida pelo ffmpeg, e não o fim do último
       * segmento do Whisper. O último segmento marca o fim da FALA, não o fim
       * da fatia: quinze minutos que terminam em música ou silêncio (o normal
       * numa live de vendas) adiantariam todo o resto da linha do tempo, e uma
       * fatia sem fala nenhuma zerava o avanço do offset — erro cumulativo e
       * silencioso, que só aparece quando o vendedor abre a gravação no ponto
       * indicado e não encontra o produto. O tempo nominal da fatia também não
       * serve, porque o corte com `-c copy` cai na fronteira de pacote.
       */
      const duracaoSec = fatias[i].duracaoSec ?? 0;
      if (!duracaoSec) {
        this.logger.warn(
          `Fatia ${i} da live sem duração legível: as marcações de tempo a partir daqui podem sair deslocadas.`,
        );
      }

      trechos.push({ texto: transcript, inicioSec: offsetSec, duracaoSec });
      offsetSec += duracaoSec;
      contexto = transcript.slice(-CHARS_DE_CONTEXTO);
    }

    return trechos;
  }

  /** Junta as fatias em blocos de pelo menos 20 min, roda o map e o reduce. */
  private async extrairBase(
    trechos: Array<{ texto: string; inicioSec: number; duracaoSec: number }>,
  ) {
    const blocos: Array<{ texto: string; inicioSec: number }> = [];
    let atual: { texto: string; inicioSec: number; duracaoSec: number } | null =
      null;

    for (const trecho of trechos) {
      if (!trecho.texto.trim()) continue;
      if (!atual) {
        atual = { ...trecho };
        continue;
      }
      /*
       * O bloco só fecha DEPOIS de passar do piso, e não antes de estourá-lo:
       * a versão anterior perguntava se a soma ainda caberia em 20 min e, com
       * fatias de 15, a resposta era sempre não — nenhuma junção acontecia e o
       * agrupamento inteiro era código morto.
       */
      if (
        atual.duracaoSec >= SEGUNDOS_POR_BLOCO ||
        atual.texto.length >= MAX_CHARS_POR_BLOCO
      ) {
        blocos.push({ texto: atual.texto, inicioSec: atual.inicioSec });
        atual = { ...trecho };
      } else {
        atual.texto = `${atual.texto}\n\n${trecho.texto}`;
        atual.duracaoSec += trecho.duracaoSec;
      }
    }
    if (atual) blocos.push({ texto: atual.texto, inicioSec: atual.inicioSec });

    const candidatos: ProdutoExtraido[] = [];
    for (const bloco of blocos) {
      candidatos.push(...(await this.ai.extrairConhecimentoDaLive(bloco)));
    }

    return this.ai.consolidarConhecimento(candidatos);
  }

  /**
   * Substitui o que a IA tinha escrito antes, preservando o que foi digitado.
   *
   * Reprocessar a mesma live não pode apagar as correções do vendedor: só as
   * linhas de origem `ia` saem. As manuais e as importadas do catálogo ficam,
   * porque não foi a extração que as colocou ali.
   */
  private async gravarBase(
    userId: string,
    sessionId: string,
    produtos: Awaited<ReturnType<AiService['consolidarConhecimento']>>['produtos'],
    faq: Awaited<ReturnType<AiService['consolidarConhecimento']>>['faq'],
  ): Promise<void> {
    await this.faq.delete({ userId, liveSessionId: sessionId, origin: 'ia' });
    await this.produtos.delete({
      userId,
      liveSessionId: sessionId,
      origin: 'ia',
    });

    await this.produtos.save(
      produtos.map((p) =>
        this.produtos.create({
          userId,
          liveSessionId: sessionId,
          name: p.nome,
          priceBrl: p.precoBrl === null ? null : p.precoBrl.toFixed(2),
          variants: p.variantes ?? [],
          shippingInfo: p.frete,
          promo: p.promo,
          aliases: p.aliases ?? [],
          confidence: p.confianca.toFixed(2),
          origin: 'ia',
          sourceStartSec: p.inicioSec,
          active: true,
        }),
      ),
    );

    /*
     * O FAQ entra sem produto, e é o correto no que o reduce devolve: ele
     * responde com pergunta, resposta e tipo, sem citar a qual item a resposta
     * pertence — não teria como, os ids só passaram a existir na linha acima.
     * Adivinhar o vínculo por semelhança de texto erraria calado e prenderia a
     * política de troca da loja a um produto qualquer; sem vínculo a resposta
     * vale para a live inteira, que é o comportamento seguro. O vendedor pode
     * amarrá-la a um produto na tela, e é para isso que o PATCH aceita o campo.
     */
    await this.faq.save(
      faq.map((f) =>
        this.faq.create({
          userId,
          liveSessionId: sessionId,
          liveProductId: null,
          question: f.pergunta,
          answer: f.resposta,
          kind: f.tipo,
          origin: 'ia',
          priority: 0,
        }),
      ),
    );
  }

  // --------------------------------------------------------------- produtos
  async criarProduto(userId: string, sessionId: string, dto: CriarProdutoDto) {
    await this.acharSessao(userId, sessionId);
    return this.produtos.save(
      this.produtos.create({
        userId,
        liveSessionId: sessionId,
        name: dto.name.trim(),
        priceBrl: dto.priceBrl === undefined ? null : dto.priceBrl.toFixed(2),
        variants: dto.variants ?? [],
        shippingInfo: dto.shippingInfo ?? null,
        promo: dto.promo ?? null,
        aliases: dto.aliases ?? [],
        confidence: null,
        // Digitado pelo vendedor: a origem é fato do cadastro, não escolha do
        // cliente — por isso é fixada aqui e não vem do DTO.
        origin: 'manual',
        active: dto.active ?? true,
      }),
    );
  }

  async atualizarProduto(userId: string, id: string, dto: AtualizarProdutoDto) {
    const produto = await this.produtos.findOneBy({ id, userId });
    if (!produto) throw new NotFoundException('Produto não encontrado.');

    /*
     * `origin` NÃO é tocado aqui, e isso é a regra, não um esquecimento: o
     * campo responde "quem escreveu isto originalmente", e o vendedor corrigir
     * um preço não muda o fato de que foi a extração que criou a linha. Virar
     * 'manual' na primeira edição apagaria justamente a informação que permite
     * medir a qualidade da extração e saber o que ainda não passou por revisão.
     */
    if (dto.name !== undefined) produto.name = dto.name.trim();
    if (dto.priceBrl !== undefined) produto.priceBrl = dto.priceBrl.toFixed(2);
    if (dto.variants !== undefined) produto.variants = dto.variants;
    if (dto.shippingInfo !== undefined) produto.shippingInfo = dto.shippingInfo;
    if (dto.promo !== undefined) produto.promo = dto.promo;
    if (dto.aliases !== undefined) produto.aliases = dto.aliases;
    if (dto.active !== undefined) produto.active = dto.active;

    return this.produtos.save(produto);
  }

  async apagarProduto(userId: string, id: string) {
    const produto = await this.produtos.findOneBy({ id, userId });
    if (!produto) throw new NotFoundException('Produto não encontrado.');
    await this.produtos.remove(produto);
  }

  // -------------------------------------------------------------------- FAQ
  async criarFaq(userId: string, sessionId: string, dto: CriarFaqDto) {
    await this.acharSessao(userId, sessionId);
    return this.faq.save(
      this.faq.create({
        userId,
        liveSessionId: sessionId,
        liveProductId: await this.produtoDoUsuario(userId, dto.liveProductId),
        question: dto.question.trim(),
        answer: dto.answer.trim(),
        kind: dto.kind ?? 'faq',
        origin: 'manual',
        priority: dto.priority ?? 0,
      }),
    );
  }

  async atualizarFaq(userId: string, id: string, dto: AtualizarFaqDto) {
    const item = await this.faq.findOneBy({ id, userId });
    if (!item) throw new NotFoundException('Resposta não encontrada.');

    // Mesma regra do produto: a origem conta a procedência e não se reescreve.
    if (dto.question !== undefined) item.question = dto.question.trim();
    if (dto.answer !== undefined) item.answer = dto.answer.trim();
    if (dto.kind !== undefined) item.kind = dto.kind;
    if (dto.priority !== undefined) item.priority = dto.priority;
    if (dto.liveProductId !== undefined) {
      item.liveProductId = await this.produtoDoUsuario(userId, dto.liveProductId);
    }

    return this.faq.save(item);
  }

  async apagarFaq(userId: string, id: string) {
    const item = await this.faq.findOneBy({ id, userId });
    if (!item) throw new NotFoundException('Resposta não encontrada.');
    await this.faq.remove(item);
  }

  // ------------------------------------------------------------------- cron
  /**
   * Reabre as sessões que ficaram penduradas.
   *
   * O processamento roda em memória, no próprio processo da API — sem Redis não
   * há BullMQ, e o repo já resolve o assíncrono assim em outros pontos (ver
   * `prompt-refresh.service.ts`). O custo dessa escolha é exatamente este: um
   * deploy, um OOM ou um restart no meio de uma live de 4h mata o pipeline sem
   * ninguém para reagendá-lo, e a sessão fica em `transcrevendo` para sempre —
   * com a tela em polling eterno e o vendedor achando que ainda está rodando.
   *
   * O cron é o varredor que fecha esse buraco. Ele não retoma o trabalho (não
   * há de onde: o upload foi apagado junto com o processo que o segurava), mas
   * faz as duas coisas que ainda são possíveis — devolver os créditos que foram
   * debitados sem entrega e contar a verdade ao usuário para que ele reenvie.
   *
   * "Travada" aqui significa SEM BATIMENTO, não "demorada": o pipeline vivo
   * reescreve `processingStartedAt` a cada minuto (ver `INTERVALO_DE_BATIMENTO_MS`).
   * Antes disso o carimbo era só a hora do upload, e qualquer transcrição que
   * passasse de quinze minutos — ou seja, toda live de verdade — era declarada
   * morta enquanto ainda rodava. O conjunto `emAndamento` é a segunda barreira,
   * para o caso de o batimento em si estar falhando ao gravar.
   */
  @Cron('*/2 * * * *')
  async reabrirSessoesTravadas(): Promise<number> {
    const limite = new Date(
      Date.now() - MINUTOS_ATE_CONSIDERAR_TRAVADA * 60_000,
    );
    const candidatas = await this.sessoes.find({
      where: {
        status: In(['transcrevendo', 'extraindo']),
        processingStartedAt: LessThan(limite),
      },
    });
    const travadas = candidatas.filter((s) => !this.emAndamento.has(s.id));
    if (!travadas.length) return 0;

    for (const sessao of travadas) {
      // Estorna antes de mexer no status: é aqui que o crédito perdido num
      // restart volta, e ele só existe enquanto os marcadores estão de pé.
      await this.estornarPendentes(
        sessao.id,
        'Live: processamento interrompido no servidor',
      );
      sessao.status = 'erro';
      sessao.processingStartedAt = null;
      sessao.pendingTranscribeBlocks = 0;
      sessao.pendingExtractCharge = false;
      sessao.errorMessage =
        'O processamento foi interrompido antes de terminar (provavelmente uma reinicialização do servidor). Os créditos foram devolvidos; envie a gravação novamente.';
    }
    await this.sessoes.save(travadas);
    this.logger.warn(`${travadas.length} sessão(ões) de live reaberta(s) por travamento.`);
    return travadas.length;
  }

  // ------------------------------------------------------------------ apoio
  private async acharSessao(userId: string, id: string): Promise<LiveSession> {
    const sessao = await this.sessoes.findOneBy({ id, userId });
    if (!sessao) throw new NotFoundException('Live não encontrada.');
    return sessao;
  }

  /**
   * Um id de produto vindo da request só vale se for do próprio usuário —
   * sem esta checagem, dava para pendurar uma resposta na live de outra pessoa.
   */
  private async produtoDoUsuario(
    userId: string,
    id: string | null | undefined,
  ): Promise<string | null> {
    if (!id) return null;
    const produto = await this.produtos.findOneBy({ id, userId });
    if (!produto) throw new NotFoundException('Produto não encontrado.');
    return produto.id;
  }
}
