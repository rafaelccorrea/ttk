import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProductMetricDaily } from '../products/entities/product-metric-daily.entity';
import { Trend } from './entities/trend.entity';
import { TrendsService } from './trends.service';

describe('TrendsService', () => {
  let service: TrendsService;

  const repositoryMock = {
    create: jest.fn((dto) => dto),
    save: jest.fn((dto) => Promise.resolve({ id: 'uuid', ...dto })),
    find: jest.fn(() => Promise.resolve([])),
    findOneBy: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TrendsService,
        { provide: getRepositoryToken(Trend), useValue: repositoryMock },
        { provide: getRepositoryToken(ProductMetricDaily), useValue: {} },
      ],
    }).compile();

    service = module.get(TrendsService);
    jest.clearAllMocks();
  });

  it('cria uma tendência', async () => {
    const result = await service.create({ title: 'Air fryer' });
    expect(result).toMatchObject({ title: 'Air fryer' });
    expect(repositoryMock.save).toHaveBeenCalled();
  });

  it('lista tendências', async () => {
    await expect(service.findAll()).resolves.toEqual([]);
  });

  it('lança NotFound quando id não existe', async () => {
    repositoryMock.findOneBy.mockResolvedValue(null);
    await expect(service.findOne('nao-existe')).rejects.toThrow(
      NotFoundException,
    );
  });
});
