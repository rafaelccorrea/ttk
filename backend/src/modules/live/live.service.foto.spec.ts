import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { MediaMirrorService } from '../media/media-mirror.service';
import { LiveProduct } from './entities/live-product.entity';
import { LiveService } from './live.service';

/**
 * A foto do produto da live, com os dois repositórios dublados.
 *
 * O que importa aqui é a fronteira: a foto é lida por `findOneBy({ id, userId })`
 * e não por `id` solto — a rota recebe o id do produto na URL, e sem o `userId`
 * no filtro qualquer conta poderia trocar a foto do catálogo de outra.
 */
describe('LiveService — foto do produto', () => {
  function servico(linhas: LiveProduct[]) {
    const salvos: LiveProduct[] = [];
    const produtos = {
      findOneBy: async (where: { id: string; userId: string }) =>
        linhas.find((p) => p.id === where.id && p.userId === where.userId) ?? null,
      save: async (p: LiveProduct) => {
        salvos.push(p);
        return p;
      },
    } as unknown as Repository<LiveProduct>;

    const mirror = {
      putImage: async () => '/api/v1/media/s3/live-products/p1-abc.webp',
    } as unknown as MediaMirrorService;

    const service = new LiveService(
      undefined as never, // sessoes
      produtos,
      undefined as never, // faq
      undefined as never, // chunker
      undefined as never, // transcricao
      undefined as never, // ai
      undefined as never, // billing
      { invalidarBasesDaSessao: () => undefined } as never, // replies
      mirror,
    );
    return { service, salvos };
  }

  const produto = {
    id: 'p1',
    userId: 'dona',
    name: 'Blusa',
    imageUrl: '/api/v1/media/s3/live-products/p1-velha.webp',
  } as LiveProduct;

  it('não aceita foto em produto de outro usuário', async () => {
    const { service, salvos } = servico([produto]);
    await expect(
      service.adicionarFoto('intrusa', 'p1', Buffer.from('img')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(salvos).toHaveLength(0);
  });

  it('grava a URL devolvida pelo espelho', async () => {
    const { service, salvos } = servico([{ ...produto }]);
    const salvo = await service.adicionarFoto('dona', 'p1', Buffer.from('img'));
    expect(salvo.imageUrl).toBe('/api/v1/media/s3/live-products/p1-abc.webp');
    expect(salvos).toHaveLength(1);
  });

  it('remover foto zera imageUrl', async () => {
    const { service, salvos } = servico([{ ...produto }]);
    const salvo = await service.removerFoto('dona', 'p1');
    expect(salvo.imageUrl).toBeNull();
    expect(salvos[0].imageUrl).toBeNull();
  });

  it('não remove foto de produto de outro usuário', async () => {
    const { service } = servico([{ ...produto }]);
    await expect(service.removerFoto('intrusa', 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
