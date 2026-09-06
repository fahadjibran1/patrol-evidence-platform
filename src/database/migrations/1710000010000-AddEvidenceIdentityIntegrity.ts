import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEvidenceIdentityIntegrity1710000010000 implements MigrationInterface {
  name = 'AddEvidenceIdentityIntegrity1710000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patrol_images" ADD COLUMN IF NOT EXISTS "linkedAccountId" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "patrol_images" ADD COLUMN IF NOT EXISTS "contentSha256" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "patrol_images" ADD COLUMN IF NOT EXISTS "integrityStatus" character varying(32) NOT NULL DEFAULT 'FINALIZED'`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_patrol_images_whatsapp_identity"
      ON "patrol_images" ("linkedAccountId", "messageExternalId")
      WHERE "collectorType" = 'WHATSAPP'
        AND "linkedAccountId" IS NOT NULL
        AND "messageExternalId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_patrol_images_whatsapp_identity"`);
    await queryRunner.query(`ALTER TABLE "patrol_images" DROP COLUMN IF EXISTS "integrityStatus"`);
    await queryRunner.query(`ALTER TABLE "patrol_images" DROP COLUMN IF EXISTS "contentSha256"`);
    await queryRunner.query(`ALTER TABLE "patrol_images" DROP COLUMN IF EXISTS "linkedAccountId"`);
  }
}
