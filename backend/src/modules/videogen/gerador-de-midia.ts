/** Um job de geração aceito pela fornecedora, ainda sem resultado. */
export interface SubmitResult {
  requestId: string;
  status: string;
}

/** O estado de um job, na única forma que o `videogen` sabe ler. */
export interface StatusResult {
  status: string;
  imageUrl?: string;
  videoUrl?: string;
  error?: string;
}

/**
 * O contrato que o `videogen` conhece — e o único.
 *
 * Existe porque a mesma Higgsfield cobra de DUAS carteiras que não se falam: a
 * API de `platform.higgsfield.ai`, com chave de servidor, e o plano, que só a
 * CLI e o MCP alcançam. Qual delas tem saldo é uma circunstância comercial que
 * muda sem aviso, e amarrar o produto a uma delas foi o que deixou a geração de
 * mídia parada quando a carteira de API zerou.
 *
 * Com o contrato no meio, trocar de carteira é trocar o provider no módulo. O
 * `videogen.service` continua cobrando, estornando e fazendo o polling sem
 * saber por onde a imagem chegou — que é como deve ser: a regra de cobrança é
 * nossa, o transporte é detalhe da fornecedora.
 */
export interface GeradorDeMidia {
  /** false quando falta credencial: a rota inteira se desliga em vez de errar. */
  readonly isConfigured: boolean;

  /**
   * Texto → imagem. É o frame base de tudo, inclusive dos vídeos.
   *
   * `referencias` são imagens REAIS que o modelo deve reproduzir na
   * composição (retrato da persona, foto do produto). É o que permite a
   * apresentadora segurar o produto EXATO do vendedor em vez de um objeto
   * inventado parecido.
   */
  submitImage(
    prompt: string,
    aspectRatio: string,
    referencias?: Buffer[],
  ): Promise<SubmitResult>;

  /**
   * Imagem → vídeo. Recebe o que `submitImage` produziu, já pronto.
   *
   * `imagem` é o frame base JÁ LIDO, para quando a URL não é alcançável de
   * fora (espelho servido em rota relativa `/api/v1/media/...`). Foi um bug
   * real: o retrato da persona era espelhado com caminho relativo, o
   * `fetch()` do driver estourava TypeError, e NENHUMA cena renderizava —
   * enquanto a persona (texto → imagem, sem fetch) funcionava, escondendo a
   * causa.
   */
  submitVideo(imageUrl: string, prompt: string, imagem?: Buffer): Promise<SubmitResult>;

  /** Consulta um job submetido. O polling é de quem chama. */
  getStatus(requestId: string): Promise<StatusResult>;
}

/**
 * Token de injeção.
 *
 * Uma interface some na compilação e não serve para o Nest resolver a
 * dependência — daí o símbolo. É ele que o `videogen.service` pede e que o
 * módulo resolve para a implementação da carteira que estiver valendo.
 */
export const GERADOR_DE_MIDIA = Symbol('GERADOR_DE_MIDIA');

/**
 * Trecho que abre a ordem de fala no prompt de vídeo (ver `montarPromptDeCena`
 * em campaigns). O driver o usa para saber se a cena tem alguém FALANDO em
 * quadro — e escolher um modelo que fale português: o Kling 3.0 gera áudio
 * nativo só em inglês, chinês, japonês, coreano e espanhol, e uma fala em
 * pt-BR saía em INGLÊS (aconteceu em produção). Marcador no prompt, e não um
 * campo novo, porque a fase 2 da composição reanima a partir do prompt gravado.
 */
export const MARCADOR_DE_FALA = 'Dialogue — say VERBATIM';

export function promptTemFala(prompt: string): boolean {
  return prompt.includes(MARCADOR_DE_FALA);
}
