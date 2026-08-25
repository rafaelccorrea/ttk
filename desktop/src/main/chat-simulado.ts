import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AudienceEvent, ChatSource, RawChatMessage } from './tiktok-chat';

/**
 * Uma live de vendas de mentira, para exercitar o copiloto de verdade —
 * ligada por `PIKPOK_SIMULAR_LIVE=1` (`npm run dev:sim`).
 *
 * O que ela substitui é UMA peça só: o WebSocket do webcast. Todo o resto do
 * caminho é o real — anonimização, lote, POST no backend, modelo respondendo,
 * SSE, painel, cobrança de minuto. É o que permite demonstrar e depurar o
 * produto inteiro sem depender de estar transmitindo no TikTok (que exige mil
 * seguidores, câmera ligada e uma audiência de verdade fazendo pergunta).
 *
 * O roteiro é o de uma live de loja: pergunta de preço, frete, tamanho, troca,
 * objeção, pressa — misturadas com o ruído real de chat ("kkkk", emoji,
 * elogio), porque um simulador só de perguntas boas esconderia exatamente o
 * trabalho dos limiares de descarte. A audiência (viewers, curtida, presente)
 * também é emitida, para o agregador de métricas ter o que somar.
 *
 * Os textos NÃO citam produto específico de propósito: a base conectada é a
 * do vendedor, e perguntas genéricas ("quanto tá?", "tem no tamanho maior?")
 * fazem o motor buscar na base dele — que é o comportamento que se quer ver.
 */

/**
 * A chave do modo, num lugar só. Vale para escolher a fonte de chat e para
 * afrouxar as travas que não fazem sentido sem TikTok de verdade (login,
 * "está ao vivo?"). É variável de ambiente, não configuração: modo de
 * desenvolvimento nunca deve estar a um clique de um vendedor.
 */
export const MODO_SIMULACAO = process.env['PIKPOK_SIMULAR_LIVE'] === '1';

