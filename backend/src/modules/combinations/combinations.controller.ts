import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth-user';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CombinationsService } from './combinations.service';
import { CreatePlanDto } from './dto/create-plan.dto';

@ApiTags('combinations')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('combinations')
export class CombinationsController {
  constructor(private readonly combinationsService: CombinationsService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um plano de combinações Gancho × Corpo × CTA' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    return this.combinationsService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Planos de combinações do usuário' })
  list(@CurrentUser() user: AuthUser) {
    return this.combinationsService.list(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um plano com a matriz expandida' })
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.findOne(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um plano do usuário' })
  delete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.combinationsService.delete(user.id, id);
  }
}
