import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O "já começa com X horas de live" dos planos (15h Essencial, 40h Pro, 60h
 * Business): bônus ÚNICO de adesão, creditado no `setPlan`. A coluna guarda o
 * MAIOR bônus já concedido à conta — renovação não repete, upgrade concede a
 * diferença. Ver `grantSignupLiveHours` em `billing.service.ts`.
 */
export class AddLiveSignupHours1786670500000 implements MigrationInterface {
  name = 'AddLiveSignupHours1786670500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "liveSignupMinutesGranted" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "liveSignupMinutesGranted"`,
    );
  }
}
