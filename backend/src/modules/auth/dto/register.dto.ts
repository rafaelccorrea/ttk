import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'voce@email.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'minha-senha-123', minLength: 10 })
  @IsString()
  // 6 caracteres cai em ataque de dicionário offline; 10 é o mínimo que ainda
  // é fácil de digitar. O teto evita o DoS do bcrypt com senha gigante.
  @MinLength(10)
  @MaxLength(128)
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'voce@email.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'minha-senha-123' })
  @IsString()
  @MaxLength(128)
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

  @ApiProperty({ example: 'minha-nova-senha-123', minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;
}
