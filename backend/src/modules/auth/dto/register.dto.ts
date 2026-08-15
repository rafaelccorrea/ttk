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

export class ForgotPasswordDto {
  @ApiProperty({ example: 'voce@email.com' })
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token recebido no link do e-mail' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'minha-nova-senha-123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;
}
