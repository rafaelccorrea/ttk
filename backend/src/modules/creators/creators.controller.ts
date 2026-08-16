import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import { CreatorsService } from './creators.service';
import { QueryCreatorsDto } from './dto/query-creators.dto';

@ApiTags('creators')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
@RequiresPlanFeature('discovery')
@Controller('creators')
export class CreatorsController {
  constructor(private readonly creatorsService: CreatorsService) {}

  @Get()
  @ApiOperation({ summary: 'Ranking de criadores por GMV ou seguidores' })
  list(@Query() query: QueryCreatorsDto) {
    return this.creatorsService.list(query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categorias disponíveis entre os criadores' })
  categories() {
    return this.creatorsService.categories();
  }
}
