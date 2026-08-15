import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: necessário para verificar a assinatura do webhook do Stripe.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api/v1');
  // O frontend roda em outro domínio, então a origem precisa ser liberada
  // explicitamente. APP_URL é a de produção; o resto cobre o dev local.
  app.enableCors({
    origin: [
      process.env.APP_URL?.replace(/\/$/, ''),
      'http://localhost:5173',
      'http://localhost:4173',
    ].filter(Boolean) as string[],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const config = new DocumentBuilder()
    .setTitle('PikPok API')
    .setDescription('API de insights e tendências para lojas no TikTok')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
