import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  /*
   * Id de quem indicou, vindo do `?ref=` do link de indicação.
   *
   * Opcional e validado como UUID: o valor chega do navegador, então tem de
   * ser recusado como formato antes de virar consulta. Um ref inexistente não
   * derruba o cadastro — a conta é criada sem vínculo (ver AuthService).
   */
  @ApiProperty({ required: false, description: 'Id de quem indicou (?ref=)' })
  @IsOptional()
  @IsUUID()
  ref?: string;
}

export class GoogleLoginDto {
  /*
   * O `credential` que o Google Identity Services entrega no navegador: um
   * id_token JWT assinado pelo Google. O backend valida assinatura, `aud` e
   * `iss` — o conteúdo só vale depois disso.
   */
  @ApiProperty({ description: 'id_token (credential) do Google Identity Services' })
  @IsString()
  @MaxLength(4096)
  credential: string;

  @ApiProperty({ required: false, description: 'Id de quem indicou (?ref=)' })
  @IsOptional()
  @IsUUID()
  ref?: string;
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
