import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O vídeo com IA de cortesia por conta (`SAMPLE_VIDEOS_PER_ACCOUNT`): a ação
 * `video` passa uma vez sem débito e sem exigir o Pro. A coluna é a trava de
 * "uma vez por conta" — nula enquanto a cortesia não foi gasta. Ver `charge`
 * e `restoreSampleVideo` em `billing.service.ts`.
 */
export class AddSampleVideo1786670600000 implements MigrationInterface {
  name = 'AddSampleVideo1786670600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "sampleVideoUsedAt" timestamptz NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "app_users" DROP COLUMN IF EXISTS "sampleVideoUsedAt"`,
    );
  }
}
