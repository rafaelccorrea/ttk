import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * TLS da conexão com o Postgres.
 *
 * `{ rejectUnauthorized: false }` — o que estava aqui, fixo — cifra o tráfego e
 * não verifica com QUEM se está falando. É metade do TLS: protege contra quem
 * só escuta e não protege contra quem se põe no meio. E o que passa nesta
 * conexão é o banco inteiro: hashes de senha, e-mails, créditos, tokens de
 * redefinição. Quem consegue se pôr no caminho (um DNS envenenado, uma rota
 * BGP, uma rede hostil entre a hospedagem e o Supabase) lê e reescreve tudo,
 * sem que nada do lado do app perceba.
 *
 * Verificar de verdade depende de qual autoridade assinou o certificado do seu
 * provedor, e é por isso que isto é configuração e não uma linha fixa:
 *
 *   DB_SSL_CA=<PEM ou caminho do arquivo>
 *       Verifica contra essa autoridade. É o caminho do Supabase, que assina
 *       com uma CA própria: baixe em Settings > Database > SSL Configuration
 *       e aponte esta variável para o arquivo.
 *
 *   DB_SSL_MODE=verify
 *       Verifica contra as autoridades públicas que o Node já confia. Serve
 *       para provedores que usam certificado de CA pública.
 *
 *   DB_SSL_MODE=no-verify (padrão)
 *       Cifra sem verificar — o comportamento antigo. Continua sendo o padrão
 *       porque ligar a verificação sem a CA certa não degrada nada: derruba a
 *       conexão, e com ela a API inteira. O boot avisa em produção.
 */
function opcoesDeTls(
  config: ConfigService,
  isProduction: boolean,
): { rejectUnauthorized: boolean; ca?: string } {
  const ca = config.get<string>('DB_SSL_CA')?.trim();
  if (ca) {
    // Aceita o PEM colado na variável (é o que cabe num painel de hospedagem)
    // ou o caminho de um arquivo.
    const conteudo = ca.includes('BEGIN CERTIFICATE')
      ? ca.replace(/\\n/g, '\n')
      : readFileSync(ca, 'utf8');
    return { rejectUnauthorized: true, ca: conteudo };
  }
  if (config.get('DB_SSL_MODE') === 'verify') {
    return { rejectUnauthorized: true };
  }
  if (isProduction) {
    // eslint-disable-next-line no-console
    console.warn(
      '[segurança] A conexão com o banco está cifrada mas NÃO verifica o ' +
        'certificado do servidor (DB_SSL_MODE=no-verify). Isso deixa a ' +
        'conexão aberta a um ataque de intermediário. Configure DB_SSL_CA com ' +
        'a CA do provedor (Supabase: Settings > Database > SSL Configuration) ' +
        'ou DB_SSL_MODE=verify se ele usar uma CA pública.',
    );
  }
  return { rejectUnauthorized: false };
}

export const typeOrmConfig = (
  config: ConfigService,
): TypeOrmModuleOptions => {
  const url = config.get<string>('DATABASE_URL');
  const isProduction = config.get('NODE_ENV') === 'production';

  /**
   * O banco está na própria máquina?
   *
   * É o que decide se o `synchronize` pode ligar. `NODE_ENV=development`
   * sozinho não serve de garantia: a máquina do desenvolvedor costuma ter o
   * `DATABASE_URL` de produção no `.env` para enxergar o catálogo real, e
   * nessa combinação um `start:dev` reescrevia o schema de produção sem
   * avisar — apagando e recriando índices a cada mudança de entidade.
   */
  const bancoLocal = url
    ? isLocalHost(hostDaUrl(url))
    : isLocalHost(config.get('DB_HOST', 'localhost'));

  const common = {
    autoLoadEntities: true,
    /*
     * Pool. O banco é remoto (~160 ms por ida), então cada requisição segura a
     * conexão por mais tempo do que num Postgres local — com o padrão de 10 do
     * node-pg, uma tela que dispara 8 chamadas em paralelo já enfileira as
     * demais. Teto de 30 s por statement evita uma query travada prender a
     * conexão para sempre.
     */
    extra: {
      max: Number(config.get('DB_POOL_MAX') ?? 20),
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
      keepAlive: true,
    },
    synchronize:
      !isProduction && config.get('NODE_ENV') === 'development' && bancoLocal,
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
    // Em produção o schema não é sincronizado, e o host não tem etapa de
    // release para rodar `migration:run` — então aplicamos as migrations
    // pendentes ao conectar.
    migrationsRun: isProduction,
  };

  if (url) {
    // Supabase (ou qualquer Postgres remoto) — exige TLS.
    return {
      type: 'postgres',
      url,
      ssl: opcoesDeTls(config, isProduction),
      ...common,
    };
  }

  // Parâmetros separados. Preferido quando a senha tem caracteres que
  // precisariam de escape na URL (o '@' de picpok@2026 vira %40, e esse '%'
  // não sobrevive a toda cadeia de env do host) — aqui a senha vai crua.
  const host = config.get('DB_HOST', 'localhost');
  return {
    type: 'postgres',
    host,
    port: config.get<number>('DB_PORT', 5432),
    username: config.get('DB_USERNAME', 'postgres'),
    password: config.get('DB_PASSWORD', 'postgres'),
    database: config.get('DB_DATABASE', 'pikpok'),
    // Postgres local (docker) não fala TLS; qualquer host remoto exige.
    ssl: isLocalHost(host) ? undefined : opcoesDeTls(config, isProduction),
    ...common,
  };
};

const isLocalHost = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1';

/**
 * Host da connection string. URL malformada devolve string vazia — que não é
 * local, então o `synchronize` fica desligado. Na dúvida, não mexer no banco.
 */
const hostDaUrl = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
