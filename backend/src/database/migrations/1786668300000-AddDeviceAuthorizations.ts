import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Device code flow — como o app desktop do Live Copilot se autentica.
 *
 * O app roda na máquina do vendedor e não tem onde receber uma senha com
 * segurança: pedir e-mail e senha dentro de um executável significa a senha da
 * conta passar por um processo que não controlamos e, pior, acostumar o
 * usuário a digitá-la em qualquer janela que se pareça com a nossa. O fluxo
 * aqui inverte isso — o app só mostra um código curto, e quem autoriza é o
 * navegador, onde a sessão já existe e o domínio é verificável.
 *
 * Dois segredos com públicos distintos convivem na mesma linha: `deviceCode`
 * (longo, só o app conhece, é o que vira token) e `userCode` (curto, lido por
 * um humano, só autoriza). Sem FK para `app_users`: uma autorização é um
 * registro de auditoria de um pareamento que aconteceu, e apagar uma conta não
 * pode falhar por causa disso.
 */
export class AddDeviceAuthorizations1786668300000 implements MigrationInterface {
  name = 'AddDeviceAuthorizations1786668300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "device_authorizations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "deviceCode" character varying NOT NULL,
        "userCode" character varying NOT NULL,
        "userId" uuid,
        "status" character varying NOT NULL DEFAULT 'pendente',
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "approvedAt" TIMESTAMP WITH TIME ZONE,
        "tokenIssuedAt" TIMESTAMP WITH TIME ZONE,
        "deviceName" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_device_authorizations" PRIMARY KEY ("id")
      )
    `);

    /*
     * Os dois índices são UNIQUE porque a unicidade aqui é regra de segurança,
     * não desempenho: dois dispositivos com o mesmo `userCode` fariam a pessoa
     * aprovar um pareamento e liberar outro, sem jeito de perceber. O UNIQUE do
     * banco é o que garante isso mesmo com requisições simultâneas — a geração
     * do código é aleatória e, com 4 caracteres, colide de vez em quando.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_device_authorizations_deviceCode" ON "device_authorizations" ("deviceCode")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_device_authorizations_userCode" ON "device_authorizations" ("userCode")`,
    );

    await queryRunner.query(
      `ALTER TABLE "device_authorizations" ENABLE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_device_authorizations_userCode"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_device_authorizations_deviceCode"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "device_authorizations"`);
  }
}
