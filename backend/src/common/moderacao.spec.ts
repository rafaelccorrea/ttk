import { BadRequestException } from '@nestjs/common';
import { avaliarConteudo, garantirConteudoPermitido } from './moderacao';

describe('moderação de conteúdo', () => {
  it('bloqueia as categorias proibidas', () => {
    expect(avaliarConteudo('Curso de OnlyFans para iniciantes')).toBe('sexual');
    expect(avaliarConteudo('vendo cocaína pura')).toBe('drogas');
    expect(avaliarConteudo('Revólver calibre 38 novo')).toBe('armas');
  });

  it('ignora acentos e maiúsculas', () => {
    // "Cocaína" e "cocaina" são a mesma palavra para o filtro.
    expect(avaliarConteudo('COCAÍNA')).toBe('drogas');
    expect(avaliarConteudo('cocaina')).toBe('drogas');
  });

  it('não dispara em produto legítimo (palavra inteira, não substring)', () => {
    // Cada um destes contém um pedaço de termo bloqueado — e é inofensivo.
    expect(avaliarConteudo('Promoção de sexta-feira')).toBeNull();
    expect(avaliarConteudo('Pistola de cola quente 40W')).toBeNull();
    expect(avaliarConteudo('Sabonete erótico?')).not.toBeNull(); // este é real
    expect(avaliarConteudo('Kit maquiagem com espelho')).toBeNull();
    expect(avaliarConteudo('Bongô instrumento musical')).toBeNull(); // ≠ "bong"
  });

  it('garantirConteudoPermitido lança com mensagem amigável', () => {
    expect(() =>
      garantirConteudoPermitido({ name: 'Batom', benefit: 'fixa o dia todo' }),
    ).not.toThrow();
    expect(() =>
      garantirConteudoPermitido({ name: 'Batom', benefit: 'brinde: maconha' }),
    ).toThrow(BadRequestException);
  });
});
