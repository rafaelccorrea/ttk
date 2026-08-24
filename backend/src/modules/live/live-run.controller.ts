import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import {
  AbrirLiveRunDto,
  ConfirmarEntregaDto,
  EncerrarLiveRunDto,
  LoteDeChatDto,
  RegistrarEventoDaRunDto,
  LoteDeMetricasDto,
  SalvarNaBaseDto,
  TrocarModoDaRunDto,
} from './dto/live.dto';
import { LiveRun } from './entities/live-run.entity';
import { LiveEventsService } from './live-events.service';
import { LiveReplyService } from './live-reply.service';

/**
 * A transmissão ao vivo.
 *
 * O app desktop lê o chat, manda em lotes de ~800ms, e as respostas voltam por
 * SSE para a tela do vendedor. Em modo `painel` a história acaba aí: quem
 * decide o que vai para o chat é o humano, copiando ou falando em voz alta.
 *
 * Em modo `auto` o app também POSTA a resposta no chat da live — e isso
 * contraria os Termos do TikTok, com risco real para a conta do vendedor. Todo
 * o desenho deste arquivo existe para manter essa superfície mínima: o modo é
 * por transmissão e não por conta, exige aceite de termo com versão, só a
 * decisão `enviar` entra na fila, a fila é pequena e puxada pelo app no ritmo
 * dele, e o que envelhece nela é descartado em vez de postado atrasado. O modo
 * `painel` continua sendo o estado de repouso: qualquer degradação volta para
 * lá, porque é o modo que não pode dar errado.
 *
 * ESCOPO DO SSE — LIMITAÇÃO CONHECIDA
 * -----------------------------------
 * O fluxo de eventos vive num Subject em MEMÓRIA DO PROCESSO, um por runId (ver
 * `LiveEventsService`). Com uma instância só, que é o cenário de hoje, isso é
 * exatamente o que se quer: sem broker, sem Redis, sem uma peça a mais para
 * cair no meio de uma live. Com mais de uma instância atrás de um load
 * balancer, porém, o `GET /stream` pode aterrissar numa instância e o
 * `POST /messages` da mesma run em outra — e o painel fica mudo enquanto o
 * backend responde tudo certo, que é o pior formato de bug possível: silencioso
 * e do lado do cliente.
 *
 * A mitigação é STICKY SESSION POR runId no balanceador (hash do path ou
 * cookie), não código aqui dentro. Se um dia for preciso escalar de verdade, o
 * caminho é trocar o Subject por um pub/sub (Redis) mantendo esta interface. É
 * a mesma limitação, e a mesma escolha, já documentada em
 * `common/interceptors/single-flight.interceptor.ts:24`.
 *
 * AUTENTICAÇÃO DO SSE
 * -------------------
 * O `EventSource` do navegador não manda header `Authorization`, então o painel
 * consome esta rota com um cliente que manda (fetch com ReadableStream, ou o
 * próprio app desktop). O guard continua valendo — a rota é do plano Business e
 * do dono da run, como todas as outras aqui.
 */
@ApiTags('live')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
@RequiresPlanFeature('live_copilot')
@Controller('live')
export class LiveRunController {
  private readonly logger = new Logger(LiveRunController.name);

  constructor(
    private readonly replies: LiveReplyService,
    private readonly eventos: LiveEventsService,
  ) {}

  // ------------------------------------------------------------------- runs
  @Post('runs')
  @ApiOperation({
    summary: 'Abre a transmissão sobre uma base de conhecimento pronta',
  })
  async abrir(@CurrentUser() user: AuthUser, @Body() dto: AbrirLiveRunDto) {
    // A cortesia, a conferência do dono da base e o status 'pronta' são do
    // serviço — aqui só entra o userId do token, nunca um do corpo.
    return this.replies.abrirRun(user.id, {
      knowledgeSessionId: dto.knowledgeSessionId,
      tiktokUsername: dto.tiktokUsername ?? null,
      tiktokRoomId: dto.tiktokRoomId ?? null,
    });
  }

