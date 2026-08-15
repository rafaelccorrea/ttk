/**
 * Parser de CSV (RFC 4180) sem dependência externa.
 *
 * Precisa aguentar o que o Seller Center do TikTok realmente exporta:
 * BOM UTF-8, separador `,` `;` ou tab conforme a região, campos entre aspas
 * com quebra de linha dentro, aspas escapadas (`""`) e CRLF.
 */

const DELIMITERS = [',', ';', '\t'] as const;

/** Assinaturas de arquivos que *não* são CSV, para dar erro claro ao usuário. */
export function detectBinaryFormat(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // XLSX/ODS são ZIP ("PK\x03\x04"); XLS antigo é OLE2.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'XLSX';
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) return 'XLS';
  if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'PDF';
  return null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Escolhe o separador contando ocorrências fora de aspas na primeira linha
 * útil. Empate resolve pela ordem de DELIMITERS (`,` primeiro).
 */
export function detectDelimiter(text: string): string {
  const sample = firstLogicalLine(text);
  let best: (typeof DELIMITERS)[number] = DELIMITERS[0];
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < sample.length; i += 1) {
      const char = sample[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && char === delimiter) {
        count += 1;
      }
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** Primeira linha ignorando quebras dentro de aspas. */
function firstLogicalLine(text: string): string {
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === '\n' || char === '\r')) return text.slice(0, i);
  }
  return text;
}

/**
 * Divide o CSV em matriz de strings. Cada linha vem com o número da linha
 * física inicial, para que os erros de importação apontem o lugar certo.
 */
export interface CsvRow {
  cells: string[];
  line: number;
}

export function parseCsv(input: Buffer | string, delimiter?: string): CsvRow[] {
  const text = stripBom(
    typeof input === 'string' ? input : input.toString('utf8'),
  );
  const sep = delimiter ?? detectDelimiter(text);

  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let hasContent = false;

  const pushField = () => {
    cells.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Ignora linhas totalmente vazias (o TikTok costuma terminar com uma).
    if (hasContent) rows.push({ cells, line: rowStartLine });
    cells = [];
    hasContent = false;
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      hasContent = true;
    } else if (char === sep) {
      hasContent = true;
      pushField();
    } else if (char === '\r') {
      // consumido junto com o \n seguinte
    } else if (char === '\n') {
      line += 1;
      pushRow();
      rowStartLine = line;
    } else {
      if (char.trim() !== '') hasContent = true;
      field += char;
    }
  }
  pushRow();

  return rows;
}
