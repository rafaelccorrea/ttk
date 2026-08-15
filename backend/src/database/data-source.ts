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

const options: DataSourceOptions = url
  ? { ...common, url, ssl: { rejectUnauthorized: false } }
  : {
      ...common,
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: process.env.DB_DATABASE ?? 'pikpok',
    };

export default new DataSource(options);
