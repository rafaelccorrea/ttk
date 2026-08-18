/**
 * O que o Electron cola na frente de todo erro que atravessa o IPC.
 *
 * `ipcRenderer.invoke` não repassa a exceção do processo principal: ele cria
 * uma nova, com a mensagem original embrulhada em
 * `Error invoking remote method 'ativacao:iniciar': Error: <mensagem>`. Esse
 * prefixo é diagnóstico do framework — nomeia um canal de IPC que só existe no
 * nosso código — e ele aparecia inteiro na tela do vendedor, empurrando a
 * frase útil para o fim de uma linha que começa em inglês.
 *
 * O `Error:` (ou `TypeError:`, `RangeError:`…) do fim é parte da mesma
 * embalagem e sai junto.
 */
const PREFIXO_DO_IPC = /^Error invoking remote method '[^']*':\s*(\w*Error:\s*)?/;

/**
 * A frase que vai para a tela, a partir de qualquer coisa que tenha sido
 * lançada.
 *
 * As mensagens do processo principal já vêm em português e já pensadas para o
 * vendedor ler — o trabalho aqui é só descascar a embalagem do IPC. Quando não
 * sobra nada aproveitável, o fallback ainda diz o que fazer, porque "erro
 * inesperado" sozinho não ajuda ninguém a sair do lugar.
 */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof Error && erro.message) {
    const limpa = erro.message.replace(PREFIXO_DO_IPC, '').trim();
    if (limpa) return limpa;
  }
  return 'Algo deu errado por aqui. Tente de novo em alguns segundos.';
}
