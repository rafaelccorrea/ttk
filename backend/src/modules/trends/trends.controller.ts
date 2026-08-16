import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  PlanFeatureGuard,
  RequiresPlanFeature,
} from '../billing/plan-feature.guard';
import { CreateTrendDto } from './dto/create-trend.dto';
import { TrendsService } from './trends.service';

// Era o único controller sem guard: POST /trends aceitava escrita anônima e
// os GETs entregavam dados do produto sem login.
@ApiTags('trends')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, PlanFeatureGuard)
@RequiresPlanFeature('discovery')
@Controller('trends')
export class TrendsController {
  constructor(private readonly trendsService: TrendsService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastra uma tendência' })
  create(@Body() dto: CreateTrendDto) {
    return this.trendsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista tendências' })
  findAll() {
    return this.trendsService.findAll();
  }

  @Get('overview')
  @ApiOperation({ summary: 'Tendências derivadas das métricas reais (7d vs 7d anteriores)' })
  overview() {
    return this.trendsService.overview();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca tendência por id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.trendsService.findOne(id);
  }
}
