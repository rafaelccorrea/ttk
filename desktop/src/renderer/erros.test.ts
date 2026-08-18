import { describe, expect, it } from 'vitest';
import { mensagemDeErro } from './erros';

/**
 * O que este arquivo protege é literalmente o que o vendedor lê na tela.
 *
 * O caso que originou o teste chegou ao suporte assim, inteiro:
 * `Error invoking remote method 'ativacao:iniciar': TypeError: fetch failed`.
 * Duas camadas de embalagem — a do IPC e a da classe do erro — na frente de uma
 * frase que nem sequer era sobre o problema dele.
 */
describe('mensagemDeErro', () => {
  it('descasca o prefixo do IPC e o nome da classe do erro', () => {
    const doIpc = new Error(
      "Error invoking remote method 'ativacao:iniciar': Error: Não consegui falar com o servidor do PikPok.",
    );
    expect(mensagemDeErro(doIpc)).toBe(
      'Não consegui falar com o servidor do PikPok.',
    );
  });

  it('descasca também quando a classe é TypeError, como no fetch', () => {
    const original = new Error(
      "Error invoking remote method 'ativacao:iniciar': TypeError: fetch failed",
    );
    expect(mensagemDeErro(original)).toBe('fetch failed');
  });

  it('não mexe numa mensagem que já veio limpa', () => {
    const direto = new Error('Sessão expirada. Pareie o dispositivo de novo.');
    expect(mensagemDeErro(direto)).toBe(
      'Sessão expirada. Pareie o dispositivo de novo.',
    );
  });

  it('cai no texto que diz o que fazer quando não sobra mensagem nenhuma', () => {
    // Só a embalagem, sem conteúdo: descascar deixaria a tela em branco, que é
    // pior que uma frase genérica.
    const vazio = new Error("Error invoking remote method 'sessao:obter': ");
    expect(mensagemDeErro(vazio)).toBe(
      'Algo deu errado por aqui. Tente de novo em alguns segundos.',
    );
    expect(mensagemDeErro(undefined)).toBe(
      'Algo deu errado por aqui. Tente de novo em alguns segundos.',
    );
  });
});
