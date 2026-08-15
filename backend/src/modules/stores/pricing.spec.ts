import { calculatePricing, normalizeOrderStage } from './pricing';

describe('calculatePricing', () => {
  it('calcula lucro e margem sobre o preço praticado', () => {
    const result = calculatePricing({
      price: 100,
      cost: 30,
      shippingCost: 10,
      commissionPct: 8,
      taxPct: 6,
    });

    expect(result.commissionAmount).toBe(8);
    expect(result.taxAmount).toBe(6);
    expect(result.unitCost).toBe(40);
    expect(result.netProfit).toBe(46);
    expect(result.marginPct).toBe(46);
  });

  it('calcula o ponto de equilíbrio', () => {
    const result = calculatePricing({
      cost: 43,
      commissionPct: 8,
      taxPct: 6,
    });
    // 43 / (1 - 0,14) = 50,00
    expect(result.breakEvenPrice).toBe(50);
    expect(result.marginPct).toBeNull();
  });

  it('sugere o preço para a margem-alvo', () => {
    const result = calculatePricing({
      cost: 30,
      commissionPct: 10,
      taxPct: 10,
      targetMarginPct: 30,
    });
    // 30 / (1 - 0,20 - 0,30) = 60,00
    expect(result.suggestedPrice).toBe(60);
    expect(result.warning).toBeNull();
  });

  it('avisa quando a margem-alvo é inatingível', () => {
    const result = calculatePricing({
      cost: 30,
      commissionPct: 50,
      taxPct: 30,
      targetMarginPct: 40,
    });
    expect(result.suggestedPrice).toBeNull();
    expect(result.warning).toContain('inatingível');
  });

  it('avisa quando taxas consomem todo o preço', () => {
    const result = calculatePricing({
      price: 100,
      cost: 10,
      commissionPct: 70,
      taxPct: 30,
    });
    expect(result.breakEvenPrice).toBeNull();
    expect(result.warning).toContain('100%');
    // A margem do preço praticado continua sendo calculada (negativa).
    expect(result.netProfit).toBe(-10);
  });

  it('aceita prejuízo sem quebrar', () => {
    const result = calculatePricing({
      price: 50,
      cost: 60,
      commissionPct: 10,
      taxPct: 0,
    });
    expect(result.netProfit).toBe(-15);
    expect(result.marginPct).toBe(-30);
  });
});

describe('normalizeOrderStage', () => {
  it.each([
    ['Awaiting Shipment', 'pendente'],
    ['Aguardando envio', 'pendente'],
    ['Shipped', 'enviado'],
    ['Em trânsito', 'enviado'],
    ['Completed', 'concluido'],
    ['Entregue', 'concluido'],
    ['Canceled', 'cancelado'],
    ['Reembolsado', 'cancelado'],
  ])('mapeia "%s" para %s', (status, expected) => {
    expect(normalizeOrderStage(status)).toBe(expected);
  });

  it('cai em pendente quando o status é desconhecido', () => {
    expect(normalizeOrderStage('algo novo')).toBe('pendente');
  });
});
