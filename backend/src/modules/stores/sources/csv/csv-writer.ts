/**
 * Escrita de CSV para os relatórios que o usuário baixa da plataforma.
 *
 * Duas decisões que existem por causa do Excel em português:
 * - separador `;`, que é o que o Excel pt-BR espera ao abrir com duplo clique;
 * - BOM UTF-8, sem o qual acentos aparecem corrompidos.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

const SEPARATOR = ';';

function escape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (
    text.includes('"') ||
    text.includes(SEPARATOR) ||
    text.includes('\n') ||
    text.includes('\r')
  ) {
    return `"${text.split('"').join('""')}"`;
  }
  return text;
}

/** Número no formato pt-BR (vírgula decimal), para o Excel somar sem ajuste. */
export function decimal(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value.toFixed(2).replace('.', ',');
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((column) => escape(column.header)).join(SEPARATOR)];
  for (const row of rows) {
    lines.push(
      columns.map((column) => escape(column.value(row))).join(SEPARATOR),
    );
  }
  // BOM UTF-8 na frente para o Excel reconhecer a codificação.
  return '﻿' + lines.join('\r\n');
}
