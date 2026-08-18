import {
  ACTION_PRICES,
  assertProfitability,
  compAccountEmails,
  CREDIT_VALUE_BRL,
  MIN_MARGIN,
  transcribeBlocks,
  FEATURE_MIN_PLAN,
  featureLancada,
  isCompAccount,
  LIVE_COST_PER_MINUTE_BRL,
  LIVE_HOUR_PACKS,
  livePackMinutes,
  LIVE_TRIAL_MINUTES,
  PLAN_RANK,
  PLANS,
  planAllows,
  planLiveMinutes,
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
    /*
     * O preço do plano paga DUAS coisas desde que o Business passou a incluir
     * 5 horas de live: créditos de IA e tempo de copiloto. Dividir o preço
     * cheio pelos créditos passou a dar um número sem sentido — pelo bruto, o
     * Business ficou mais caro por crédito que o Pro (R$ 0,0964 contra
     * R$ 0,0899), como se o degrau de cima fosse o pior negócio.
     *
     * A comparação certa desconta o que as horas valem sozinhas (o pacote de
     * 5h, R$ 49,90) e olha o que sobra para os créditos: R$ 0,0786, que é o
     * desconto de volume que sempre existiu. Sem esse ajuste o teste passaria a
     * cobrar uma escada que o produto não vende mais.
     */
    const porCredito = (id: string) => {
      const p = PLANS.find((x) => x.id === id)!;
      const horas = (p.monthlyLiveMinutes ?? 0) / 60;
      const pacoteDeUmaHora = LIVE_HOUR_PACKS.find((h) => h.hours === 5)!;
      const valorDasHoras = horas > 0 ? pacoteDeUmaHora.priceBrl : 0;
      return (p.priceBrl - valorDasHoras) / p.monthlyCredits;
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

/**
 * A transcrição é a única ação cujo custo real varia com a entrada: o Whisper
 * cobra por minuto e o upload é limitado por MB. Estes testes fixam a regra que
 * fechou esse buraco — o preço acompanha a duração, sempre para cima.
 */
describe('billing.config — transcrição por bloco', () => {
  it('cobra pelo menos um bloco, mesmo num áudio de segundos', () => {
    expect(transcribeBlocks(1)).toBe(1);
    expect(transcribeBlocks(0)).toBe(1);
  });

  it('arredonda para cima: bloco começado é bloco cobrado', () => {
    expect(transcribeBlocks(10 * 60)).toBe(1);
    expect(transcribeBlocks(10 * 60 + 1)).toBe(2);
    expect(transcribeBlocks(20 * 60)).toBe(2);
  });

  it('cobre o caso que dava prejuízo: 52 min de áudio a 64kbps em 25MB', () => {
    // Com o preço fixo antigo, este arquivo custava R$ 1,88 e rendia R$ 1,20.
    const blocos = transcribeBlocks(52 * 60);
    expect(blocos).toBe(6);
    const cobrado = blocos * ACTION_PRICES.transcribe.credits * CREDIT_VALUE_BRL;
    const custoReal = (52 / 60) * 0.006 * 60 * 6; // US$0,006/min × 52 × câmbio 6
    expect(cobrado).toBeGreaterThan(custoReal * MIN_MARGIN);
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

/**
 * A carteira de live é uma moeda separada, e a separação só vale enquanto
 * ninguém a converte de volta em crédito por engano. Estes testes travam as
 * três coisas que fariam a conta furar: o copiloto voltar a custar crédito, o
 * add-on ser vendido abaixo do custo, e a cortesia crescer sem querer.
 */
describe('billing.config — horas de live', () => {
  it('não cobra o copiloto ao vivo em créditos de IA', () => {
    // Se alguém recriar uma ação de live na tabela de créditos, as duas moedas
    // viram uma só e o saldo de horas deixa de significar o que promete.
    const acoesDeLiveAoVivo = Object.keys(ACTION_PRICES).filter(
      (a) => a.startsWith('live_') && a !== 'live_extract',
    );
    expect(acoesDeLiveAoVivo).toEqual([]);
  });

  it('vende toda hora de live acima do custo, com a margem mínima', () => {
    for (const pack of LIVE_HOUR_PACKS) {
      const custo = livePackMinutes(pack) * LIVE_COST_PER_MINUTE_BRL;
      expect(pack.priceBrl).toBeGreaterThanOrEqual(custo * MIN_MARGIN);
    }
  });

  it('dá desconto por volume sem inverter a escada de preço', () => {
    const porHora = [...LIVE_HOUR_PACKS]
      .sort((a, b) => a.hours - b.hours)
      .map((p) => p.priceBrl / p.hours);
    // Pacote maior nunca pode sair mais caro por hora que um menor.
    expect([...porHora].sort((a, b) => b - a)).toEqual(porHora);
  });

  it('mantém a cortesia em dez minutos e uma vez por conta', () => {
    expect(LIVE_TRIAL_MINUTES).toBe(10);
    // Barato o bastante para não doer: menos de um real de custo por conta.
    expect(LIVE_TRIAL_MINUTES * LIVE_COST_PER_MINUTE_BRL).toBeLessThan(1);
  });

  it('reprova pacote de live vendido abaixo do custo', () => {
    const original = LIVE_HOUR_PACKS[0].priceBrl;
    LIVE_HOUR_PACKS[0].priceBrl = 0.5;
    try {
      expect(assertProfitability().join(' ')).toContain(LIVE_HOUR_PACKS[0].id);
    } finally {
      LIVE_HOUR_PACKS[0].priceBrl = original;
    }
  });

  it('não expõe o Live Copilot enquanto as fases não fecharem', () => {
    // A entrega é por fases: a base de conhecimento já roda, o copiloto ao vivo
    // não. Um recurso pela metade num plano de R$ 249,90 não é preview.
    const anterior = process.env.LAUNCH_LIVE_COPILOT;
    try {
      delete process.env.LAUNCH_LIVE_COPILOT;
      expect(featureLancada('live_copilot')).toBe(false);
      // O resto do produto não pode ser afetado pela trava.
      expect(featureLancada('discovery')).toBe(true);
      expect(featureLancada('multiplier')).toBe(true);

      process.env.LAUNCH_LIVE_COPILOT = 'true';
      expect(featureLancada('live_copilot')).toBe(true);
    } finally {
      if (anterior === undefined) delete process.env.LAUNCH_LIVE_COPILOT;
      else process.env.LAUNCH_LIVE_COPILOT = anterior;
    }
  });

  it('abre o copiloto no Pro, e não abaixo dele', () => {
    /*
     * O Pro alcança o copiloto no modo PAINEL — a resposta na tela, sem tocar
     * no chat e sem risco de ToS. O que continua no Business é o ENVIO
     * automático, e a trava dele vive em `trocarModo`, não aqui: é lá que
     * escrevemos em nome do vendedor dentro da plataforma dele.
     *
     * Prender o painel junto do envio cobrava o degrau mais caro pela metade
     * que não tem risco nenhum — e um recurso que ninguém experimenta não vende
     * o degrau de cima.
     */
    expect(FEATURE_MIN_PLAN.live_copilot).toBe('pro');
    expect(planAllows('essencial', 'live_copilot')).toBe(false);
    expect(planAllows('pro', 'live_copilot')).toBe(true);
    expect(planAllows('business', 'live_copilot')).toBe(true);
  });

  it('inclui horas de live só no Business', () => {
    // O Pro EXPERIMENTA (cortesia de estreia, uma vez); o Business OPERA (horas
    // todo mês). Incluir horas no Pro apagaria a diferença entre os dois.
    const comHoras = PLANS.filter((p) => (p.monthlyLiveMinutes ?? 0) > 0).map(
      (p) => p.id,
    );
    expect(comHoras).toEqual(['business']);
  });

  it('entrega no anual doze vezes o mensal de horas', () => {
    // Minuto de live não expira, então adiantar o ano não cria pressão de uso —
    // e não existe cron de renovação: entregar mês a mês deixaria o assinante
    // anual sem hora nenhuma a partir do segundo mês.
    const business = PLANS.find((p) => p.id === 'business')!;
    expect(planLiveMinutes(business, 'month')).toBe(300);
    expect(planLiveMinutes(business, 'year')).toBe(3600);
  });
});

describe('catálogo de planos', () => {
  it('oferece anual em TODOS os planos do catálogo', () => {
    /*
     * O Business ficou sem anual por esquecimento, e a falta era pior do que
     * parece: é o plano mais caro, e quem chega nele é justamente quem pagaria
     * um ano adiantado. Dar desconto anual nos dois baratos e não no caro
     * inverte a escada — e some com a única compra do catálogo que traz doze
     * meses de caixa de uma vez.
     */
    const semAnual = PLANS.filter((p) => !p.annual).map((p) => p.id);
    expect(semAnual).toEqual([]);
  });

  it('mantém o anual mais barato por crédito que o mensal', () => {
    // Se o anual sair mais caro por crédito, ele deixa de ser desconto e vira
    // pegadinha — e o cliente que paga adiantado é o que menos merece isso.
    for (const plano of PLANS) {
      if (!plano.annual) continue;
      const mensal = plano.priceBrl / plano.monthlyCredits;
      const anual = plano.annual.priceBrl / plano.annual.credits;
      expect(anual).toBeLessThan(mensal);
    }
  });

  it('anuncia o copiloto no Pro e no Business, e o ENVIO só no Business', () => {
    /*
     * A redação separa as duas coisas de propósito. O Pro ganha o painel; o
     * envio automático fica no Business. Um perk do Pro dizendo só "Live
     * Copilot" prometeria o produto inteiro e transformaria o upgrade numa
     * reclamação de quem já pagou.
     */
    const comCopiloto = PLANS.filter((p) =>
      p.perks.some((perk) => /copilot/i.test(perk)),
    ).map((p) => p.id);
    expect(comCopiloto).toEqual(['pro', 'business']);

    const comEnvioAutomatico = PLANS.filter((p) =>
      p.perks.some((perk) => /envio autom/i.test(perk)),
    ).map((p) => p.id);
    expect(comEnvioAutomatico).toEqual(['business']);
  });
});
