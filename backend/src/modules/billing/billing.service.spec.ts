import { HttpException } from '@nestjs/common';
import { BillingService } from './billing.service';
import {
  ACTION_PRICES,
  REFERRAL_REWARD,
  LIVE_TRIAL_MINUTES,
  SIGNUP_BONUS_CREDITS,
} from './billing.config';

/**
 * A carteira de minutos de live é dinheiro do cliente, e cada regra aqui existe
 * porque a alternativa custa caro para alguém: cobrar duas vezes, dar hora de
 * graça, ou deixar o copiloto rodando com saldo negativo.
 *
 * O que os testes protegem, em uma frase: o débito é atômico, a cortesia é uma
 * só, e o webhook do Stripe nunca credita duas vezes.
 */

/**
 * Dublê de repositório com o mínimo que estes fluxos tocam.
 *
 * O `createQueryBuilder` é dublado porque é ele que carrega a parte que importa:
 * o débito e a concessão da cortesia são UPDATE CONDICIONAL, e `affected` é a
 * resposta do banco a "você ganhou a corrida?". Um mock que sempre devolve
 * `affected: 1` não testaria nada — então `afetadas` é controlado por teste.
 */
function repositorioDeUsuarios(estado: {
  usuario?: Record<string, unknown> | null;
  afetadas?: number[];
}) {
  const afetadas = [...(estado.afetadas ?? [1])];
  const execute = jest.fn(async () => ({
    affected: afetadas.length > 1 ? afetadas.shift() : afetadas[0],
  }));
  const builder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute,
  };
  return {
    findOneBy: jest.fn(async () => estado.usuario ?? null),
    createQueryBuilder: jest.fn(() => builder),
    increment: jest.fn(async () => ({ affected: 1 })),
    update: jest.fn(async (_alvo: unknown, _mudanca: unknown) => ({
      affected: 1,
    })),
    builder,
    execute,
  };
}

/**
 * Só os lançamentos de COBRANÇA.
 *
 * A cortesia de cadastro (`signup_bonus`, 250 créditos) é concedida na primeira
 * vez que a conta passa por `charge`/`assertSaldo`/`getWallet`, então ela
 * aparece na lista de lançamentos junto com o que o teste quer observar.
 * Filtrar por aqui deixa cada teste falando do que ele realmente afirma —
 * "cobrou" ou "não cobrou" —, em vez de contar linhas.
 */
function gastos(salvos: unknown[]) {
  return (salvos as Array<{ kind?: string }>).filter(
    (t) => t.kind !== 'signup_bonus',
  );
}

function repositorioDeLancamentos(existente: unknown = null) {
  const salvos: unknown[] = [];
  /*
   * A soma do consumo mensal (`liveMinutesUsedThisMonth`) vem de um
   * queryBuilder de SELECT sobre o extrato. Zero por padrão — cada teste de
   * teto mensal troca o retorno para simular um mês já gasto.
   */
  const consulta = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(async () => ({ total: '0' })),
  };
  return {
    findOneBy: jest.fn(async () => existente),
    // Âncora do ciclo de consumo (`consumoDoCiclo`): sem lançamento, o ciclo
    // começa do zero e a carteira reporta 0% usado.
    findOne: jest.fn(async () => null),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: unknown) => {
      salvos.push(x);
      return x;
    }),
    find: jest.fn(async () => []),
    createQueryBuilder: jest.fn(() => consulta),
    consulta,
    salvos,
  };
}

