import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const typeOrmConfig = (
  config: ConfigService,
): TypeOrmModuleOptions => {
  const url = config.get<string>('DATABASE_URL');
  const common = {
    autoLoadEntities: true,
    synchronize: config.get('NODE_ENV') === 'development',
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
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

  return {
    type: 'postgres',
    host: config.get('DB_HOST', 'localhost'),
    port: config.get<number>('DB_PORT', 5432),
    username: config.get('DB_USERNAME', 'postgres'),
    password: config.get('DB_PASSWORD', 'postgres'),
    database: config.get('DB_DATABASE', 'pikpok'),
    ...common,
  };
};
