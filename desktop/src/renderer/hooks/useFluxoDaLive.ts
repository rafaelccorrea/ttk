import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LiveEscalationEvent,
  LiveReplyEvent,
  LiveStatsEvent,
} from '@shared/live-events';
import { obterPonte } from '../ponte';

/**
 * O estado do cockpit montado a partir do fluxo de eventos.
 *
 * NÃO HÁ POLLING AQUI, e não é uma escolha de estilo: uma live de duas horas com
 * um GET por segundo são sete mil requisições autenticadas por vendedor, e
 * mesmo assim a resposta chegaria até um segundo depois de existir — tarde
 * demais para um chat que rola. O backend já publica tudo por SSE; o processo
 * principal segura essa conexão e repassa cada evento por IPC. Este hook só
 * acumula o que chega.
 */

/** Uma escalação com o que a tela precisa para ordenar e para agir. */
export interface Escalacao extends LiveEscalationEvent {
  /** Milissegundos desde `receivedAt`, recalculado a cada tique do relógio. */
  idadeMs: number;
}

export interface FluxoDaLive {
  /** Alta confiança, mais nova primeiro. */
  respostas: LiveReplyEvent[];
  /** O que o modelo não sustentou, ordenado por repetições × recência. */
  escalacoes: Escalacao[];
  stats: LiveStatsEvent | null;
  /** Preenchido quando chega `credits_exhausted`. */
  semSaldo: string | null;
  /** Preenchido quando chega `ended`. */
  encerrada: string | null;
  /** Respostas por minuto, calculado sobre a janela dos últimos 60s. */
  respostasPorMinuto: number;
  descartarEscalacao: (chatMessageId: string) => void;
}

/** Quantas respostas prontas ficam na tela. */
const TETO_RESPOSTAS = 30;
/** Quantas escalações ficam na tela. */
const TETO_ESCALACOES = 12;
/** Janela do contador de ritmo. */
const JANELA_RITMO_MS = 60_000;

export function useFluxoDaLive(): FluxoDaLive {
  const ponte = obterPonte();
  const [respostas, setRespostas] = useState<LiveReplyEvent[]>([]);
  const [escalacoes, setEscalacoes] = useState<LiveEscalationEvent[]>([]);
  const [stats, setStats] = useState<LiveStatsEvent | null>(null);
  const [semSaldo, setSemSaldo] = useState<string | null>(null);
  const [encerrada, setEncerrada] = useState<string | null>(null);
  /** Carimbos das respostas recentes, só para o "por minuto" do rodapé. */
  const carimbos = useRef<number[]>([]);
  /**
   * Um relógio próprio. A ordenação das escalações depende da RECÊNCIA, então
   * sem um tique periódico uma pergunta feita há dez minutos continuaria no
   * topo até chegar um evento novo — e num chat que esfriou é exatamente
   * quando nenhum evento chega.
   */
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!ponte) return undefined;
    return ponte.aoReceberEvento((evento) => {
      switch (evento.type) {
        case 'reply': {
          carimbos.current = [...carimbos.current, Date.now()].slice(-200);
          setRespostas((atual) => [evento.data, ...atual].slice(0, TETO_RESPOSTAS));
          break;
        }
        case 'escalation': {
          setEscalacoes((atual) => {
            // O backend reenvia a MESMA pergunta com `repeatCount` maior quando
            // o chat repete. Substituir em vez de empilhar é o que faz o card
            // dizer "7 pessoas perguntaram" em vez de virar sete cards iguais.
            const semDuplicata = atual.filter(
              (e) => e.chatMessageId !== evento.data.chatMessageId,
            );
            return [evento.data, ...semDuplicata].slice(0, TETO_ESCALACOES);
          });
          break;
        }
        case 'stats':
          setStats(evento.data);
          break;
        case 'credits_exhausted':
          setSemSaldo(evento.data.motivo ?? 'Seus minutos de live acabaram.');
          break;
        case 'ended':
          setStats(evento.data);
          setEncerrada(evento.data.motivo);
          break;
        default:
          break;
      }
    });
  }, [ponte]);

  const ordenadas = useMemo<Escalacao[]>(() => {
    return escalacoes
      .map((e) => ({ ...e, idadeMs: Math.max(0, agora - Date.parse(e.receivedAt)) }))
      .sort((a, b) => peso(b) - peso(a));
  }, [escalacoes, agora]);

  const respostasPorMinuto = useMemo(() => {
    const corte = agora - JANELA_RITMO_MS;
    return carimbos.current.filter((t) => t >= corte).length;
  }, [agora]);

  return {
    respostas,
    escalacoes: ordenadas,
    stats,
    semSaldo,
    encerrada,
    respostasPorMinuto,
    descartarEscalacao: (chatMessageId) =>
      setEscalacoes((atual) => atual.filter((e) => e.chatMessageId !== chatMessageId)),
  };
}

/**
 * Repetições × recência, com a recência caindo pela metade a cada dois minutos.
 *
 * A multiplicação é o ponto: uma pergunta que dez pessoas fizeram vale mais que
 * uma pergunta solitária, MAS uma pergunta de quinze minutos atrás já não
 * interessa nem se a live inteira a fez — o assunto passou, o produto que a
 * motivou saiu da tela, e responder agora confunde mais do que ajuda. A meia-vida
 * curta é o que mantém o topo do painel colado no que está acontecendo agora.
 */
const MEIA_VIDA_MS = 120_000;

function peso(e: Escalacao): number {
  const recencia = Math.pow(0.5, e.idadeMs / MEIA_VIDA_MS);
  return Math.max(1, e.repeatCount) * recencia;
}