function montar(estado: {
  usuario?: Record<string, unknown> | null;
  afetadas?: number[];
  lancamentoExistente?: unknown;
  /** Conta recém-criada: a cortesia de cadastro ainda não foi concedida. */
  bonusPendente?: boolean;
}) {
  const users = repositorioDeUsuarios(estado);
  /*
   * A conta destes testes é uma conta EXISTENTE: a cortesia de cadastro já foi
   * concedida (`signup_bonus` no extrato), então `ensureSignupBonus` não faz
   * nada. Sem isto, toda cobrança viria precedida de um crédito de 25 e os
   * testes de débito passariam a medir o bônus em vez da cobrança.
   *
   * A concessão em si tem teste próprio, logo abaixo: "cortesia de cadastro".
   */
  const creditos = repositorioDeLancamentos(
    estado.bonusPendente ? null : { kind: 'signup_bonus' },
  );
  const minutos = repositorioDeLancamentos(estado.lancamentoExistente ?? null);
  const servico = new BillingService(
    users as never,
    creditos as never,
    minutos as never,
    { invalidar: () => undefined } as never,
  );
  return { servico, users, creditos, minutos };
}

const BUSINESS = {
  id: 'u1',
  email: 'vendedor@loja.com',
  plan: 'business',
  liveMinutes: 120,
  liveTrialGrantedAt: null,
};

describe('carteira de minutos — consumo', () => {
  it('debita o minuto de quem tem saldo e plano', async () => {
    const { servico, minutos } = montar({ usuario: { ...BUSINESS } });
    await expect(servico.chargeLiveMinutes('u1', 1)).resolves.toBeDefined();
    // Todo débito deixa rastro no extrato próprio da moeda.
    expect(minutos.save).toHaveBeenCalled();
    expect((minutos.salvos[0] as { minutes: number }).minutes).toBe(-1);
  });

  it('recusa com 402 quando o saldo não cobre', async () => {
    // `affected: 0` é o banco dizendo que a condição de saldo não passou — é
    // assim que a corrida é resolvida, não com um `if` antes do UPDATE.
    const { servico } = montar({ usuario: { ...BUSINESS }, afetadas: [0] });
    await expect(servico.chargeLiveMinutes('u1', 1)).rejects.toMatchObject({
      status: 402,
    });
  });

  it('não deixa dois débitos simultâneos furarem o saldo', async () => {
    // Saldo para um: o primeiro UPDATE afeta a linha, o segundo não. Sem a
    // condição no UPDATE, os dois leriam "tem saldo" e o cliente ficaria devendo
    // tempo que não comprou.
    const { servico } = montar({ usuario: { ...BUSINESS }, afetadas: [1, 0] });
    await expect(servico.chargeLiveMinutes('u1', 1)).resolves.toBeDefined();
    await expect(servico.chargeLiveMinutes('u1', 1)).rejects.toMatchObject({
      status: 402,
    });
  });

  it('deixa o Pro gastar minuto — ele tem o copiloto no painel', async () => {
    /*
     * Mudou com a abertura do copiloto para o Pro. O que continua sendo do
     * Business é o ENVIO automático, e essa trava mora em `trocarModo`, não no
     * débito: cobrar o minuto do Pro é cobrar pelo painel, que é o que ele
     * comprou. Recusar aqui deixaria os dez minutos de cortesia sem serventia —
     * saldo que existe e não pode ser usado.
     */
    const { servico } = montar({
      usuario: { ...BUSINESS, plan: 'pro', liveMinutes: 500 },
    });
    await expect(servico.chargeLiveMinutes('u1', 1)).resolves.toBeDefined();
  });

  it('deixa o Essencial gastar minuto — o painel abre no degrau de entrada', async () => {
    // O Essencial paga por hora (packs) dentro do teto mensal de 15h; a trava
    // que continua acima dele é a de recurso melhor, não a do painel.
    const { servico } = montar({
      usuario: { ...BUSINESS, plan: 'essencial', liveMinutes: 500 },
    });
    await expect(servico.chargeLiveMinutes('u1', 1)).resolves.toBeDefined();
  });

  it('deixa a conta free gastar minuto — os 10 de cortesia são dela', async () => {
    // O painel abre no free; a trava de custo é a própria carteira (10 min de
    // cortesia, e acabou é 402 com CTA de assinar).
    const { servico } = montar({
      usuario: { ...BUSINESS, plan: 'free', liveMinutes: 10 },
    });
    await expect(servico.chargeLiveMinutes('u1', 1)).resolves.toBeDefined();
  });

  it('concede o bônus de adesão uma vez, e o upgrade só a diferença', async () => {
    // Assinou o Pro: ganha 40h (2.400 min). A renovação chama setPlan de novo
    // e não pode conceder de novo; o upgrade para Business soma só as 20h que
    // faltam para o bônus do degrau novo.
    const usuario = { ...BUSINESS, plan: 'free', liveSignupMinutesGranted: 0 };
    const { servico, users, minutos } = montar({ usuario });
    users.update.mockImplementation(async (_alvo: unknown, mudanca: unknown) => {
      Object.assign(usuario, mudanca as Record<string, unknown>);
      return { affected: 1 };
    });
    const concedidos = () =>
      (minutos.salvos as Array<{ kind?: string; minutes?: number }>)
        .filter((t) => t.kind === 'purchase')
        .map((t) => t.minutes);

    await servico.setPlan('u1', 'pro');
    expect(concedidos()).toEqual([2400]);
    // Renovação: mesmo plano, nada novo.
    await servico.setPlan('u1', 'pro');
    expect(concedidos()).toEqual([2400]);
    // Upgrade: só a diferença (3.600 − 2.400).
    await servico.setPlan('u1', 'business');
    expect(concedidos()).toEqual([2400, 1200]);
    // Downgrade não devolve nem re-concede.
    await servico.setPlan('u1', 'essencial');
    expect(concedidos()).toEqual([2400, 1200]);
  });

  it('nunca debita menos de um minuto, nem fração', async () => {
    const { servico, minutos } = montar({ usuario: { ...BUSINESS } });
    await servico.chargeLiveMinutes('u1', 0);
    await servico.chargeLiveMinutes('u1', 0.4);
    await servico.chargeLiveMinutes('u1', -5);
    for (const lancamento of minutos.salvos as Array<{ minutes: number }>) {
      expect(lancamento.minutes).toBe(-1);
    }
  });
});