  /**
   * O lote do chat.
   *
   * Responde ANTES de processar, e isso é o desenho, não uma otimização: o
   * desktop manda um lote a cada ~800ms e não pode ficar preso esperando a
   * chamada ao modelo — se ficasse, os lotes se enfileirariam no cliente e o
   * atraso cresceria durante a live inteira. O que a request devolve é só o
   * aceite; as respostas chegam pelo SSE, que é onde o painel já está olhando.
   *
   * A conferência do dono acontece na hora (é o `obterRun` abaixo), para que um
   * runId de outro vendedor receba 404 na cara em vez de sumir num background
   * que ninguém observa.
   */
  @Post('runs/:id/messages')
  @HttpCode(202)
  @ApiOperation({ summary: 'Recebe um lote do chat; as respostas saem pelo SSE' })
  async receberLote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoteDeChatDto,
  ) {
    await this.replies.obterRun(user.id, id);

    const lote = dto.messages.map((m) => ({
      externalMessageId: m.externalMessageId,
      authorHash: m.authorHash,
      text: m.text,
      receivedAt: m.receivedAt ? new Date(m.receivedAt) : new Date(),
      isQuestion: m.isQuestion === true,
    }));

    void this.processarEmitindo(user.id, id, lote);
    return { aceitas: lote.length };
  }

  @Sse('runs/:id/stream')
  @ApiOperation({
    summary:
      'Fluxo do painel: reply, escalation, stats, credits_exhausted e ended',
  })
  async stream(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Observable<MessageEvent>> {
    // Nenhum fluxo é aberto sem provar o dono: um SSE é uma janela contínua
    // para o chat de uma live e para o que o copiloto respondeu nela.
    await this.replies.obterRun(user.id, id);
    return this.eventos.stream(id);
  }

  /**
   * O batimento do desktop, a cada minuto — e o único lugar que cobra minuto.
   *
   * A cobrança está amarrada ao batimento, e não a um timer do servidor, porque
   * é o desktop quem sabe se a live ainda está no ar. Se ele fechar, travar,
   * perder a internet ou o notebook dormir, o batimento simplesmente para e a
   * cobrança para junto, sozinha, sem nenhum código de limpeza envolvido. O
   * pior caso é o vendedor pagar o minuto que estava correndo quando caiu. O
   * arranjo oposto — servidor cobrando por relógio até alguém avisar que
   * acabou — transforma um crash de cliente em cobrança indefinida, que é o
   * tipo de erro que se descobre pela fatura.
   */
  @Post('runs/:id/heartbeat')
  @ApiOperation({ summary: 'Batimento do desktop: debita um minuto de live' })
  async heartbeat(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.replies.obterRun(user.id, id);
    const run = await this.replies.cobrarMinuto(id);

    if (run.status === 'erro' || run.status === 'encerrada') {
      if (run.endReason === 'limite_duracao') {
        // Fim normal, não falta de saldo: o painel mostra o teto do plano (e o
        // CTA de upgrade), não o CTA de comprar horas.
        this.eventos.publicar(id, 'duration_limit_reached', {
          runId: id,
          minutos: run.minutesCharged,
        });
        this.finalizar(
          run,
          'A transmissão atingiu o limite de duração do plano.',
        );
        return run;
      }
      // Saldo acabou (ou a run já tinha morrido): o painel precisa saber disso
      // pelo fluxo, não pela ausência de respostas.
      this.eventos.publicar(id, 'credits_exhausted', {
        runId: id,
        motivo: run.errorMessage,
      });
      this.finalizar(run, run.errorMessage ?? 'Transmissão encerrada.');
      return run;
    }

    this.eventos.publicar(id, 'stats', this.stats(run));
    return run;
  }

  @Post('runs/:id/end')
  @ApiOperation({ summary: 'Encerra a transmissão' })
  async encerrar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EncerrarLiveRunDto,
  ) {
    const run = await this.replies.encerrarRun(
      user.id,
      id,
      dto.motivo,
      dto.endReason,
    );
    this.finalizar(run, dto.motivo ?? 'Transmissão encerrada pelo vendedor.');
    return run;
  }

  /**
   * Trilha de auditoria: o app viu um aviso do TikTok (e o que fez a
   * respeito), ou tentou fixar um produto. 202 porque o registro não pode
   * atrasar a reação do app — o que importa é gravar, não confirmar.
   */
  @Post('runs/:id/events')
  @HttpCode(202)
  @ApiOperation({ summary: 'Registra um evento de auditoria da transmissão' })
  async registrarEvento(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarEventoDaRunDto,
  ) {
    await this.replies.registrarEvento(user.id, id, dto);
    return { ok: true };
  }

  // --------------------------------------------------------------- respostas
  /**
   * O vendedor copiou a resposta do painel.
   *
   * É a métrica da fase inteira, não telemetria de enfeite: sem envio
   * automático, a ÚNICA evidência de que o copiloto acertou é o humano ter
   * escolhido usar o que ele escreveu. É esse carimbo que diz, depois de
   * algumas dezenas de lives, se o corte de confiança está no lugar certo e se
   * pagar o modelo caro nas perguntas de dinheiro está se justificando.
   */
  @Post('replies/:id/copied')
  @ApiOperation({ summary: 'Marca que o vendedor copiou a resposta do painel' })
  copiada(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.replies.marcarCopiada(user.id, id);
  }

  /**
   * Guarda a resposta na base de conhecimento, com ou sem correção.
   *
   * Cada pergunta escalada é uma lacuna da base, e esta é a rota que fecha a
   * lacuna com a resposta de quem sabe. Vai para a sessão de conhecimento — que
   * sobrevive à transmissão — e não para a run, senão o aprendizado morreria
   * junto com a live em que aconteceu.
   */
  @Post('replies/:id/save-to-base')
  @ApiOperation({
    summary: 'Salva a resposta (editada ou não) na base de conhecimento',
  })
  salvarNaBase(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SalvarNaBaseDto,
  ) {
    return this.replies.promoverParaBase(user.id, id, dto.text);
  }

  // ----------------------------------------------------- modo automático
  /**
   * Liga ou desliga o envio automático desta transmissão.
   *
   * O aceite do termo NÃO é feito aqui: ele vive em `LiveConfigController`,
   * junto do texto que o vendedor precisa ler. Aceitar é uma decisão sobre a
   * conta, tomada com calma e fora do ar; ligar o automático é uma operação no
   * meio de uma live. Se o aceite viesse no corpo desta rota, o vendedor estaria
   * "aceitando" um termo que nunca viu, num clique dado às pressas com o chat
   * rolando.
   *
   * A recusa por falta de aceite volta como 412 com texto legível: quem lê é o
   * app desktop, que mostra a mensagem tal e qual e leva o vendedor ao termo.
   */
  @Post('runs/:id/mode')
  @ApiOperation({ summary: 'Troca o modo da transmissão entre painel e auto' })
  async trocarModo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TrocarModoDaRunDto,
  ) {
    const run = await this.replies.trocarModo(user.id, id, dto.mode);
    // O painel do vendedor e o app são clientes diferentes da mesma run: sem o
    // evento, uma janela seguiria mostrando "painel" enquanto a outra já está
    // postando no chat — e o vendedor não saberia qual das duas acreditar.
    this.eventos.publicar(id, 'mode', { runId: id, mode: run.mode });
    return run;
  }

  /**
   * A fila do app: o que já foi aprovado e ainda não foi postado.
   *
   * É POLL, e não um evento do SSE, porque a fila é uma unidade de TRABALHO e
   * não um aviso. O app pede o próximo bloco quando terminou de digitar o
   * anterior; empurrar por evento entregaria respostas mais rápido do que ele
   * consegue postá-las e a fila acabaria envelhecendo dentro do cliente, onde o
   * descarte por idade não alcança.
   */
  /**
   * O histórico das transmissões, com o desempenho de cada uma.
   *
   * Vem antes de `runs/:id/queue` na classe por convenção de leitura, não por
   * exigência do roteador — `runs` e `runs/:id/queue` não colidem.
   */
  @Get('runs')
  @ApiOperation({
    summary: 'Histórico de transmissões com aproveitamento e latência',
  })
  listarRuns(@CurrentUser() user: AuthUser) {
    return this.replies.listarRuns(user.id);
  }

  /**
   * A live inteira, para a página do copiloto na web: resumo, série de
   * audiência e as perguntas com as respostas que o copiloto deu.
   */
  @Get('runs/:id')
  @ApiOperation({
    summary: 'Detalhe de uma transmissão: métricas, perguntas e respostas',
  })
  detalhe(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.replies.detalharRun(user.id, id);
  }

  /**
   * O lote de instantâneos de audiência do desktop (viewers, curtidas,
   * presentes). Deltas por janela de ~30s — ver `LiveRunMetric` para o porquê.
   */
  @Post('runs/:id/metrics')
  @ApiOperation({ summary: 'Recebe instantâneos de audiência da transmissão' })
  async receberMetricas(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoteDeMetricasDto,
  ) {
    return this.replies.registrarMetricas(
      user.id,
      id,
      dto.metrics.map((m) => ({ ...m, capturedAt: new Date(m.capturedAt) })),
    );
  }

  @Get('runs/:id/queue')
  @ApiOperation({ summary: 'Fila de respostas aprovadas esperando envio' })
  async fila(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const fila = await this.replies.filaDeEnvio(user.id, id);
    return fila.map((resposta) => ({
      id: resposta.id,
      chatMessageId: resposta.chatMessageId,
      // O hash do autor, nunca o @: é o que o app usa para não responder duas
      // vezes à mesma pessoa em rajada (ver `INTERVALO_MESMO_AUTOR_MS`).
      authorHash: resposta.chatMessage?.authorHash ?? '',
      text: resposta.text,
      createdAt: resposta.createdAt,
    }));
  }

  /**
   * O app relata o que aconteceu com uma resposta da fila.
   *
   * Idempotente no serviço: a repetição de uma confirmação (rede caiu antes do
   * ACK) não conta uma segunda entrega. Por isso responde 200 com o estado
   * atual em vez de um erro — o cliente se reconcilia lendo o que voltou.
   */
  @Post('replies/:id/delivery')
  @ApiOperation({ summary: 'Confirma o resultado do envio de uma resposta' })
  async confirmarEntrega(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmarEntregaDto,
  ) {
    const resposta = await this.replies.confirmarEntrega(
      user.id,
      id,
      dto.status,
      dto.failureReason ?? null,
    );
    this.eventos.publicar(resposta.liveRunId, 'delivery', {
      replyId: resposta.id,
      deliveryStatus: resposta.deliveryStatus,
      sentAt: resposta.sentAt,
      failureReason: resposta.failureReason,
    });
    return {
      id: resposta.id,
      deliveryStatus: resposta.deliveryStatus,
      sentAt: resposta.sentAt,
      deliveryAttempts: resposta.deliveryAttempts,
    };
  }

  // ------------------------------------------------------------------ apoio
  /**
   * Processa o lote fora da request e emite o resultado no fluxo da run.
   *
   * Como ninguém está esperando esta promessa, TODO erro tem que morrer aqui:
   * uma rejeição solta neste ponto é `unhandledRejection` no processo da API,
   * derrubando também as outras lives que rodam nele.
   */
  private async processarEmitindo(
    userId: string,
    runId: string,
    lote: {
      externalMessageId: string;
      authorHash: string;
      text: string;
      receivedAt: Date;
      isQuestion?: boolean;
    }[],
  ): Promise<void> {
    try {
      const { respostas, escaladas } = await this.replies.processarLote(
        runId,
        userId,
        lote,
      );

      for (const resposta of respostas) {
        // `silenciar` não vai ao painel por definição: a resposta fica gravada
        // para calibração, mas poluir a tela com o que o próprio copiloto
        // considerou fraco é o jeito mais rápido de o vendedor parar de olhar.
        if (resposta.decision === 'silenciar') continue;
        this.eventos.publicar(runId, 'reply', {
          id: resposta.id,
          chatMessageId: resposta.chatMessageId,
          // O hash do autor, nunca o @ (o backend nem o conhece): é o que o
          // app usa para o "bloquear autor" do card — só o processo principal
          // do desktop sabe traduzir o hash de volta. `processarLote` pendura
          // a mensagem na resposta em memória; sem ela, o campo vai vazio.
          authorHash: resposta.chatMessage?.authorHash ?? '',
          text: resposta.text,
          confidence: Number(resposta.confidence),
          decision: resposta.decision,
          model: resposta.model,
          sourceProductIds: resposta.sourceProductIds,
          latencyMs: resposta.latencyMs,
        });
      }

      for (const mensagem of escaladas) {
        this.eventos.publicar(runId, 'escalation', {
          chatMessageId: mensagem.id,
          // Mesmo motivo do `reply`: hash, para o app poder bloquear o autor.
          authorHash: mensagem.authorHash,
          text: mensagem.text,
          repeatCount: mensagem.repeatCount,
          receivedAt: mensagem.receivedAt,
        });
      }

      const run = await this.replies.obterRun(userId, runId);
      this.eventos.publicar(runId, 'stats', this.stats(run));
    } catch (error) {
      this.logger.error(
        `Run ${runId}: falha ao processar o lote — ${(error as Error)?.message}`,
      );
    }
  }

  private stats(run: LiveRun) {
    return {
      runId: run.id,
      status: run.status,
      messagesSeen: run.messagesSeen,
      repliesGenerated: run.repliesGenerated,
      escalations: run.escalations,
      minutesCharged: run.minutesCharged,
      mode: run.mode,
      repliesSent: run.repliesSent,
      deliveryFailures: run.deliveryFailures,
      endReason: run.endReason,
    };
  }

  /**
   * Último evento da run e fim do canal. O `ended` vai ANTES do `encerrar`
   * porque completar o Subject fecha as conexões — publicar depois seria
   * publicar no vazio, e o painel ficaria sem saber por que o fluxo caiu.
   */
  private finalizar(run: LiveRun, motivo: string): void {
    this.eventos.publicar(run.id, 'ended', {
      ...this.stats(run),
      motivo,
      endedAt: run.endedAt,
    });
    this.eventos.encerrar(run.id);
  }
}
