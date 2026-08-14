import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateTrendDto } from './dto/create-trend.dto';
import { Trend } from './entities/trend.entity';

@Injectable()
export class TrendsService {
  constructor(
    @InjectRepository(Trend)
    private readonly repository: Repository<Trend>,
  ) {}

  create(dto: CreateTrendDto): Promise<Trend> {
    return this.repository.save(this.repository.create(dto));
  }

  findAll(): Promise<Trend[]> {
    return this.repository.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Trend> {
    const trend = await this.repository.findOneBy({ id });
    if (!trend) {
      throw new NotFoundException(`Trend ${id} não encontrada`);
    }
    return trend;
  }
}
