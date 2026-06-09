import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuardHourlyReporting1710000004000 implements MigrationInterface {
  name = 'AddGuardHourlyReporting1710000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "guard_sender_mappings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "guardId" uuid NOT NULL,
        "senderNumber" character varying(30) NOT NULL,
        "senderDisplayName" character varying(120),
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guard_sender_mappings_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "shift_guard_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "groupId" uuid,
        "guardId" uuid NOT NULL,
        "shiftDate" date NOT NULL,
        "startHour" integer NOT NULL,
        "endHour" integer NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shift_guard_assignments_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "guard_sender_mappings" ADD CONSTRAINT "FK_guard_sender_mappings_guard" FOREIGN KEY ("guardId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "shift_guard_assignments" ADD CONSTRAINT "FK_shift_guard_assignments_site" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "shift_guard_assignments" ADD CONSTRAINT "FK_shift_guard_assignments_group" FOREIGN KEY ("groupId") REFERENCES "patrol_groups"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "shift_guard_assignments" ADD CONSTRAINT "FK_shift_guard_assignments_guard" FOREIGN KEY ("guardId") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shift_guard_assignments" DROP CONSTRAINT "FK_shift_guard_assignments_guard"`);
    await queryRunner.query(`ALTER TABLE "shift_guard_assignments" DROP CONSTRAINT "FK_shift_guard_assignments_group"`);
    await queryRunner.query(`ALTER TABLE "shift_guard_assignments" DROP CONSTRAINT "FK_shift_guard_assignments_site"`);
    await queryRunner.query(`ALTER TABLE "guard_sender_mappings" DROP CONSTRAINT "FK_guard_sender_mappings_guard"`);
    await queryRunner.query(`DROP TABLE "shift_guard_assignments"`);
    await queryRunner.query(`DROP TABLE "guard_sender_mappings"`);
  }
}
