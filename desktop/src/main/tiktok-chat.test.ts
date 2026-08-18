import { describe, expect, it } from 'vitest';
import { AnonimizadorDeAutor, RawChatMessage } from './tiktok-chat';

/**
 * A fronteira de privacidade do produto.
 *
 * O chat de uma live é escrito por gente que nunca foi cliente do PikPok, nunca
 * aceitou termo nenhum e não sabe que existimos. O @ dessas pessoas não tem por
 * que sair da máquina do vendedor — e o único jeito de garantir isso é aqui, no
 * ponto em que a mensagem crua vira a mensagem que sobe.
 *
 * Estes testes falham se alguém, tentando debugar, passar a levar o nome adiante.
 */

/*
 * O `msgId` é numérico, como o do webcast — e de propósito NÃO deriva do
 * username: derivando, o nome apareceria no id e o teste de vazamento passaria a
 * acusar a própria fixture em vez do código (foi o que aconteceu na primeira
 * versão deste arquivo).
 */
let sequencia = 0;
const mensagem = (username: string, text = 'quanto custa?'): RawChatMessage => ({
  msgId: `71234567890${(sequencia += 1)}`,
  username,
  text,
  receivedAt: new Date('2026-08-17T12:00:00Z'),
});

describe('anonimização do autor do chat', () => {
  it('não deixa o nome do espectador atravessar', () => {
    const anon = new AnonimizadorDeAutor('run-1');
    const saida = anon.mapear(mensagem('maria_vendas', 'tem em azul?'));

    // Nenhum campo pode conter o @, nem por acidente de nome de propriedade.
    const serializada = JSON.stringify(saida);
    expect(serializada).not.toContain('maria_vendas');
    expect(serializada).not.toContain('username');
    expect(saida).not.toHaveProperty('username');
    // O que sobe é o hash e o texto da pergunta, que é o insumo do motor.
    expect(saida.authorHash).toMatch(/^[a-f0-9]{16,}$/);
    expect(saida.text).toBe('tem em azul?');
  });

  it('dá o mesmo hash para a mesma pessoa dentro da run', () => {
    // É o que permite "cinco pessoas perguntaram o preço" e "esta já foi
    // respondida há pouco" sem guardar identidade.
    const anon = new AnonimizadorDeAutor('run-1');
    const a = anon.mapear(mensagem('joao', 'quanto?'));
    const b = anon.mapear(mensagem('joao', 'e o frete?'));
    expect(a.authorHash).toBe(b.authorHash);
  });

  it('dá hashes diferentes para pessoas diferentes', () => {
    const anon = new AnonimizadorDeAutor('run-1');
    expect(anon.mapear(mensagem('joao')).authorHash).not.toBe(
      anon.mapear(mensagem('maria')).authorHash,
    );
  });

  it('troca o hash da mesma pessoa entre runs diferentes', () => {
    /*
     * O sal por execução é o que impede correlacionar a mesma pessoa entre duas
     * lives — e é o que torna o hash irreversível na prática: sha256 de um @
     * sozinho é quebrável por força bruta, porque o espaço de @s do TikTok é
     * público e finito.
     */
    const primeira = new AnonimizadorDeAutor('run-1');
    const segunda = new AnonimizadorDeAutor('run-2');
    expect(primeira.mapear(mensagem('joao')).authorHash).not.toBe(
      segunda.mapear(mensagem('joao')).authorHash,
    );
  });

  it('preserva o id nativo da mensagem, que é o que torna a reconexão idempotente', () => {
    // Ao reconectar, o cliente reenvia o que já mandou; é este id que o backend
    // usa para não gravar nem responder duas vezes.
    const anon = new AnonimizadorDeAutor('run-1');
    const bruta = mensagem('joao', 'oi');
    expect(anon.mapear(bruta).externalMessageId).toBe(bruta.msgId);
  });

  it('não quebra com nome vazio ou com caracteres estranhos', () => {
    // O webcast às vezes entrega nickname vazio; anonimizar não pode explodir no
    // meio da live por causa disso.
    const anon = new AnonimizadorDeAutor('run-1');
    for (const nome of ['', '   ', '🔥🔥', 'ção@#$%']) {
      const saida = anon.mapear(mensagem(nome));
      expect(saida.authorHash.length).toBeGreaterThan(0);
    }
  });
});
