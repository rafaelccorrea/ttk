import {
  Body,
  Controller,
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
  EncerrarLiveRunDto,
  LoteDeChatDto,
} from './dto/live.dto';
import { LiveRun } from './entities/live-run.entity';
import { LiveEventsService } from './live-events.service';
import { LiveReplyService } from './live-reply.service';

/**
 * A transmissão ao vivo, em MODO SOMENTE-PAINEL.
 *
 * O app desktop lê o chat, manda em lotes de ~800ms, e as respostas voltam por
 * SSE para a tela do vendedor. NADA é postado no TikTok nesta fase: quem decide
 * o que vai para o chat é o humano, copiando do painel ou falando em voz alta.
 * O envio automático é a fase 2, e a separação é deliberada — dá para validar
 * chat, dedup, base, modelo, latência e confiança sem tocar no DOM do TikTok
 * nem assumir risco de ToS.
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
    const run = await this.replies.encerrarRun(user.id, id, dto.motivo);
    this.finalizar(run, dto.motivo ?? 'Transmissão encerrada pelo vendedor.');
    return run;
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
