import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const typeOrmConfig = (
  config: ConfigService,
): TypeOrmModuleOptions => {
  const url = config.get<string>('DATABASE_URL');
  const isProduction = config.get('NODE_ENV') === 'production';
  const common = {
    autoLoadEntities: true,
    synchronize: !isProduction && config.get('NODE_ENV') === 'development',
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
      ssl: { rejectUnauthorized: false },
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
    ssl: isLocalHost(host) ? undefined : { rejectUnauthorized: false },
    ...common,
  };
};

const isLocalHost = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1';
