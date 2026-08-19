import { Repository } from 'typeorm';
import { LiveProduct } from './entities/live-product.entity';
import { LiveService } from './live.service';

/**
 * O irmão do bug da duração, no outro lado do pipeline.
 *
 * `sourceStartSec` é `int` e recebe o offset do produto na gravação — um número
 * que vem SOMANDO durações de fatia medidas pelo ffmpeg, ou seja, fracionárias
 * e acumuladas. Depois de quatro fatias o offset já é `2700.19`, e o `INSERT`
 * dos produtos morria com `invalid input syntax for type integer` no último
 * passo do processamento, com a live inteira já transcrita e cobrada.
 *
 * Nada aqui precisa de banco, de IA ou de arquivo: só dos dois repositórios que
 * `gravarBase` de fato toca.
 */
describe('LiveService.gravarBase', () => {
  function servicoQueCapturaProdutos() {
    const salvos: LiveProduct[] = [];

    const produtos = {
      delete: async () => undefined,
      create: (dados: Partial<LiveProduct>) => dados as LiveProduct,
      save: async (linhas: LiveProduct[]) => {
        salvos.push(...linhas);
        return linhas;
      },
    } as unknown as Repository<LiveProduct>;

    const faq = {
      delete: async () => undefined,
      create: (dados: unknown) => dados,
      save: async (linhas: unknown[]) => linhas,
    } as unknown as Repository<never>;

    const service = new LiveService(
      undefined as never, // sessoes
      produtos,
      faq as never,
      undefined as never, // chunker
      undefined as never, // transcricao
      undefined as never, // ai
      undefined as never, // billing
      { invalidarBasesDaSessao: () => undefined } as never, // replies
    );

    return { service, salvos };
  }

  function produtoDaIa(inicioSec: number | null) {
    return {
      nome: 'Blusa de tricô',
      precoBrl: 89.9,
      variantes: [],
      frete: null,
      promo: null,
      aliases: [],
      confianca: 0.9,
      inicioSec,
    };
  }

  it('grava sourceStartSec inteiro a partir de um offset fracionário', async () => {
    const { service, salvos } = servicoQueCapturaProdutos();

    await (
      service as unknown as {
        gravarBase: (
          u: string,
          s: string,
          p: unknown[],
          f: unknown[],
        ) => Promise<void>;
      }
    ).gravarBase('user-1', 'sessao-1', [produtoDaIa(2700.19)], []);

    expect(salvos[0].sourceStartSec).toBe(2700);
    expect(Number.isInteger(salvos[0].sourceStartSec)).toBe(true);
  });

  it('usa o piso, para a marca cair antes da menção e não depois', async () => {
    const { service, salvos } = servicoQueCapturaProdutos();

    await (
      service as unknown as {
        gravarBase: (
          u: string,
          s: string,
          p: unknown[],
          f: unknown[],
        ) => Promise<void>;
      }
    ).gravarBase('user-1', 'sessao-1', [produtoDaIa(879.99)], []);

    expect(salvos[0].sourceStartSec).toBe(879);
  });

  it('mantém null quando a IA não soube dizer o momento', async () => {
    const { service, salvos } = servicoQueCapturaProdutos();

    await (
      service as unknown as {
        gravarBase: (
          u: string,
          s: string,
          p: unknown[],
          f: unknown[],
        ) => Promise<void>;
      }
    ).gravarBase('user-1', 'sessao-1', [produtoDaIa(null)], []);

    expect(salvos[0].sourceStartSec).toBeNull();
  });
});
