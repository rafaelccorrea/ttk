import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';

// Usado apenas pela CLI do TypeORM (migrations).
// Espelha a resolução de conexão de `src/config/typeorm.config.ts`: quando há
// DATABASE_URL (Supabase ou qualquer Postgres remoto), ela vence e exige TLS.
const url = process.env.DATABASE_URL;

const common = {
  type: 'postgres' as const,
  entities: ['src/modules/**/entities/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
};

const host = process.env.DB_HOST ?? 'localhost';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

const options: DataSourceOptions = url
  ? { ...common, url, ssl: { rejectUnauthorized: false } }
  : {
      ...common,
      host,
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: process.env.DB_DATABASE ?? 'pikpok',
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    };

export default new DataSource(options);
