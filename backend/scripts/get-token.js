// Dev only: imprime o token de confirmação pendente de um e-mail.
require('dotenv/config');
const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const { rows } = await client.query(
    'SELECT "confirmationToken" FROM app_users WHERE email = $1',
    [process.argv[2]],
  );
  console.log(rows[0]?.confirmationToken ?? 'NAO_ENCONTRADO');
  await client.end();
})();
