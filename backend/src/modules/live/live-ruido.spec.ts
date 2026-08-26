import { ehPergunta, ehRuido } from './live-reply.service';

/**
 * O filtro barato — o que NUNCA vai ao modelo.
 *
 * Cada caso aqui é uma linha de lote que deixou de ser paga. O critério
 * continua generoso (barrar pergunta de verdade custa a venda), então os
 * "não é ruído" importam tanto quanto os "é ruído".
 */
describe('ruído do chat', () => {
  it.each(['❤️❤️', '🔥🔥🔥', '!!!', '...', '@ana_vendas', '@ana @bia', 'kkkkkk', 'KKKK!!', 'rsrsrs', 'hahaha'])(
    'descarta %j sem modelo',
    (texto) => {
      expect(ehRuido(texto)).toBe(true);
      expect(ehPergunta(texto)).toBe(false);
    },
  );

  it.each(['boa noite', 'linda demais', 'Belo Horizonte', 'top'])(
    'até duas palavras sem interrogativa não é pergunta: %j',
    (texto) => expect(ehPergunta(texto)).toBe(false),
  );

  it.each(['tem azul', 'quanto custa', 'chega antes do natal', 'cabe em quem veste 44', 'serve pra pele oleosa?'])(
    'pergunta de verdade continua passando: %j',
    (texto) => expect(ehPergunta(texto)).toBe(true),
  );
});
