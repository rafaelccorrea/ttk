import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class IniciarDeviceFlowDto {
  @ApiPropertyOptional({ example: 'PikPok Desktop — PC da loja' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

export class AprovarDeviceFlowDto {
  @ApiProperty({ example: 'PIKPOK-K7QM' })
  @IsString()
  @Length(6, 20)
  userCode: string;
}

export class TrocarDeviceCodeDto {
  @ApiProperty({ description: 'Segredo entregue ao app no /device/start' })
  @IsString()
  @Length(16, 200)
  deviceCode: string;
}
