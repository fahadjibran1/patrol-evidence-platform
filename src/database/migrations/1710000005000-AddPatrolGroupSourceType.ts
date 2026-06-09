import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPatrolGroupSourceType1710000005000 implements MigrationInterface {
  name = 'AddPatrolGroupSourceType1710000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patrol_groups" ADD COLUMN "sourceType" character varying(20) NOT NULL DEFAULT 'group'`,
    );
    await queryRunner.query(
      `UPDATE "patrol_groups" SET "sourceType" = 'contact' WHERE "externalGroupId" LIKE '%@c.us'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patrol_groups" DROP COLUMN IF EXISTS "sourceType"`);
  }
}
