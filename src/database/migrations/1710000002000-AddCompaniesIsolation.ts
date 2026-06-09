import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompaniesIsolation1710000002000 implements MigrationInterface {
  name = 'AddCompaniesIsolation1710000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "companyName" character varying(160) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_companies_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_companies_companyName" UNIQUE ("companyName")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "companies" ("companyName", "active")
      VALUES ('Legacy Company', true)
    `);

    await queryRunner.query(`ALTER TABLE "sites" ADD "companyId" uuid`);
    await queryRunner.query(`
      UPDATE "sites"
      SET "companyId" = (SELECT "id" FROM "companies" WHERE "companyName" = 'Legacy Company' LIMIT 1)
    `);
    await queryRunner.query(`ALTER TABLE "sites" ALTER COLUMN "companyId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "sites" ADD CONSTRAINT "FK_sites_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE`);

    await queryRunner.query(`ALTER TABLE "users" ADD "companyId" uuid`);
    await queryRunner.query(`
      UPDATE "users"
      SET "companyId" = (SELECT "id" FROM "companies" WHERE "companyName" = 'Legacy Company' LIMIT 1)
      WHERE "role" <> 'ADMIN'
    `);
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_users_company" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_company"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "companyId"`);
    await queryRunner.query(`ALTER TABLE "sites" DROP CONSTRAINT "FK_sites_company"`);
    await queryRunner.query(`ALTER TABLE "sites" DROP COLUMN "companyId"`);
    await queryRunner.query(`DROP TABLE "companies"`);
  }
}
