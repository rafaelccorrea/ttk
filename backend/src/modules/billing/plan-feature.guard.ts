import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanFeature } from './billing.config';
import { BillingService } from './billing.service';

export const PLAN_FEATURE_KEY = 'planFeature';

/** Marca um controller/rota como exclusivo de um recurso de plano. */
export const RequiresPlanFeature = (feature: PlanFeature) =>
  SetMetadata(PLAN_FEATURE_KEY, feature);

/**
 * Use SEMPRE depois do SupabaseAuthGuard:
 * @UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
 * @RequiresPlanFeature('stores')
 */
@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<PlanFeature | undefined>(
      PLAN_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) return true;
    const request = context.switchToHttp().getRequest();
    if (!request.user?.id) return true; // o auth guard já barrou antes
    await this.billing.assertFeature(request.user.id, feature);
    return true;
  }
}
