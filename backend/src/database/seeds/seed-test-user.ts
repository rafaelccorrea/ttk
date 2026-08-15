import 'dotenv/config';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppUser } from '../../modules/users/entities/app-user.entity';

// Conta de teste pré-confirmada — entra direto, sem confirmação de e-mail.
// Credenciais e plano vêm do .env (TEST_USER_*), com defaults seguros p/ dev.
const TEST_EMAIL = process.env.TEST_USER_EMAIL ?? 'teste@pikpok.app';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? 'teste123';
const TEST_PLAN = process.env.TEST_USER_PLAN ?? 'business';
const TEST_CREDITS = Number(process.env.TEST_USER_CREDITS ?? 10000);

async function run() {
  const url = process.env.DATABASE_URL;
  const dataSource = new DataSource(
    url
      ? {
          type: 'postgres',
          url,
          ssl: { rejectUnauthorized: false },
          entities: [AppUser],
          synchronize: true,
        }
      : {
          type: 'postgres',
          host: process.env.DB_HOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? 5432),
          username: process.env.DB_USERNAME ?? 'postgres',
          password: process.env.DB_PASSWORD ?? 'postgres',
          database: process.env.DB_DATABASE ?? 'pikpok',
          entities: [AppUser],
          synchronize: true,
        },
  );
  await dataSource.initialize();
  const users = dataSource.getRepository(AppUser);

  let user = await users.findOneBy({ email: TEST_EMAIL });
  if (!user) {
    user = users.create({ id: randomUUID(), email: TEST_EMAIL });
  }
  user.displayName = 'Conta de Teste';
  user.passwordHash = await hash(TEST_PASSWORD, 10);
  user.emailConfirmedAt = new Date();
  user.confirmationToken = null as unknown as string;
  // Tudo liberado: plano máximo + créditos de sobra para testar as IAs.
  user.plan = TEST_PLAN;
  user.credits = TEST_CREDITS;
  await users.save(user);

  console.log(
    `Conta de teste pronta: ${TEST_EMAIL} / ${TEST_PASSWORD} (plano ${TEST_PLAN}, ${TEST_CREDITS} créditos)`,
  );
  await dataSource.destroy();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
