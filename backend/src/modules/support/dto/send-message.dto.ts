import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ description: 'Texto da mensagem para o suporte' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;
}
