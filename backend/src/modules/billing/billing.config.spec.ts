import {
  assertProfitability,
  compAccountEmails,
  FEATURE_MIN_PLAN,
  isCompAccount,
  PLAN_RANK,
  PLANS,
  planAllows,
  PlanFeature,
  SIGNUP_BONUS_CREDITS,
} from './billing.config';

/**
 * O paywall na entrada é uma regra de negócio que mora inteira em constantes —
 * e constante não quebra teste quando alguém a edita "só para testar" e esquece
 * de voltar. Estes testes são o alarme: se qualquer recurso reabrir para conta
 * não paga, o CI para.
 */
describe('billing.config — paywall na entrada', () => {
  it('não libera nenhum recurso para o plano free', () => {
    const abertos = (Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]).filter(
      (f) => planAllows('free', f),
    );
    expect(abertos).toEqual([]);
  });

  it('não dá créditos de boas-vindas a quem não pagou', () => {
    expect(SIGNUP_BONUS_CREDITS).toBe(0);
  });

  it('não vende plano de preço zero', () => {
    expect(PLANS.filter((p) => p.priceBrl === 0)).toEqual([]);
  });

  it('mantém o acesso dos assinantes legados do starter', () => {
    // Starter saiu do catálogo, mas quem paga não pode perder o que comprou:
    // ele equivale ao Essencial.
    expect(planAllows('starter', 'discovery')).toBe(true);
    expect(planAllows('starter', 'ai_scripts')).toBe(true);
    // ...sem herdar o que nunca foi dele.
    expect(planAllows('starter', 'ingestion')).toBe(false);
  });

  it('vende três degraus, e cada um destrava algo novo', () => {
    // O ponto do meio: se o Pro fosse só "mais créditos", os três planos não
    // teriam sentido próprio. Cada degrau precisa abrir um recurso.
    expect(planAllows('essencial', 'discovery')).toBe(true);
    expect(planAllows('essencial', 'ai_images')).toBe(true);
    expect(planAllows('essencial', 'ai_videos')).toBe(false);
    expect(planAllows('essencial', 'multiplier')).toBe(false);

    expect(planAllows('pro', 'ai_videos')).toBe(true);
    expect(planAllows('pro', 'multiplier')).toBe(true);
    expect(planAllows('pro', 'ingestion')).toBe(false);

    for (const f of Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]) {
      expect(planAllows('business', f)).toBe(true);
    }
  });

  it('cobra mais caro por crédito no plano menor (o volume tem desconto)', () => {
    const porCredito = (id: string) => {
      const p = PLANS.find((x) => x.id === id)!;
      return p.priceBrl / p.monthlyCredits;
    };
    // Business é o mais barato por crédito; Essencial não pode ser o melhor
    // negócio, senão ninguém sobe de degrau.
    expect(porCredito('business')).toBeLessThan(porCredito('pro'));
  });

  it('trata plano desconhecido como sem acesso', () => {
    // Plano vindo do banco que não está no PLAN_RANK cai em 0 — nunca deve
    // virar acesso liberado por omissão.
    expect(planAllows('plano-que-nao-existe', 'discovery')).toBe(false);
  });

  it('mantém todas as margens acima do mínimo', () => {
    expect(assertProfitability()).toEqual([]);
  });
});

describe('billing.config — contas de cortesia', () => {
  const original = process.env.COMP_ACCOUNT_EMAILS;
  afterEach(() => {
    if (original === undefined) delete process.env.COMP_ACCOUNT_EMAILS;
    else process.env.COMP_ACCOUNT_EMAILS = original;
  });

  it('não reconhece ninguém quando a variável está vazia', () => {
    delete process.env.COMP_ACCOUNT_EMAILS;
    expect(compAccountEmails()).toEqual([]);
    expect(isCompAccount('quem@quer.com')).toBe(false);
  });

  it('ignora espaços, caixa e vírgulas sobrando', () => {
    process.env.COMP_ACCOUNT_EMAILS = ' Time@PikPok.app , ,outro@pikpok.app ';
    expect(compAccountEmails()).toEqual(['time@pikpok.app', 'outro@pikpok.app']);
    expect(isCompAccount('TIME@pikpok.app')).toBe(true);
    expect(isCompAccount('  outro@pikpok.app  ')).toBe(true);
    expect(isCompAccount('estranho@pikpok.app')).toBe(false);
  });

  it('não confunde e-mail ausente com conta de cortesia', () => {
    process.env.COMP_ACCOUNT_EMAILS = 'time@pikpok.app';
    expect(isCompAccount(undefined)).toBe(false);
    expect(isCompAccount('')).toBe(false);
    expect(isCompAccount(null)).toBe(false);
  });
});

describe('billing.config — hierarquia de planos', () => {
  it('mantém o free no piso e o business no topo', () => {
    expect(PLAN_RANK.free).toBe(0);
    expect(PLAN_RANK.business).toBeGreaterThan(PLAN_RANK.pro);
  });

  it('deixa o free abaixo do degrau que libera pacote avulso', () => {
    // assertSubscriber compara contra PLAN_RANK.starter.
    expect(PLAN_RANK.free).toBeLessThan(PLAN_RANK.starter);
  });
});
