// Cria o banco local "pikpok" se não existir (dev sem Docker).
require('dotenv/config');
const { Client } = require('pg');

(async () => {
  const client = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: 'postgres',
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'pikpok'",
    );
    if (result.rowCount === 0) {
      await client.query('CREATE DATABASE pikpok');
      console.log('Banco pikpok criado.');
    } else {
      console.log('Banco pikpok já existe.');
    }
    await client.end();
  } catch (error) {
    console.error('Falha:', error.message);
    process.exit(1);
  }
})();
