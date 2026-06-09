import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersAuth1710000001000 implements MigrationInterface {
  name = 'AddUsersAuth1710000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('ADMIN', 'COMPANY_ADMIN', 'GUARD')`);
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(160) NOT NULL,
        "passwordHash" character varying(255) NOT NULL,
        "firstName" character varying(80) NOT NULL,
        "lastName" character varying(80) NOT NULL,
        "role" "public"."users_role_enum" NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "approved" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "users"');
    await queryRunner.query('DROP TYPE "public"."users_role_enum"');
  }
}
