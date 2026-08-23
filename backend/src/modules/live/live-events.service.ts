import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Os eventos que o painel entende. São poucos de propósito: o desktop não
 * renderiza o que não conhece, e cada tipo novo é um contrato a mais para
 * manter entre duas aplicações que versionam separado.
 *
 *  - `reply`: resposta pronta, com confiança e decisão — o corpo do painel;
 *  - `escalation`: a pergunta subiu para o humano (o modelo não sustentou a
 *    resposta, ou o chat inteiro repetiu a mesma dúvida em trinta segundos);
 *  - `stats`: os contadores da run, para o rodapé;
 *  - `credits_exhausted`: acabaram os minutos e a transmissão parou por saldo;
 *  - `duration_limit_reached`: a run bateu o teto de duração do plano e foi
 *    encerrada — fim normal, não erro; o painel mostra o CTA de upgrade;
 *  - `mode`: a transmissão trocou entre painel e envio automático. Painel e app
 *    desktop são clientes diferentes da MESMA run, e sem este aviso um dos dois
 *    seguiria mostrando um modo que já não é o que está acontecendo no chat —
 *    o pior lugar do produto para haver dúvida sobre quem está postando;
 *  - `delivery`: o desfecho do envio de uma resposta no modo automático;
 *  - `ended`: a run terminou, por qualquer motivo. É o último evento do fluxo.
 */
export type LiveEventType =
  | 'reply'
  | 'escalation'
  | 'stats'
  | 'credits_exhausted'
  | 'duration_limit_reached'
  | 'mode'
  | 'delivery'
  | 'ended';

@Injectable()
export class LiveEventsService {
  private readonly logger = new Logger(LiveEventsService.name);

  /**
   * Um Subject por run aberta NESTE processo.
   *
   * Só existe enquanto a run corre; `encerrar` completa e remove. Ver a nota de
   * escopo no topo do `LiveRunController` — em várias instâncias, o Subject só
   * alcança quem estiver ligado na mesma instância que recebeu o POST.
   */
  private readonly canais = new Map<string, Subject<MessageEvent>>();

  /**
   * O fluxo de uma run. Criar o canal na assinatura (e não só na primeira
   * publicação) é o que permite o desktop abrir o SSE antes do primeiro lote de
   * chat — que é a ordem natural: conecta o painel, depois começa a live.
   */
  stream(runId: string): Observable<MessageEvent> {
    return this.canalDe(runId).asObservable();
  }

  publicar(runId: string, type: LiveEventType, data: unknown): void {
    const canal = this.canais.get(runId);
    // Sem ninguém ligado não há canal, e não há o que fazer com o evento: o
    // painel é tempo real, não caixa de entrada. O estado que importa está no
    // banco e o desktop o relê ao reconectar.
    if (!canal) return;
    canal.next({ type, data: data as MessageEvent['data'] });
  }

  /**
   * Fecha o canal da run.
   *
   * Sem isto o Map cresce um Subject por live para sempre — e cada Subject
   * segura os observers do SSE, que por sua vez seguram a resposta HTTP. É
   * vazamento de memória e de socket na mesma linha. `complete()` também é o
   * sinal que faz o Nest fechar a conexão SSE do lado do cliente em vez de
   * deixá-la pendurada até o timeout do proxy.
   */
  encerrar(runId: string): void {
    const canal = this.canais.get(runId);
    if (!canal) return;
    this.canais.delete(runId);
    canal.complete();
    this.logger.debug(`Canal SSE da run ${runId} encerrado.`);
  }

  private canalDe(runId: string): Subject<MessageEvent> {
    const existente = this.canais.get(runId);
    if (existente) return existente;
    const novo = new Subject<MessageEvent>();
    this.canais.set(runId, novo);
    return novo;
  }
}
