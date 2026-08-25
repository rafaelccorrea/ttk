import { JobsService } from './jobs.service';
import { AiJob } from './entities/ai-job.entity';

/**
 * Repositório de mentira: guarda as linhas num Map e aplica `update` como
 * merge. Só o que o executor usa (save/update/find/findOne/findOneBy).
 */
function repositorioFalso() {
  const linhas = new Map<string, AiJob>();
  let seq = 0;
  return {
    linhas,
    create: (dados: Partial<AiJob>) => dados as AiJob,
    save: async (dados: Partial<AiJob>) => {
      const job = { id: `job-${++seq}`, ...dados } as AiJob;
      linhas.set(job.id, job);
      return job;
    },
    update: async (where: { id: string }, dados: Partial<AiJob>) => {
      const atual = linhas.get(where.id);
      if (atual) Object.assign(atual, dados);
      return { affected: atual ? 1 : 0 };
    },
    find: async () => [...linhas.values()],
    findOne: async () => null,
    findOneBy: async ({ id }: { id: string }) => linhas.get(id) ?? null,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('JobsService', () => {
  it('devolve o job na hora e grava o resultado quando a função termina', async () => {
    const repo = repositorioFalso();
    const billing = { refund: jest.fn() };
    const service = new JobsService(repo as never, billing as never, { evento: () => undefined } as never);

    let libera!: (v: string) => void;
    const job = await service.iniciar(
      { userId: 'u1', tipo: 'transcribe', titulo: 'Transcrevendo x.mp4' },
      async (ctx) => {
        await ctx.progresso(40, 'Ouvindo');
        return new Promise<string>((r) => (libera = r));
      },
    );
    expect(job.id).toBeTruthy();
    for (let i = 0; i < 6; i++) await tick();
    expect(repo.linhas.get(job.id)).toMatchObject({
      status: 'rodando',
      progresso: 40,
      etapa: 'Ouvindo',
    });

    libera('pronto');
    await tick();
    await tick();
    expect(repo.linhas.get(job.id)).toMatchObject({
      status: 'concluido',
      progresso: 100,
      resultado: 'pronto',
    });
  });

  it('falha com a mensagem do erro e sem estornar (quem lançou já estornou)', async () => {
    const repo = repositorioFalso();
    const billing = { refund: jest.fn() };
    const service = new JobsService(repo as never, billing as never, { evento: () => undefined } as never);

    const job = await service.iniciar(
      { userId: 'u1', tipo: 'analyze', titulo: 'Analisando' },
      async (ctx) => {
        await ctx.cobrado('analyze');
        throw new Error('Créditos insuficientes');
      },
    );
    await tick();
    await tick();
    expect(repo.linhas.get(job.id)).toMatchObject({
      status: 'falhou',
      erro: 'Créditos insuficientes',
      estornoAcao: null,
    });
    expect(billing.refund).not.toHaveBeenCalled();
  });

  it('o cron estorna e marca como falhou o job que parou de bater', async () => {
    const repo = repositorioFalso();
    const billing = { refund: jest.fn() };
    const service = new JobsService(repo as never, billing as never, { evento: () => undefined } as never);

    const velho = new Date(Date.now() - 10 * 60_000);
    await repo.save({
      userId: 'u1',
      tipo: 'script',
      titulo: 'Roteiro',
      status: 'rodando',
      heartbeatAt: velho,
      estornoAcao: 'script',
      estornoQuantidade: 1,
    });

    const reabertos = await service.reabrirTravados();
    expect(reabertos).toBe(1);
    expect(billing.refund).toHaveBeenCalledWith(
      'u1',
      'script',
      expect.stringContaining('interrompido'),
      1,
    );
    const [linha] = [...repo.linhas.values()];
    expect(linha.status).toBe('falhou');
    expect(linha.erro).toContain('créditos foram devolvidos');
  });
});
