import { detectBinaryFormat, detectDelimiter, parseCsv } from './csv';

describe('parseCsv', () => {
  it('lê um CSV simples com vírgula', () => {
    const rows = parseCsv('a,b\n1,2\n3,4');
    expect(rows.map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('respeita aspas, vírgulas internas e aspas escapadas', () => {
    const rows = parseCsv('nome,preco\n"Camiseta ""Oversized"", azul",39.90');
    expect(rows[1].cells).toEqual(['Camiseta "Oversized", azul', '39.90']);
  });

  it('aceita quebra de linha dentro de campo entre aspas', () => {
    const rows = parseCsv('id,obs\n1,"linha 1\nlinha 2"\n2,ok');
    expect(rows).toHaveLength(3);
    expect(rows[1].cells[1]).toBe('linha 1\nlinha 2');
    // A linha física do pedido seguinte continua correta.
    expect(rows[2].line).toBe(4);
  });

  it('remove BOM e trata CRLF', () => {
    const rows = parseCsv('﻿a,b\r\n1,2\r\n');
    expect(rows[0].cells).toEqual(['a', 'b']);
    expect(rows).toHaveLength(2);
  });

  it('detecta ponto e vírgula como separador', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(parseCsv('a;b\n1;2')[1].cells).toEqual(['1', '2']);
  });

  it('detecta tab como separador', () => {
    expect(parseCsv('a\tb\n1\t2')[1].cells).toEqual(['1', '2']);
  });

  it('ignora a linha vazia final', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toHaveLength(2);
  });
});

describe('detectBinaryFormat', () => {
  it('reconhece XLSX pelo cabeçalho ZIP', () => {
    expect(detectBinaryFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(
      'XLSX',
    );
  });

  it('reconhece XLS antigo', () => {
    expect(detectBinaryFormat(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).toBe(
      'XLS',
    );
  });

  it('não acusa falso positivo em CSV', () => {
    expect(detectBinaryFormat(Buffer.from('Order ID,Status'))).toBeNull();
  });
});
