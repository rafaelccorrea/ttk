import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'voce@email.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'minha-senha-123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'voce@email.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'minha-senha-123' })
  @IsString()
  password: string;
}

export class ResendDto {
  @ApiProperty({ example: 'voce@email.com' })
  @IsEmail()
  email: string;
}
