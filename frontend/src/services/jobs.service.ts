import { api, CREDITS_CHANGED_EVENT } from './api';

export type AiJobStatus = 'na_fila' | 'rodando' | 'concluido' | 'falhou';
export type AiJobTipo =
  | 'transcribe'
  | 'analyze'
  | 'script'
  | 'campaign_script'
  | 'campaign_assemble';

/**
 * Um trabalho de IA rodando no servidor, independente desta aba. Toda geração
 * de IA que demora devolve um destes em vez do resultado: a tela acompanha
 * com `esperar` e a bandeja global (`JobsTray`) mostra o progresso em qualquer
 * página — inclusive depois de fechar e abrir o site de novo.
 */
export interface AiJob<T = unknown> {
  id: string;
  tipo: AiJobTipo;
  titulo: string;
  status: AiJobStatus;
  progresso: number;
  etapa: string | null;
  referenciaId: string | null;
  resultado: T | null;
  erro: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Disparado quando uma tela cria um job — a bandeja atualiza na hora. */
export const JOB_STARTED_EVENT = 'pikpok:job-started';

const POLL_MS = 2500;

/** Última chave de job por tipo, para a tela reconectar ao voltar. */
function chave(tipo: AiJobTipo) {
  return `pikpok.job.${tipo}`;
}

export const jobsService = {
  async ativos(): Promise<AiJob[]> {
    const { data } = await api.get<AiJob[]>('/jobs/ativos');
    return data;
  },

  async obter<T = unknown>(id: string): Promise<AiJob<T>> {
    const { data } = await api.get<AiJob<T>>(`/jobs/${id}`);
    return data;
  },

  async dispensar(id: string): Promise<void> {
    await api.post(`/jobs/${id}/dispensar`);
  },

  /**
   * Registra que a tela está de olho neste job. Ao montar de novo, a tela
   * chama `pendente(tipo)` e retoma de onde parou.
   */
  acompanhar(job: AiJob): void {
    try {
      localStorage.setItem(chave(job.tipo), job.id);
    } catch {
      /* storage indisponível: só perde a reconexão */
    }
    window.dispatchEvent(new Event(JOB_STARTED_EVENT));
  },

  /** Job deste tipo que a tela deixou rodando (ou terminou sem ser lido). */
  pendente(tipo: AiJobTipo): string | null {
    try {
      return localStorage.getItem(chave(tipo));
    } catch {
      return null;
    }
  },

  /** A tela já consumiu o resultado: não reabrir na próxima visita. */
  esquecer(tipo: AiJobTipo): void {
    try {
      localStorage.removeItem(chave(tipo));
    } catch {
      /* nada */
    }
  },

  /**
   * Espera o job terminar, devolvendo `resultado` ou lançando `erro`.
   * `onUpdate` recebe cada leitura (progresso/etapa) para a tela mostrar.
   */
  async esperar<T = unknown>(
    id: string,
    onUpdate?: (job: AiJob<T>) => void,
  ): Promise<T> {
    for (;;) {
      const job = await this.obter<T>(id);
      onUpdate?.(job);
      if (job.status === 'concluido') {
        // Job pago terminou: o saldo do header precisa acompanhar.
        window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
        return job.resultado as T;
      }
      if (job.status === 'falhou') {
        window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
        throw new Error(job.erro ?? 'O processamento falhou.');
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  },

  /**
   * Atalho das telas: cria o job com `disparar`, registra para reconexão e
   * espera o resultado.
   */
  async rodar<T = unknown>(
    disparar: () => Promise<AiJob>,
    onUpdate?: (job: AiJob<T>) => void,
  ): Promise<T> {
    const job = await disparar();
    this.acompanhar(job);
    try {
      return await this.esperar<T>(job.id, onUpdate);
    } finally {
      this.esquecer(job.tipo);
    }
  },
};

/** Para onde a bandeja leva quando o usuário clica no job. */
export function rotaDoJob(job: AiJob): string {
  switch (job.tipo) {
    case 'transcribe':
    case 'analyze':
      return '/analisar';
    case 'script':
      return '/estudio';
    case 'campaign_script':
    case 'campaign_assemble':
      return job.referenciaId ? `/campanhas/${job.referenciaId}` : '/campanhas';
    default:
      return '/';
  }
}
