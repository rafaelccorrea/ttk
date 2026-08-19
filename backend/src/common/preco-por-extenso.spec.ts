import {
  numeroPorExtenso,
  precoPorExtenso,
  precosPorExtensoNoTexto,
} from './preco-por-extenso';

describe('preço por extenso', () => {
  it('converte inteiros', () => {
    expect(numeroPorExtenso(10)).toBe('dez');
    expect(numeroPorExtenso(21)).toBe('vinte e um');
    expect(numeroPorExtenso(100)).toBe('cem');
    expect(numeroPorExtenso(199)).toBe('cento e noventa e nove');
    expect(numeroPorExtenso(1000)).toBe('mil');
    expect(numeroPorExtenso(1299)).toBe('mil duzentos e noventa e nove');
    expect(numeroPorExtenso(2500)).toBe('dois mil e quinhentos');
  });

  it('converte preços', () => {
    expect(precoPorExtenso(10)).toBe('dez reais');
    expect(precoPorExtenso(1)).toBe('um real');
    expect(precoPorExtenso(29.9)).toBe('vinte e nove reais e noventa centavos');
    expect(precoPorExtenso(99.89)).toBe(
      'noventa e nove reais e oitenta e nove centavos',
    );
    expect(precoPorExtenso(0.5)).toBe('cinquenta centavos');
  });

  // A fala que saiu ERRADA em produção — o modelo leu o algarismo errado.
  it('converte a fala real que falhou', () => {
    expect(
      precosPorExtensoNoTexto('Por 99,89 reais, vale abrir o carrinho e ver tamanhos.'),
    ).toBe(
      'Por noventa e nove reais e oitenta e nove centavos, vale abrir o carrinho e ver tamanhos.',
    );
  });

  it('cobre as três grafias', () => {
    expect(precosPorExtensoNoTexto('custa R$ 10 hoje')).toBe('custa dez reais hoje');
    expect(precosPorExtensoNoTexto('custa R$ 29,90 hoje')).toBe(
      'custa vinte e nove reais e noventa centavos hoje',
    );
    expect(precosPorExtensoNoTexto('por 10 reais só')).toBe('por dez reais só');
    expect(precosPorExtensoNoTexto('é 1 real')).toBe('é um real');
  });

  it('não mexe em texto sem preço', () => {
    expect(precosPorExtensoNoTexto('durou o churrasco inteiro')).toBe(
      'durou o churrasco inteiro',
    );
  });
});