describe('carteira de minutos — a cortesia de estreia', () => {
  it('concede os dez minutos à conta free que nunca recebeu', async () => {
    const { servico, minutos } = montar({
      usuario: { ...BUSINESS, plan: 'free', liveMinutes: LIVE_TRIAL_MINUTES },
    });
    await expect(servico.grantLiveTrial('u1')).resolves.toBe(LIVE_TRIAL_MINUTES);
    expect((minutos.salvos[0] as { kind: string }).kind).toBe('trial');
  });

  it('não concede a quem já assina — assinante entra com as horas de adesão', async () => {
    // A cortesia é a prova de produto de quem ainda não pagou; o Business já
    // começa com 60h, e dez minutos por cima seriam ruído no extrato.
    const { servico, minutos } = montar({ usuario: { ...BUSINESS } });
    await expect(servico.grantLiveTrial('u1')).resolves.toBe(0);
    expect(minutos.salvos).toHaveLength(0);
  });

  it('não concede duas vezes — nem em duas abas ao mesmo tempo', async () => {
    /*
     * A segunda chamada não afeta linha porque o UPDATE exige
     * `liveTrialGrantedAt IS NULL`. Se a trava fosse um `if` sobre o valor lido,
     * duas requisições simultâneas dariam vinte minutos de graça por conta.
     */
    const { servico, minutos } = montar({
      usuario: { ...BUSINESS, plan: 'free' },
      afetadas: [1, 0],
    });
    await expect(servico.grantLiveTrial('u1')).resolves.toBe(LIVE_TRIAL_MINUTES);
    await expect(servico.grantLiveTrial('u1')).resolves.toBe(0);
    expect(minutos.salvos).toHaveLength(1);
  });

  it('é chamável à vontade sem efeito para quem já ganhou', async () => {
    const { servico, minutos } = montar({
      usuario: { ...BUSINESS, liveTrialGrantedAt: new Date() },
      afetadas: [0],
    });
    await expect(servico.grantLiveTrial('u1')).resolves.toBe(0);
    expect(minutos.salvos).toHaveLength(0);
  });

  it('a carteira só anuncia a cortesia para a conta free', async () => {
    // `trialAvailable` é o que a tela lê antes de prometer os dez minutos. Um
    // assinante sem o carimbo ainda não os ganhou — e nunca vai ganhar
    // (`grantLiveTrial` devolve zero) —, então a carteira não pode oferecê-los.
    const { servico: free } = montar({
      usuario: { ...BUSINESS, plan: 'free', liveMinutes: 0 },
    });
    expect((await free.getWallet('u1')).liveCopilot.trialAvailable).toBe(true);

    const { servico: assinante } = montar({ usuario: { ...BUSINESS } });
    expect((await assinante.getWallet('u1')).liveCopilot.trialAvailable).toBe(false);

    const { servico: jaGanhou } = montar({
      usuario: { ...BUSINESS, plan: 'free', liveTrialGrantedAt: new Date() },
    });
    expect((await jaGanhou.getWallet('u1')).liveCopilot.trialAvailable).toBe(false);
  });
});

