import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryCreatorsDto } from './dto/query-creators.dto';
import { Creator } from './entities/creator.entity';

export interface RankedCreator {
  id: string;
  handle: string;
  name: string;
  followers: number;
  gmvPeriod: number;
  salesPeriod: number;
  category: string;
  avatarUrl: string | null;
}

@Injectable()
export class CreatorsService {
  constructor(
    @InjectRepository(Creator)
    private readonly creators: Repository<Creator>,
  ) {}

  async list(
    query: QueryCreatorsDto,
  ): Promise<{ items: RankedCreator[]; total: number; page: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const qb = this.creators.createQueryBuilder('c');

    if (query.category) {
      qb.andWhere('c.category = :category', { category: query.category });
    }
    if (query.search) {
      qb.andWhere('(c.handle ILIKE :search OR c.name ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    if (query.source) {
      qb.andWhere('c.source = :source', { source: query.source });
    }
    if (query.minFollowers !== undefined) {
      qb.andWhere('c.followers >= :minFollowers', {
        minFollowers: query.minFollowers,
      });
    }
    if (query.maxFollowers !== undefined) {
      qb.andWhere('c.followers <= :maxFollowers', {
        maxFollowers: query.maxFollowers,
      });
    }

    // Criador real do TikTok vem antes do dado de demonstração: o usuário
    // reclamou que "criadores parece não ser real" justamente porque o seed
    // dominava o topo do ranking.
    qb.orderBy(`CASE WHEN c.source = 'tiktok' THEN 0 ELSE 1 END`, 'ASC');
    if (query.sort === 'followers') {
      qb.addOrderBy('c.followers', 'DESC');
    } else {
      qb.addOrderBy('c.gmvPeriod', 'DESC');
    }
    // Desempate por id para paginação estável.
    qb.addOrderBy('c.id', 'ASC');

    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const items = rows.map((c) => ({
      id: c.id,
      handle: c.handle,
      name: c.name,
      followers: c.followers,
      gmvPeriod: Number(c.gmvPeriod),
      salesPeriod: c.salesPeriod,
      category: c.category,
      avatarUrl: c.avatarUrl ?? null,
    }));

    return { items, total, page };
  }

  async categories(): Promise<string[]> {
    const rows = await this.creators
      .createQueryBuilder('c')
      .select('DISTINCT c.category', 'category')
      .orderBy('category', 'ASC')
      .getRawMany();
    return rows.map((r) => r.category);
  }
}
