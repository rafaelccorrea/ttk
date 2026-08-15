import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CombinationPlan } from './entities/combination-plan.entity';

export interface Combination {
  code: string;
  filename: string;
  hook: string;
  body: string;
  cta: string;
}

@Injectable()
export class CombinationsService {
  constructor(
    @InjectRepository(CombinationPlan)
    private readonly plans: Repository<CombinationPlan>,
  ) {}

  // Expande a matriz completa Gancho × Corpo × CTA com nomenclatura padronizada.
  expand(plan: CombinationPlan): Combination[] {
    const now = new Date();
    const ddmm =
      String(now.getDate()).padStart(2, '0') +
      String(now.getMonth() + 1).padStart(2, '0');
    const result: Combination[] = [];
    plan.hooks.forEach((hook, g) => {
      plan.bodies.forEach((body, c) => {
        plan.ctas.forEach((cta, a) => {
          const code = `G${g + 1}C${c + 1}A${a + 1}`;
          result.push({
            code,
            filename: `${plan.sigla}_${code}_${ddmm}.mp4`,
            hook,
            body,
            cta,
          });
        });
      });
    });
    return result;
  }

  async create(userId: string, dto: CreatePlanDto) {
    const plan = await this.plans.save(
      this.plans.create({
        userId,
        sigla: dto.sigla.trim().toUpperCase(),
        format: dto.format,
        hooks: dto.hooks,
        bodies: dto.bodies,
        ctas: dto.ctas,
      }),
    );
    return { ...plan, combinations: this.expand(plan) };
  }

  async list(userId: string) {
    const plans = await this.plans.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return plans.map((plan) => ({
      ...plan,
      total: plan.hooks.length * plan.bodies.length * plan.ctas.length,
    }));
  }

  async findOne(userId: string, id: string) {
    const plan = await this.plans.findOneBy({ id, userId });
    if (!plan) {
      throw new NotFoundException(`Plano ${id} não encontrado`);
    }
    return { ...plan, combinations: this.expand(plan) };
  }

  async delete(userId: string, id: string): Promise<void> {
    const result = await this.plans.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(`Plano ${id} não encontrado`);
    }
  }
}
