/**
 * Calculadora de preço e margem — funções puras, sem banco.
 *
 * Margem aqui é sempre sobre o preço de venda (o jeito que o seller pensa:
 * "quanto sobra de cada real vendido"), não sobre o custo.
 */

export interface PricingInput {
  /** Preço praticado. Opcional quando só se quer a sugestão por margem-alvo. */
  price?: number;
  cost: number;
  /** Frete pago pelo vendedor por unidade. */
  shippingCost?: number;
  /** Embalagem, insumos, qualquer custo fixo por unidade. */
  otherCost?: number;
  /** Comissão do marketplace, em % do preço. */
  commissionPct: number;
  /** Imposto sobre a venda, em % do preço. */
  taxPct: number;
  /** Margem líquida desejada, em % do preço. */
  targetMarginPct?: number;
}

export interface PricingResult {
  price: number | null;
  unitCost: number;
  commissionAmount: number | null;
  taxAmount: number | null;
  netProfit: number | null;
  marginPct: number | null;
  /** Preço em que o lucro é exatamente zero. */
  breakEvenPrice: number | null;
  /** Preço necessário para atingir `targetMarginPct`. */
  suggestedPrice: number | null;
  /** Preenchido quando a combinação de percentuais é impossível. */
  warning: string | null;
}

const round = (value: number) => Math.round(value * 100) / 100;

export function calculatePricing(input: PricingInput): PricingResult {
  const unitCost =
    (input.cost || 0) + (input.shippingCost || 0) + (input.otherCost || 0);
  const commissionPct = input.commissionPct || 0;
  const taxPct = input.taxPct || 0;
  const targetMarginPct = input.targetMarginPct;

  let warning: string | null = null;

  // Fração do preço que sobra depois das taxas proporcionais.
  const retained = 1 - (commissionPct + taxPct) / 100;
  if (retained <= 0) {
    warning =
      'Comissão e imposto somam 100% ou mais do preço — nenhum preço cobre os custos.';
  }

  let price: number | null = null;
  let commissionAmount: number | null = null;
  let taxAmount: number | null = null;
  let netProfit: number | null = null;
  let marginPct: number | null = null;

  if (input.price !== undefined && input.price > 0) {
    price = input.price;
    commissionAmount = round((price * commissionPct) / 100);
    taxAmount = round((price * taxPct) / 100);
    netProfit = round(price - commissionAmount - taxAmount - unitCost);
    marginPct = round((netProfit / price) * 100);
  }

  const breakEvenPrice =
    retained > 0 ? round(unitCost / retained) : null;

  let suggestedPrice: number | null = null;
  if (targetMarginPct !== undefined) {
    const remaining = retained - targetMarginPct / 100;
    if (remaining > 0) {
      suggestedPrice = round(unitCost / remaining);
    } else {
      warning =
        warning ??
        `Margem de ${targetMarginPct}% é inatingível com comissão de ${commissionPct}% e imposto de ${taxPct}%.`;
    }
  }

  return {
    price,
    unitCost: round(unitCost),
    commissionAmount,
    taxAmount,
    netProfit,
    marginPct,
    breakEvenPrice,
    suggestedPrice,
    warning,
  };
}

// ---------------------------------------------------------- Status de pedidos

export type OrderStage = 'pendente' | 'enviado' | 'concluido' | 'cancelado';

const STAGE_RULES: Array<{ stage: OrderStage; matches: string[] }> = [
  {
    stage: 'cancelado',
    matches: ['cancel', 'refund', 'reembols', 'devolv', 'return', 'estorn'],
  },
  {
    stage: 'concluido',
    matches: ['complete', 'concluid', 'finaliz', 'delivered', 'entregue', 'settled'],
  },
  {
    stage: 'enviado',
    matches: ['shipped', 'enviado', 'in transit', 'em transito', 'transito'],
  },
  {
    stage: 'pendente',
    matches: [
      'awaiting',
      'to ship',
      'unpaid',
      'pending',
      'pendente',
      'aguardando',
      'a enviar',
      'preparando',
    ],
  },
];

/** Remove os acentos para que "Em trânsito" case com "em transito". */
function deaccent(text: string): string {
  let out = '';
  for (const char of text.normalize('NFD')) {
    const code = char.codePointAt(0) ?? 0;
    // Marcas combinantes (U+0300–U+036F) são o acento separado pelo NFD.
    if (code < 0x0300 || code > 0x036f) out += char;
  }
  return out;
}

/** Reduz o status cru do relatório a um estágio comparável entre regiões. */
export function normalizeOrderStage(status: string): OrderStage {
  const text = deaccent(status).toLowerCase();
  for (const rule of STAGE_RULES) {
    if (rule.matches.some((match) => text.includes(match))) return rule.stage;
  }
  return 'pendente';
}
