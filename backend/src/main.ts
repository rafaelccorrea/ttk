import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
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

/**
 * Quantos saltos de proxy confiar para descobrir o IP do cliente.
 *
 * Isto não é afinação de performance: é o que decide se o rate limit existe.
 * O Express só usa o `X-Forwarded-For` quando `trust proxy` está ligado — sem
 * ele, `req.ip` é o IP do reverse proxy, e como TODA requisição chega por ele,
 * o app inteiro compartilha um único balde. Na prática o teto global de 120/min
 * vira um teto de 120/min para o mundo todo, e o limite de 10 tentativas de
 * login por 5 min tranca a porta de todos os clientes assim que um varredor
 * aparece: o rate limit deixa de proteger e passa a ser o ataque.
 *
 * O erro inverso é pior e é por isso que o padrão é NÃO confiar: `trust proxy`
 * ligado sem proxy na frente faz o Express aceitar o `X-Forwarded-For` que o
 * próprio cliente mandou. Aí qualquer um forja um IP diferente por requisição e
 * não existe mais limite nenhum — nem no login, nem no reset de senha.
 *
 * Por isso o valor é explícito e por ambiente, não adivinhado:
 *
 *   TRUST_PROXY=1              → um proxy na frente (o caso comum: Nginx, o
 *                                proxy da hospedagem). Confia no ÚLTIMO salto.
 *   TRUST_PROXY=2              → dois (ex.: Cloudflare + Nginx).
 *   TRUST_PROXY=loopback       → só 127.0.0.1/::1.
 *   TRUST_PROXY=10.0.0.0/8,... → lista de IPs/CIDR dos seus proxies.
 *   TRUST_PROXY=false / ausente→ não confia em cabeçalho nenhum (padrão).
 *
 * Contar saltos e não usar `true` é deliberado: `true` confia no cabeçalho
 * inteiro e pega o primeiro item da lista, que é justamente a parte que o
 * cliente controla.
 */
function configurarProxyConfiavel(app: {
  getHttpAdapter: () => { getInstance: () => { set: (k: string, v: unknown) => void } };
}): void {
  const bruto = (process.env.TRUST_PROXY ?? '').trim();
  const express = app.getHttpAdapter().getInstance();

  if (!bruto || bruto === 'false' || bruto === '0') {
    if (isProduction) {
      // Não derruba o boot: uma API que atende direto na porta 3000 está
      // correta assim. Mas se houver proxy, o operador precisa saber que os
      // limites estão contando o IP errado.
      // eslint-disable-next-line no-console
      console.warn(
        '[segurança] TRUST_PROXY não configurado: os limites de requisição vão ' +
          'contar o IP de quem conecta. Se a API está atrás de um proxy/CDN, ' +
          'defina TRUST_PROXY com o número de saltos (ex.: TRUST_PROXY=1).',
      );
    }
    express.set('trust proxy', false);
    return;
  }

  const saltos = Number(bruto);
  if (Number.isInteger(saltos) && saltos > 0) {
    express.set('trust proxy', saltos);
    return;
  }
  // Nomes ('loopback', 'uniquelocal') e listas de IP/CIDR o Express entende
  // direto. `true` fica de fora de propósito — ver o comentário acima.
  if (bruto === 'true') {
    throw new Error(
      'TRUST_PROXY=true confia no X-Forwarded-For inteiro, inclusive na parte ' +
        'que o cliente escreve — e isso desliga o rate limit. Use o número de ' +
        'saltos (TRUST_PROXY=1) ou a lista de IPs dos seus proxies.',
    );
  }
  express.set('trust proxy', bruto);
}

async function bootstrap() {
  assertSecrets();

  // rawBody: necessário para verificar a assinatura do webhook do Stripe.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Antes de qualquer coisa que leia `req.ip` (rate limit, auditoria).
  configurarProxyConfiavel(app);

  // Cabeçalhos de segurança. crossOriginResourcePolicy relaxado porque o
  // proxy de mídia (/media/*) é consumido em <img> a partir do domínio do
  // frontend, que é diferente do domínio da API.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );

  // Respostas JSON grandes (vitrine, campanhas, wallet) viajam gzip/brotli.
  // Mídia (/media/*) já é binário comprimido: o filtro padrão a deixa passar.
  app.use(compression({ threshold: 1024 }));

  app.setGlobalPrefix('api/v1');

  // O frontend roda em outro domínio, então a origem precisa ser liberada
  // explicitamente. Em produção só APP_URL vale: manter localhost na lista
  // permitiria que uma página local do atacante falasse com a API do usuário.
  const appUrl = process.env.APP_URL?.replace(/\/$/, '');
  if (isProduction && !appUrl) {
    throw new Error('APP_URL é obrigatório em produção (origem do CORS).');
  }
  // Origens extras aceitas no CORS, separadas por vírgula. Existe para a
  // troca de domínio: enquanto o novo propaga, o antigo precisa continuar
  // funcionando — sem isto, trocar APP_URL derruba o domínio em uso.
  // Só CORS: os links de e-mail e os redirects do Stripe seguem em APP_URL.
  const extraOrigins = (process.env.EXTRA_CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const origins = isProduction
    ? [appUrl as string, ...extraOrigins]
    : [
        appUrl,
        ...extraOrigins,
        'http://localhost:5173',
        'http://localhost:4173',
      ].filter((o): o is string => Boolean(o));
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
