import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSenderExternalIdToPatrolImages1710000007000 implements MigrationInterface {
  name = 'AddSenderExternalIdToPatrolImages1710000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "patrol_images"
      ADD COLUMN IF NOT EXISTS "senderExternalId" character varying(120)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "patrol_images"
      DROP COLUMN IF EXISTS "senderExternalId"
    `);
  }
}
