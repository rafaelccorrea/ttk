import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Segredos sem os quais a aplicação é insegura por definição. Faltando algum,
 * o processo morre no boot: subir com fallback ("change-me") assinaria tokens
 * com um segredo que qualquer pessoa que leu este repositório conhece.
 */
function assertSecrets() {
  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new Error(
      'JWT_SECRET ausente ou fraco (mínimo 32 caracteres). Gere com: openssl rand -hex 32',
    );
  }
  if (isProduction && process.env.ALLOW_DEV_LOGIN === 'true') {
    throw new Error(
      'ALLOW_DEV_LOGIN=true em produção: essa rota emite token para qualquer e-mail, sem senha.',
    );
  }
  if (isProduction && process.env.ALLOW_DEV_CHECKOUT === 'true') {
    throw new Error(
      'ALLOW_DEV_CHECKOUT=true em produção: liberaria plano/créditos sem pagamento.',
    );
  }
}

async function bootstrap() {
  assertSecrets();

  // rawBody: necessário para verificar a assinatura do webhook do Stripe.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Cabeçalhos de segurança. crossOriginResourcePolicy relaxado porque o
  // proxy de mídia (/media/*) é consumido em <img> a partir do domínio do
  // frontend, que é diferente do domínio da API.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );

  app.setGlobalPrefix('api/v1');

  // O frontend roda em outro domínio, então a origem precisa ser liberada
  // explicitamente. Em produção só APP_URL vale: manter localhost na lista
  // permitiria que uma página local do atacante falasse com a API do usuário.
  const appUrl = process.env.APP_URL?.replace(/\/$/, '');
  if (isProduction && !appUrl) {
    throw new Error('APP_URL é obrigatório em produção (origem do CORS).');
  }
  const origins = isProduction
    ? [appUrl as string]
    : [appUrl, 'http://localhost:5173', 'http://localhost:4173'].filter(
        (o): o is string => Boolean(o),
      );
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Descarta qualquer campo não declarado no DTO (anti mass-assignment).
      whitelist: true,
      transform: true,
    }),
  );

  // Swagger descreve toda a superfície de ataque (rotas, DTOs, exemplos).
  // Em produção fica fora do ar, salvo opt-in explícito.
  if (!isProduction || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('PikPok API')
      .setDescription('API de insights e tendências para lojas no TikTok')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
