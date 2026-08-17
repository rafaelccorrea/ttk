/**
 * A mensagem que o backend escreveu, e não a que o axios inventou.
 *
 * `error.message` numa falha de HTTP é "Request failed with status code 402" —
 * uma frase sobre o protocolo, não sobre o problema. O texto útil ("este envio
 * custa 24 créditos e você tem 6. Compre um pacote...") está em
 * `response.data.message`, e é ele que diz ao vendedor o que fazer a seguir.
 *
 * Toda trava de saldo depende disto: uma recusa que chega como código de status
 * vira, na tela, "algo deu errado" — que é indistinguível de um bug nosso e
 * manda o cliente para o suporte em vez de para a loja de créditos.
 *
 * O array existe porque o `ValidationPipe` do Nest devolve uma lista quando há
 * mais de um campo inválido.
 */
export function mensagemDeErro(
  error: unknown,
  reserva = 'Não foi possível concluir. Tente de novo.',
): string {
  const resposta = (error as { response?: { data?: { message?: string | string[] } } })
    ?.response;
  const mensagem = resposta?.data?.message;
  if (Array.isArray(mensagem)) return mensagem.join(' ');
  return mensagem ?? reserva;
}
