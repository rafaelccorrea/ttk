import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateTrendDto } from './dto/create-trend.dto';
import { TrendsService } from './trends.service';

@ApiTags('trends')
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

  @Get(':id')
  @ApiOperation({ summary: 'Busca tendência por id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.trendsService.findOne(id);
  }
}
