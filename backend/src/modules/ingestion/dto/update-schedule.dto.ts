import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateScheduleDto {
  @ApiPropertyOptional({ description: 'Expressão cron de 6 campos (ex.: "0 0 6 * * *")' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  cronExpr?: string;

  @ApiPropertyOptional({ description: 'Liga/desliga o agendamento automático' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
