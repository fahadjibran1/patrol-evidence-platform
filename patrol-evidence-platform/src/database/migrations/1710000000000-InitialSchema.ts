import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1710000000000 implements MigrationInterface {
  name = 'InitialSchema1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(`CREATE TYPE \"public\".\"patrol_images_collectortype_enum\" AS ENUM('WHATSAPP', 'GUARD_APP', 'MANUAL')`);
    await queryRunner.query(`CREATE TYPE \"public\".\"patrol_images_status_enum\" AS ENUM('PENDING', 'RECEIVED_ON_TIME', 'RECEIVED_LATE', 'MISSING', 'DUPLICATE', 'INVALID_IMAGE')`);
    await queryRunner.query(`CREATE TYPE \"public\".\"patrol_slots_status_enum\" AS ENUM('PENDING', 'RECEIVED_ON_TIME', 'RECEIVED_LATE', 'MISSING', 'DUPLICATE', 'INVALID_IMAGE')`);

    await queryRunner.query(`
      CREATE TABLE \"sites\" (
        \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(),
        \"siteCode\" character varying(20) NOT NULL,
        \"siteName\" character varying(120) NOT NULL,
        \"clientName\" character varying(120),
        \"active\" boolean NOT NULL DEFAULT true,
        \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(),
        \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT \"PK_sites_id\" PRIMARY KEY (\"id\"),
        CONSTRAINT \"UQ_sites_siteCode\" UNIQUE (\"siteCode\")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE \"patrol_groups\" (
        \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(),
        \"siteId\" uuid NOT NULL,
        \"groupName\" character varying(150) NOT NULL,
        \"externalGroupId\" character varying(120),
        \"active\" boolean NOT NULL DEFAULT true,
        \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(),
        \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT \"PK_patrol_groups_id\" PRIMARY KEY (\"id\")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE \"patrol_schedules\" (
        \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(),
        \"siteId\" uuid NOT NULL,
        \"frequencyMinutes\" integer NOT NULL,
        \"startHour\" integer NOT NULL,
        \"endHour\" integer NOT NULL,
        \"graceMinutes\" integer NOT NULL DEFAULT 15,
        \"activeDays\" jsonb NOT NULL,
        \"active\" boolean NOT NULL DEFAULT true,
        \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(),
        \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT \"PK_patrol_schedules_id\" PRIMARY KEY (\"id\")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE \"patrol_images\" (
        \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(),
        \"siteId\" uuid NOT NULL,
        \"groupId\" uuid,
        \"collectorType\" \"public\".\"patrol_images_collectortype_enum\" NOT NULL,
        \"senderName\" character varying(120),
        \"senderNumber\" character varying(30),
        \"messageExternalId\" character varying(120),
        \"sentAt\" TIMESTAMP WITH TIME ZONE NOT NULL,
        \"receivedAt\" TIMESTAMP WITH TIME ZONE NOT NULL,
        \"patrolDate\" date NOT NULL,
        \"patrolHour\" integer NOT NULL,
        \"originalFileName\" character varying(255),
        \"storedFileName\" character varying(255) NOT NULL,
        \"filePath\" character varying(600) NOT NULL,
        \"fileSize\" bigint NOT NULL,
        \"mimeType\" character varying(100) NOT NULL,
        \"status\" \"public\".\"patrol_images_status_enum\" NOT NULL,
        \"notes\" text,
        \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(),
        \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT \"PK_patrol_images_id\" PRIMARY KEY (\"id\")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE \"patrol_slots\" (
        \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(),
        \"siteId\" uuid NOT NULL,
        \"slotStart\" TIMESTAMP WITH TIME ZONE NOT NULL,
        \"slotEnd\" TIMESTAMP WITH TIME ZONE NOT NULL,
        \"expectedAt\" TIMESTAMP WITH TIME ZONE NOT NULL,
        \"status\" \"public\".\"patrol_slots_status_enum\" NOT NULL DEFAULT 'PENDING',
        \"imageId\" uuid,
        \"resolvedAt\" TIMESTAMP WITH TIME ZONE,
        \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(),
        \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT \"PK_patrol_slots_id\" PRIMARY KEY (\"id\")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE \"patrol_alerts\" (
        \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(),
        \"siteId\" uuid NOT NULL,
        \"slotId\" uuid NOT NULL,
        \"alertType\" character varying(60) NOT NULL,
        \"alertMessage\" character varying(255) NOT NULL,
        \"alertTime\" TIMESTAMP WITH TIME ZONE NOT NULL,
        \"isResolved\" boolean NOT NULL DEFAULT false,
        \"resolvedAt\" TIMESTAMP WITH TIME ZONE,
        \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(),
        \"updatedAt\" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT \"PK_patrol_alerts_id\" PRIMARY KEY (\"id\")
      )
    `);

    await queryRunner.query(`ALTER TABLE \"patrol_groups\" ADD CONSTRAINT \"FK_patrol_groups_site\" FOREIGN KEY (\"siteId\") REFERENCES \"sites\"(\"id\") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE \"patrol_schedules\" ADD CONSTRAINT \"FK_patrol_schedules_site\" FOREIGN KEY (\"siteId\") REFERENCES \"sites\"(\"id\") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE \"patrol_images\" ADD CONSTRAINT \"FK_patrol_images_site\" FOREIGN KEY (\"siteId\") REFERENCES \"sites\"(\"id\") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE \"patrol_images\" ADD CONSTRAINT \"FK_patrol_images_group\" FOREIGN KEY (\"groupId\") REFERENCES \"patrol_groups\"(\"id\") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE \"patrol_slots\" ADD CONSTRAINT \"FK_patrol_slots_site\" FOREIGN KEY (\"siteId\") REFERENCES \"sites\"(\"id\") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE \"patrol_slots\" ADD CONSTRAINT \"FK_patrol_slots_image\" FOREIGN KEY (\"imageId\") REFERENCES \"patrol_images\"(\"id\") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE \"patrol_alerts\" ADD CONSTRAINT \"FK_patrol_alerts_site\" FOREIGN KEY (\"siteId\") REFERENCES \"sites\"(\"id\") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE \"patrol_alerts\" ADD CONSTRAINT \"FK_patrol_alerts_slot\" FOREIGN KEY (\"slotId\") REFERENCES \"patrol_slots\"(\"id\") ON DELETE CASCADE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "patrol_alerts" DROP CONSTRAINT "FK_patrol_alerts_slot"');
    await queryRunner.query('ALTER TABLE "patrol_alerts" DROP CONSTRAINT "FK_patrol_alerts_site"');
    await queryRunner.query('ALTER TABLE "patrol_slots" DROP CONSTRAINT "FK_patrol_slots_image"');
    await queryRunner.query('ALTER TABLE "patrol_slots" DROP CONSTRAINT "FK_patrol_slots_site"');
    await queryRunner.query('ALTER TABLE "patrol_images" DROP CONSTRAINT "FK_patrol_images_group"');
    await queryRunner.query('ALTER TABLE "patrol_images" DROP CONSTRAINT "FK_patrol_images_site"');
    await queryRunner.query('ALTER TABLE "patrol_schedules" DROP CONSTRAINT "FK_patrol_schedules_site"');
    await queryRunner.query('ALTER TABLE "patrol_groups" DROP CONSTRAINT "FK_patrol_groups_site"');

    await queryRunner.query('DROP TABLE "patrol_alerts"');
    await queryRunner.query('DROP TABLE "patrol_slots"');
    await queryRunner.query('DROP TABLE "patrol_images"');
    await queryRunner.query('DROP TABLE "patrol_schedules"');
    await queryRunner.query('DROP TABLE "patrol_groups"');
    await queryRunner.query('DROP TABLE "sites"');

    await queryRunner.query('DROP TYPE "public"."patrol_slots_status_enum"');
    await queryRunner.query('DROP TYPE "public"."patrol_images_status_enum"');
    await queryRunner.query('DROP TYPE "public"."patrol_images_collectortype_enum"');
  }
}