describe('carteira de minutos — compra e estorno', () => {
  it('credita as horas do add-on pago', async () => {
    const { servico, users, minutos } = montar({ usuario: { ...BUSINESS } });
    await servico.grantLiveMinutes('u1', 300, 'cs_test_1', '5 horas de live');
    expect(users.increment).toHaveBeenCalledWith({ id: 'u1' }, 'liveMinutes', 300);
    expect((minutos.salvos[0] as { kind: string }).kind).toBe('purchase');
  });

  it('não credita duas vezes o mesmo pagamento', async () => {
    // O Stripe reenvia evento. Sem esta guarda, o cliente ganharia as horas
    // quantas vezes o webhook chegasse.
    const { servico, users, minutos } = montar({
      usuario: { ...BUSINESS },
      lancamentoExistente: { id: 'ja-existe' },
    });
    await servico.grantLiveMinutes('u1', 300, 'cs_test_1', '5 horas de live');
    expect(users.increment).not.toHaveBeenCalled();
    expect(minutos.salvos).toHaveLength(0);
  });

  it('devolve minutos de transmissão que o copiloto não atendeu', async () => {
    const { servico, users, minutos } = montar({ usuario: { ...BUSINESS } });
    await servico.refundLiveMinutes('u1', 3, 'A live caiu');
    expect(users.increment).toHaveBeenCalledWith({ id: 'u1' }, 'liveMinutes', 3);
    expect((minutos.salvos[0] as { kind: string; minutes: number })).toMatchObject({
      kind: 'refund',
      minutes: 3,
    });
  });
});

