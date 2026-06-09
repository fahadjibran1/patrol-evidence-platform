import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLinkedAccountIdToPatrolGroups1710000006000 implements MigrationInterface {
  name = 'AddLinkedAccountIdToPatrolGroups1710000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patrol_groups" ADD COLUMN "linkedAccountId" character varying(120)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_patrol_groups_linkedAccountId" ON "patrol_groups" ("linkedAccountId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_patrol_groups_active_linked_external" ON "patrol_groups" ("linkedAccountId", "externalGroupId") WHERE "active" = true AND "linkedAccountId" IS NOT NULL AND "externalGroupId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_patrol_groups_active_linked_external"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_patrol_groups_linkedAccountId"`);
    await queryRunner.query(`ALTER TABLE "patrol_groups" DROP COLUMN IF EXISTS "linkedAccountId"`);
  }
}
