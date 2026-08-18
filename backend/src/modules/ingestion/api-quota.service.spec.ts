import { Repository } from 'typeorm';
import { ApiQuotaService } from './api-quota.service';
import { IngestionSetting } from './entities/ingestion-setting.entity';

/**
 * O teto aprendido na recusa.
 *
 * O caso real: o banco dizia 500, o EchoTik cortou em 326 com "Usage Limit
 * Exceeded", e o rateio seguiu distribuindo uma cota que não existia — cada
 * execução gastava tempo para colher erro. Aprender o teto da própria recusa é
 * o que faz o planejamento voltar a ser sobre o mundo real.
 */
describe('ApiQuotaService.aprenderTetoReal', () => {
  const mes = new Date().toISOString().slice(0, 7);

  function montar(linha: Partial<IngestionSetting>) {
    const gravado: Array<Partial<IngestionSetting>> = [];
    const repo = {
      findOneBy: async () => ({
        id: 1,
        apiMonthKey: mes,
        apiRequestsUsed: 0,
        apiPlaybackUsed: 0,
        apiMonthlyBudget: 0,
        apiPlaybackSharePct: 30,
        ...linha,
      }),
      update: async (_: unknown, valores: Partial<IngestionSetting>) => {
        gravado.push(valores);
      },
      save: async () => undefined,
    } as unknown as Repository<IngestionSetting>;
    return { servico: new ApiQuotaService(repo), gravado };
  }

  it('corrige o teto para o total realmente gasto', async () => {
    const { servico, gravado } = montar({
      apiMonthlyBudget: 500,
      apiRequestsUsed: 300,
      apiPlaybackUsed: 26,
    });
    await servico.aprenderTetoReal();
    // O fornecedor cobra a soma: ele não conhece a nossa divisão interna.
    expect(gravado).toEqual([{ apiMonthlyBudget: 326 }]);
  });

  /*
   * Se o plano for aumentado no painel e o teto configurado subir, uma recusa
   * anterior não pode desfazer isso — por isso o aprendizado só encolhe.
   */
  it('não aumenta um teto já menor que o gasto', async () => {
    const { servico, gravado } = montar({
      apiMonthlyBudget: 200,
      apiRequestsUsed: 326,
      apiPlaybackUsed: 0,
    });
    await servico.aprenderTetoReal();
    expect(gravado).toEqual([]);
  });

  it('ignora recusa sem consumo registrado', async () => {
    const { servico, gravado } = montar({
      apiMonthlyBudget: 500,
      apiRequestsUsed: 0,
      apiPlaybackUsed: 0,
    });
    await servico.aprenderTetoReal();
    expect(gravado).toEqual([]);
  });

  it('aprende o teto mesmo quando não havia nenhum configurado', async () => {
    const { servico, gravado } = montar({
      apiMonthlyBudget: 0,
      apiRequestsUsed: 118,
      apiPlaybackUsed: 12,
    });
    await servico.aprenderTetoReal();
    expect(gravado).toEqual([{ apiMonthlyBudget: 130 }]);
  });
});
