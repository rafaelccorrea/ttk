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

  /** Texto → imagem. É o frame base de tudo, inclusive dos vídeos. */
  submitImage(prompt: string, aspectRatio: string): Promise<SubmitResult>;

  /** Imagem → vídeo. Recebe o que `submitImage` produziu, já pronto. */
  submitVideo(imageUrl: string, prompt: string): Promise<SubmitResult>;

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