describe('a trava de lançamento do Live Copilot', () => {
  const anterior = process.env.LAUNCH_LIVE_COPILOT;
  const compAnterior = process.env.COMP_ACCOUNT_EMAILS;

  afterEach(() => {
    if (anterior === undefined) delete process.env.LAUNCH_LIVE_COPILOT;
    else process.env.LAUNCH_LIVE_COPILOT = anterior;
    if (compAnterior === undefined) delete process.env.COMP_ACCOUNT_EMAILS;
    else process.env.COMP_ACCOUNT_EMAILS = compAnterior;
  });

  it('esconde o recurso de quem paga enquanto não foi lançado', async () => {
    delete process.env.LAUNCH_LIVE_COPILOT;
    delete process.env.COMP_ACCOUNT_EMAILS;
    const { servico } = montar({ usuario: { ...BUSINESS } });
    // 404 e não 403: para quem não pode ver, o recurso não existe — mandar um
    // assinante do topo "fazer upgrade" seria pior que não responder.
    await expect(servico.assertFeature('u1', 'live_copilot')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('deixa a equipe atravessar para testar em produção', async () => {
    delete process.env.LAUNCH_LIVE_COPILOT;
    process.env.COMP_ACCOUNT_EMAILS = 'vendedor@loja.com';
    const { servico } = montar({ usuario: { ...BUSINESS } });
    await expect(
      servico.assertFeature('u1', 'live_copilot'),
    ).resolves.toBeUndefined();
  });

  it('libera para todo mundo quando a flag sobe', async () => {
    process.env.LAUNCH_LIVE_COPILOT = 'true';
    delete process.env.COMP_ACCOUNT_EMAILS;
    const { servico } = montar({ usuario: { ...BUSINESS } });
    await expect(
      servico.assertFeature('u1', 'live_copilot'),
    ).resolves.toBeUndefined();
  });

  it('não afeta os outros recursos do produto', async () => {
    delete process.env.LAUNCH_LIVE_COPILOT;
    const { servico } = montar({ usuario: { ...BUSINESS } });
    await expect(servico.assertFeature('u1', 'discovery')).resolves.toBeUndefined();
    await expect(servico.assertFeature('u1', 'multiplier')).resolves.toBeUndefined();
  });

  it('continua barrando por plano quem não paga o degrau', async () => {
    // O painel do copiloto abre até no free (só a cortesia); a trava de plano
    // continua valendo para os recursos que realmente pedem degrau — o vídeo
    // com IA é do Pro, e o Essencial não passa.
    process.env.LAUNCH_LIVE_COPILOT = 'true';
    const { servico } = montar({ usuario: { ...BUSINESS, plan: 'free' } });
    await expect(servico.assertFeature('u1', 'live_copilot')).resolves.toBeUndefined();
    const essencial = montar({ usuario: { ...BUSINESS, plan: 'essencial' } });
    await expect(
      essencial.servico.assertFeature('u1', 'ai_videos'),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('assertSaldo — a trava de entrada', () => {
  /*
   * A soma é o ponto inteiro deste método. O upload da live cobra transcrição e
   * extração em momentos diferentes, e conferir uma de cada vez aprova quem tem
   * saldo para cada metade e para nenhum inteiro — o pedido que quebra no meio
   * do pipeline, depois de já ter debitado a primeira parte.
   */
  it('soma as ações em vez de conferir uma a uma', async () => {
    const { servico } = montar({
      usuario: { ...BUSINESS, credits: ACTION_PRICES.live_extract.credits },
    });
    // Sobra para a extração sozinha; não sobra para as duas juntas.
    await expect(
      servico.assertSaldo('u1', [
        { action: 'transcribe' },
        { action: 'live_extract' },
      ]),
    ).rejects.toMatchObject({ status: 402 });
  });

  it('deixa passar quem cobre a soma', async () => {
    const { servico } = montar({
      usuario: {
        ...BUSINESS,
        credits:
          ACTION_PRICES.transcribe.credits + ACTION_PRICES.live_extract.credits,
      },
    });
    await expect(
      servico.assertSaldo('u1', [
        { action: 'transcribe' },
        { action: 'live_extract' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('recusa por plano antes de olhar o saldo', async () => {
    // Crédito de sobra não compra um recurso que o plano não inclui — e a
    // mensagem tem de falar de plano, não de saldo, senão o vendedor compra um
    // pacote de créditos que não vai destravar nada.
    // `video` é do Pro; `live_extract` deixou de servir de exemplo porque o
    // copiloto (e a base dele) abriu até para o free.
    const { servico } = montar({
      usuario: { ...BUSINESS, plan: 'free', credits: 10_000 },
    });
    await expect(
      servico.assertSaldo('u1', [{ action: 'video' }]),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('não debita nada — é só uma pergunta', async () => {
    const { servico, users, creditos } = montar({
      usuario: { ...BUSINESS, credits: 10_000 },
    });
    await servico.assertSaldo('u1', [{ action: 'live_extract' }]);
    expect(users.builder.set).not.toHaveBeenCalled();
    /*
     * "Nada" aqui quer dizer nenhum DÉBITO. Desde a cortesia de boas-vindas
     * (SIGNUP_BONUS_CREDITS), a primeira passagem de uma conta por aqui pode
     * gravar o crédito de cadastro — que é um lançamento positivo, e não uma
     * cobrança. Comparar o tamanho da lista confundia as duas coisas.
     */
    expect(gastos(creditos.salvos)).toHaveLength(0);
  });
});

describe('charge dentro de uma transação de fora', () => {
  /*
   * O pipeline da live cobra e, logo depois, grava o marcador que torna o
   * estorno possível. Em transações separadas há uma janela em que o processo
   * pode morrer com o crédito debitado e nenhum marcador escrito — e aí o
   * estorno, que procura pelo marcador, não acha nada. O crédito some sem
   * rastro, e quem paga o restart é o cliente.
   */
  it('escreve pelos repositórios do manager, não pelos próprios', async () => {
    const { servico, users, creditos } = montar({
      usuario: { ...BUSINESS, plan: 'business', credits: 1000 },
    });

    const doManager = repositorioDeUsuarios({
      usuario: { ...BUSINESS, plan: 'business', credits: 1000 },
    });
    const lancamentosDoManager = repositorioDeLancamentos();
    const manager = {
      getRepository: jest.fn((entidade: { name: string }) =>
        entidade.name === 'AppUser' ? doManager : lancamentosDoManager,
      ),
    };

    await servico.charge('u1', 'transcribe', 1, manager as never);

    // O débito foi pela conexão da transação...
    expect(doManager.execute).toHaveBeenCalled();
    expect(gastos(lancamentosDoManager.salvos)).toHaveLength(1);
    // ...e não pela do serviço, que ficaria fora do rollback.
    expect(users.execute).not.toHaveBeenCalled();
    expect(creditos.salvos).toHaveLength(0);
  });

  it('sem manager, segue exatamente como antes', async () => {
    const { servico, users, creditos } = montar({
      usuario: { ...BUSINESS, plan: 'business', credits: 1000 },
    });
    await servico.charge('u1', 'transcribe', 1);
    expect(users.execute).toHaveBeenCalled();
    expect(gastos(creditos.salvos)).toHaveLength(1);
  });
});

describe('conta interna (COMP_ACCOUNT_EMAILS)', () => {
  const ADMIN = 'pikpok@pikpok.app';

  beforeEach(() => {
    process.env.COMP_ACCOUNT_EMAILS = ADMIN;
  });
  afterEach(() => {
    delete process.env.COMP_ACCOUNT_EMAILS;
  });

  it('não debita crédito, mesmo com saldo zero', async () => {
    // O caso real: a conta que demonstra o produto travando por falta de saldo
    // no meio de uma demonstração.
    const { servico, users, creditos } = montar({
      usuario: { ...BUSINESS, email: ADMIN, credits: 0 },
    });
    await expect(servico.charge('u1', 'transcribe')).resolves.toEqual({ cortesia: false });
    expect(users.builder.set).not.toHaveBeenCalled();
    // Mas o uso fica no extrato, com valor zero: o histórico segue contando o
    // que foi feito sem mexer no saldo.
    expect((gastos(creditos.salvos)[0] as { amount: number }).amount).toBe(0);
    expect((gastos(creditos.salvos)[0] as { description: string }).description).toContain(
      'uso interno',
    );
  });

  it('não consome minuto de live', async () => {
    const { servico, minutos } = montar({
      usuario: { ...BUSINESS, email: ADMIN, liveMinutes: 0 },
    });
    await expect(servico.chargeLiveMinutes('u1', 1)).resolves.toBe(0);
    expect((minutos.salvos[0] as { minutes: number }).minutes).toBe(0);
  });

  it('passa direto pela trava de entrada', async () => {
    // Sem isto, a trava barraria na PORTA quem o `charge` deixa passar lá
    // dentro — e o sintoma seria "o upload nem começa".
    const { servico } = montar({
      usuario: { ...BUSINESS, email: ADMIN, credits: 0 },
    });
    await expect(
      servico.assertSaldo('u1', [
        { action: 'transcribe' },
        { action: 'live_extract' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('marca a carteira como ilimitada para a interface', async () => {
    const { servico } = montar({
      usuario: { ...BUSINESS, email: ADMIN, credits: 0, liveMinutes: 0 },
    });
    const carteira = await servico.getWallet('u1');
    expect(carteira.unlimited).toBe(true);
  });

  it('cliente comum continua sendo cobrado normalmente', async () => {
    // A trava não pode valer para quem paga: seria receita virando zero.
    const { servico, users, creditos } = montar({
      usuario: { ...BUSINESS, email: 'cliente@loja.com', credits: 1000 },
    });
    await servico.charge('u1', 'transcribe');
    expect(users.execute).toHaveBeenCalled();
    expect((gastos(creditos.salvos)[0] as { amount: number }).amount).toBeLessThan(0);
  });
});

/**
 * A cortesia de cadastro — o que faz a conta gratuita conseguir experimentar a
 * IA sem assinar (docs/CONTA-FREE.md). É dinheiro nosso saindo, então o que
 * estes testes protegem é o "uma vez por conta".
 */
describe('cortesia de cadastro (SIGNUP_BONUS_CREDITS)', () => {
  it('credita na primeira passagem de uma conta nova', async () => {
    const { servico, creditos } = montar({
      usuario: { ...BUSINESS, plan: 'free', credits: 0 },
      bonusPendente: true,
    });
    await servico.getWallet('u1');
    const bonus = (creditos.salvos as Array<{ kind: string; amount: number }>).find(
      (t) => t.kind === 'signup_bonus',
    );
    expect(bonus?.amount).toBe(SIGNUP_BONUS_CREDITS);
  });

  it('não credita de novo em quem já recebeu', async () => {
    // `bonusPendente` ausente = já existe o lançamento no extrato. É esta
    // consulta, e não um campo no usuário, que impede a segunda concessão.
    const { servico, creditos } = montar({
      usuario: { ...BUSINESS, plan: 'free', credits: 0 },
    });
    await servico.getWallet('u1');
    expect(
      (creditos.salvos as Array<{ kind: string }>).filter(
        (t) => t.kind === 'signup_bonus',
      ),
    ).toHaveLength(0);
  });
});

/**
 * O vídeo de cortesia (SAMPLE_VIDEOS_PER_ACCOUNT). O que se protege: ele passa
 * sem debitar e sem exigir o Pro, passa UMA vez, e o estorno devolve o voucher —
 * nunca 60 créditos para uma conta que não os comprou.
 */
describe('vídeo de cortesia (SAMPLE_VIDEOS_PER_ACCOUNT)', () => {
  const FREE = { ...BUSINESS, plan: 'free', credits: 25, sampleVideoUsedAt: null };

  it('deixa a conta gratuita gerar um vídeo sem debitar', async () => {
    const { servico, creditos } = montar({ usuario: FREE });
    const recibo = await servico.charge('u1', 'video');
    expect(recibo.cortesia).toBe(true);
    const lancado = gastos(creditos.salvos) as Array<{ kind: string; amount: number }>;
    expect(lancado).toHaveLength(1);
    expect(lancado[0]).toMatchObject({ kind: 'sample_video', amount: 0 });
  });

  it('só vale uma vez: gasto o vídeo, a ação volta a exigir o Pro', async () => {
    const { servico } = montar({
      usuario: { ...FREE, sampleVideoUsedAt: new Date() },
    });
    await expect(servico.charge('u1', 'video')).rejects.toMatchObject({ status: 403 });
  });

  it('não cobre cena de modelo mais caro que a tabela', async () => {
    // Amostra é o vídeo de tabela; escolher o modelo de 90 é operação.
    const { servico } = montar({ usuario: FREE });
    await expect(
      servico.charge('u1', 'video', 1, undefined, ACTION_PRICES.video.credits + 30),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('quem perde a corrida do UPDATE não ganha o vídeo', async () => {
    // Dois pedidos leram `sampleVideoUsedAt` nulo; o banco só deixa um passar.
    const { servico } = montar({ usuario: FREE, afetadas: [0] });
    await expect(servico.charge('u1', 'video')).rejects.toMatchObject({ status: 403 });
  });

  it('não dá cortesia a quem já tem vídeo no plano', async () => {
    const { servico, creditos } = montar({
      usuario: { ...BUSINESS, plan: 'pro', credits: 500, sampleVideoUsedAt: null },
    });
    const recibo = await servico.charge('u1', 'video');
    expect(recibo.cortesia).toBe(false);
    expect((gastos(creditos.salvos)[0] as { kind: string }).kind).toBe('spend');
  });

  it('estorna devolvendo o voucher, não créditos', async () => {
    const { servico, users, creditos } = montar({
      usuario: { ...FREE, sampleVideoUsedAt: new Date() },
    });
    await servico.restoreSampleVideo('u1', 'Estorno: geração de vídeo falhou');
    expect(users.builder.set).toHaveBeenCalledWith({ sampleVideoUsedAt: null });
    const lancado = gastos(creditos.salvos) as Array<{ kind: string; amount: number }>;
    expect(lancado).toHaveLength(1);
    expect(lancado[0]).toMatchObject({ kind: 'sample_video', amount: 0 });
  });

  it('withCharge: falhou a IA, volta o voucher em vez de creditar', async () => {
    const { servico, users } = montar({ usuario: FREE });
    await expect(
      servico.withCharge('u1', 'video', async () => {
        throw new Error('fornecedor caiu');
      }),
    ).rejects.toThrow('fornecedor caiu');
    expect(users.builder.set).toHaveBeenCalledWith({ sampleVideoUsedAt: null });
    // Nenhum `credits + N`: o saldo da conta gratuita não pode crescer por falha nossa.
    const campos = users.builder.set.mock.calls.flatMap((c: unknown[]) =>
      Object.keys(c[0] as Record<string, unknown>),
    );
    expect(campos).not.toContain('credits');
  });
});


/**
 * Indicação. O que estes testes protegem: o bônus sai do PAGAMENTO (não do
 * cadastro), sai UMA vez por indicado, e a corrida entre o webhook do Stripe
 * e o redirect de sucesso é resolvida pelo banco — não por um `if`.
 */
describe('indicação', () => {
  const INDICADO = {
    id: 'u2',
    email: 'novo@loja.com',
    plan: 'essencial',
    referredBy: 'u1',
    referralRewardedAt: null,
  };

  it('credita os dois lados quando o indicado assina', async () => {
    const { servico, creditos } = montar({ usuario: { ...INDICADO } });
    await servico.payReferral('u2', 'cs_test_1');
    const lancamentos = creditos.salvos as Array<{
      userId: string;
      kind: string;
      amount: number;
    }>;
    expect(lancamentos.find((t) => t.kind === 'referral_bonus')).toMatchObject({
      userId: 'u1',
      amount: REFERRAL_REWARD.indicador,
    });
    expect(
      lancamentos.find((t) => t.kind === 'referral_welcome'),
    ).toMatchObject({ userId: 'u2', amount: REFERRAL_REWARD.indicado });
  });

  it('não paga de novo quando a recompensa já saiu', async () => {
    const { servico, creditos } = montar({
      usuario: { ...INDICADO, referralRewardedAt: new Date() },
    });
    await servico.payReferral('u2', 'cs_test_2');
    expect(gastos(creditos.salvos)).toHaveLength(0);
  });

  it('não paga quem chegou sem indicação', async () => {
    const { servico, creditos } = montar({
      usuario: { ...INDICADO, referredBy: null },
    });
    await servico.payReferral('u2', 'cs_test_3');
    expect(gastos(creditos.salvos)).toHaveLength(0);
  });

  it('perde a corrida do webhook reentregue sem creditar', async () => {
    // `affected: 0` é o banco dizendo que outra entrega já marcou a data.
    const { servico, creditos } = montar({
      usuario: { ...INDICADO },
      afetadas: [0],
    });
    await servico.payReferral('u2', 'cs_test_4');
    expect(gastos(creditos.salvos)).toHaveLength(0);
  });
});
