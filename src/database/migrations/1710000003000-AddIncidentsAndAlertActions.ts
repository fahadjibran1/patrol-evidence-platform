import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIncidentsAndAlertActions1710000003000 implements MigrationInterface {
  name = 'AddIncidentsAndAlertActions1710000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."incidents_severity_enum" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')`);
    await queryRunner.query(`CREATE TYPE "public"."incidents_status_enum" AS ENUM('OPEN', 'IN_REVIEW', 'RESOLVED')`);
    await queryRunner.query(
      `CREATE TYPE "public"."patrol_alerts_alerttype_enum" AS ENUM('MISSING_PATROL', 'WELFARE', 'EMERGENCY')`,
    );

    await queryRunner.query(`
      CREATE TABLE "incidents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "guardId" uuid NOT NULL,
        "companyId" uuid NOT NULL,
        "siteId" uuid NOT NULL,
        "description" text NOT NULL,
        "severity" "public"."incidents_severity_enum" NOT NULL,
        "status" "public"."incidents_status_enum" NOT NULL DEFAULT 'OPEN',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_incidents_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`ALTER TABLE "patrol_alerts" ADD "guardId" uuid`);
    await queryRunner.query(`ALTER TABLE "patrol_alerts" ALTER COLUMN "slotId" DROP NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "patrol_alerts"
      ALTER COLUMN "alertType" TYPE "public"."patrol_alerts_alerttype_enum"
      USING "alertType"::"public"."patrol_alerts_alerttype_enum"
    `);

    await queryRunner.query(
      `ALTER TABLE "incidents" ADD CONSTRAINT "FK_incidents_guard" FOREIGN KEY ("guardId") REFERENCES "users"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD CONSTRAINT "FK_incidents_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "incidents" ADD CONSTRAINT "FK_incidents_site" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "patrol_alerts" ADD CONSTRAINT "FK_patrol_alerts_guard" FOREIGN KEY ("guardId") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patrol_alerts" DROP CONSTRAINT "FK_patrol_alerts_guard"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT "FK_incidents_site"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT "FK_incidents_company"`);
    await queryRunner.query(`ALTER TABLE "incidents" DROP CONSTRAINT "FK_incidents_guard"`);

    await queryRunner.query(`
      ALTER TABLE "patrol_alerts"
      ALTER COLUMN "alertType" TYPE character varying(60)
      USING "alertType"::text
    `);
    await queryRunner.query(`ALTER TABLE "patrol_alerts" ALTER COLUMN "slotId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "patrol_alerts" DROP COLUMN "guardId"`);

    await queryRunner.query(`DROP TABLE "incidents"`);
    await queryRunner.query(`DROP TYPE "public"."patrol_alerts_alerttype_enum"`);
    await queryRunner.query(`DROP TYPE "public"."incidents_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."incidents_severity_enum"`);
  }
}