function roteiroDoArquivo(): string[] | null {
  const caminho = process.env['PIKPOK_SIM_ROTEIRO'];
  if (!caminho) return null;
  try {
    const linhas = readFileSync(caminho, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    if (!linhas.length) return null;
    console.log(`[sim] roteiro de ${linhas.length} mensagens lido de ${caminho}`);
    return linhas;
  } catch (erro) {
    console.warn(`[sim] PIKPOK_SIM_ROTEIRO ilegível (${caminho}): ${String(erro)}`);
    return null;
  }
}

/**
 * As perguntas que a live faz sobre UM produto, pelo nome. É o que faz a demo
 * exercitar a base de verdade: pergunta com o nome do produto → o motor acha o
 * produto → o preço real da base sai no chat.
 */
const PERGUNTAS_DE_PRODUTO: readonly string[] = [
  'quanto tá o {p}?',
  'o {p} tem garantia?',
  'tem o {p} em outra cor?',
  'faz desconto no {p}?',
  'tem estoque do {p}? quero 2',
  'o {p} chega antes do fim de semana?',
  'qual a diferença do {p} pro outro que você mostrou?',
  'o {p} serve pra presente?',
  'vale a pena o {p}? alguém já comprou?',
];

const ROTEIRO: readonly string[] = [
  'quanto tá esse?',
  'tem frete grátis?',
  'kkkkkkkk',
  'chega em quantos dias?',
  'tem no tamanho maior?',
  'amei 😍😍',
  'aceita pix?',
  'e se não servir, troca?',
  'qual o desconto de hoje?',
  'boa noite gente',
  'tem na cor preta?',
  'vale a pena? alguém já comprou?',
  'como faço pra comprar?',
  'tá muito caro 😕',
  'mostra ele de novo por favor',
  'até que horas vai a promoção?',
  'primeira vez aqui, do que é a live?',
  '❤️❤️❤️',
  'faz um precinho melhor aí',
  'tem garantia?',
  'envia pro nordeste?',
  'qual a diferença pro outro que você mostrou?',
  'quero 2, tem estoque?',
  'oi de novo, caiu minha internet',
  'esse serve pra presente?',
];

const ESPECTADORES = [
  'ana.compras',
  'juh_oliveira',
  'marcos.sp',
  'carla_achadinhos',
  'renata.mmg',
  'thi_promo',
  'lu.dicas',
  'pedrinho021',
] as const;

/** Intervalo entre mensagens: 2,5s a 7s — ritmo de live morna, não de rajada. */
const PAUSA_MINIMA_MS = 2_500;
const PAUSA_MAXIMA_MS = 7_000;

/** De quanto em quanto tempo a "sala" reporta audiência. */
const INTERVALO_AUDIENCIA_MS = 10_000;

export class SimuladorChatSource implements ChatSource {
  private aoReceber: ((m: RawChatMessage) => void) | null = null;
  private aoMedir: ((a: AudienceEvent) => void) | null = null;

  private timerMensagem: NodeJS.Timeout | null = null;
  private timerAudiencia: NodeJS.Timeout | null = null;
  private indice = 0;
  private viewers = 18;
  private readonly roteiro: string[];

  /**
   * Com os produtos da base conectada, o roteiro pergunta por ELES; sem
   * (base vazia, detalhe falhou), cai no roteiro genérico. As perguntas de
   * produto são intercaladas com as genéricas e o ruído para a cadência
   * continuar parecendo um chat, não uma sabatina.
   */
  constructor(produtos: string[] = []) {
    /*
     * `PIKPOK_SIM_ROTEIRO=<arquivo.txt>`: uma pergunta por linha, no lugar do
     * roteiro de loja. Serve para ensaiar uma live específica — a de
     * apresentação do sistema pergunta por plano e copiloto, não por frete.
     */
    const doArquivo = roteiroDoArquivo();
    if (doArquivo) {
      this.roteiro = doArquivo;
      return;
    }
    if (produtos.length === 0) {
      this.roteiro = [...ROTEIRO];
      return;
    }
    const deProduto = produtos.flatMap((nome, i) =>
      // Três perguntas por produto, deslocadas pelo índice para os modelos de
      // frase não repetirem em sequência quando a base tem poucos itens.
      [0, 1, 2].map((j) =>
        PERGUNTAS_DE_PRODUTO[(i * 3 + j) % PERGUNTAS_DE_PRODUTO.length]!.replace(
          '{p}',
          nome,
        ),
      ),
    );
    const misturado: string[] = [];
    const genericas = [...ROTEIRO];
    // Duas de produto para cada genérica, até uma das listas secar.
    while (deProduto.length || genericas.length) {
      misturado.push(...deProduto.splice(0, 2), ...genericas.splice(0, 1));
    }
    this.roteiro = misturado;
  }

  async connect(_roomIdOuUsername: string): Promise<void> {
    this.agendarProxima();
    this.timerAudiencia = setInterval(() => this.medir(), INTERVALO_AUDIENCIA_MS);
    this.timerAudiencia.unref?.();
  }

  on(evt: 'message', cb: (m: RawChatMessage) => void): void;
  on(evt: 'audience', cb: (a: AudienceEvent) => void): void;
  on(evt: 'disconnect' | 'error', cb: (e: Error) => void): void;
  on(
    evt: 'message' | 'audience' | 'disconnect' | 'error',
    cb:
      | ((m: RawChatMessage) => void)
      | ((a: AudienceEvent) => void)
      | ((e: Error) => void),
  ): void {
    if (evt === 'message') this.aoReceber = cb as (m: RawChatMessage) => void;
    if (evt === 'audience') this.aoMedir = cb as (a: AudienceEvent) => void;
    // 'disconnect' e 'error' nunca acontecem aqui: a simulação não tem rede.
  }

  disconnect(): void {
    if (this.timerMensagem) clearTimeout(this.timerMensagem);
    if (this.timerAudiencia) clearInterval(this.timerAudiencia);
    this.timerMensagem = null;
    this.timerAudiencia = null;
  }

  private agendarProxima(): void {
    const pausa =
      PAUSA_MINIMA_MS + Math.random() * (PAUSA_MAXIMA_MS - PAUSA_MINIMA_MS);
    this.timerMensagem = setTimeout(() => {
      this.emitir();
      this.agendarProxima();
    }, pausa);
    this.timerMensagem.unref?.();
  }

  private emitir(): void {
    const texto = this.roteiro[this.indice % this.roteiro.length]!;
    this.indice += 1;
    this.aoReceber?.({
      // UUID e não contador: reiniciar a simulação não pode repetir ids, senão
      // o dedup do backend engole a segunda rodada inteira e o painel "trava".
      msgId: `sim-${randomUUID()}`,
      username: ESPECTADORES[Math.floor(Math.random() * ESPECTADORES.length)]!,
      text: texto,
      receivedAt: new Date(),
    });
  }

  private medir(): void {
    // A sala respira: sobe e desce alguns viewers por janela, sem tendência.
    this.viewers = Math.max(
      5,
      this.viewers + Math.floor(Math.random() * 9) - 4,
    );
    this.aoMedir?.({ kind: 'viewers', value: this.viewers });
    if (Math.random() < 0.7) {
      this.aoMedir?.({ kind: 'likes', value: 1 + Math.floor(Math.random() * 12) });
    }
    if (Math.random() < 0.15) this.aoMedir?.({ kind: 'follow' });
  }
}
