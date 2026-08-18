/**
 * Um erro que atravessou o IPC chega ao painel como `Error` com a mensagem que
 * o processo principal escreveu — que já vem em português e já pensada para o
 * vendedor ler. Quando não vem nada aproveitável, o fallback ainda diz o que
 * fazer, porque "Erro inesperado" sozinho não ajuda ninguém a sair do lugar.
 */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof Error && erro.message) return erro.message;
  return 'Algo deu errado por aqui. Tente de novo em alguns segundos.';
}
