import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { CsvRow, detectBinaryFormat, parseCsv } from './csv';

/**
 * Entrada única de planilha: aceita o CSV e o XLSX que o Seller Center gera,
 * devolvendo sempre a mesma matriz de células. Assim o mapeamento de colunas e
 * o importador não precisam saber de que formato o arquivo veio.
 */

export type SpreadsheetFormat = 'csv' | 'xlsx';

export interface SpreadsheetContent {
  rows: CsvRow[];
  format: SpreadsheetFormat;
}

export async function readSpreadsheet(
  buffer: Buffer,
): Promise<SpreadsheetContent> {
  const binary = detectBinaryFormat(buffer);

  if (binary === 'XLSX') {
    return { rows: await readXlsx(buffer), format: 'xlsx' };
  }

  if (binary) {
    // XLS (formato de 2003) e PDF não têm leitor aqui — o usuário precisa
    // reexportar, e é melhor dizer isso do que falhar com erro de parsing.
    throw new BadRequestException(
      `O arquivo parece ser ${binary}, que não conseguimos ler. Abra a planilha e use "Salvar como" no formato XLSX ou CSV.`,
    );
  }

  return { rows: parseCsv(buffer), format: 'csv' };
}

async function readXlsx(buffer: Buffer): Promise<CsvRow[]> {
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException(
      'Não foi possível abrir a planilha. Verifique se o arquivo não está corrompido ou protegido por senha.',
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new BadRequestException('A planilha não tem nenhuma aba com dados.');
  }

  const rows: CsvRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    // `row.cellCount` respeita colunas vazias no meio, que o mapeamento precisa
    // para manter os índices alinhados com o cabeçalho.
    for (let column = 1; column <= row.cellCount; column += 1) {
      cells.push(toText(row.getCell(column).value));
    }
    if (cells.some((cell) => cell !== '')) {
      rows.push({ cells, line: rowNumber });
    }
  });

  return rows;
}

/**
 * Converte o valor tipado do Excel em texto que os parsers já entendem:
 * números viram decimal com ponto, datas viram ISO, fórmulas viram o resultado.
 */
function toText(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object') {
    const cell = value as Record<string, unknown>;

    // Célula com fórmula: interessa o resultado calculado.
    if ('result' in cell) return toText(cell.result);
    // Texto formatado (rich text) vem em pedaços.
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part: any) => part.text ?? '').join('');
    }
    // Hyperlink guarda o rótulo em `text`.
    if ('text' in cell) return toText(cell.text);
    if ('error' in cell) return '';
  }

  return String(value).trim();
}
