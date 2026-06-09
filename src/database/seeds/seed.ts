import 'dotenv/config';
import dataSource from '@/database/data-source';
import { Site } from '@/sites/entities/site.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { User } from '@/users/entities/user.entity';
import { UserRole } from '@/common/enums/user-role.enum';
import { hashPassword } from '@/auth/security/password.util';
import { Company } from '@/companies/entities/company.entity';
import { Incident } from '@/incidents/entities/incident.entity';
import { IncidentSeverity } from '@/common/enums/incident-severity.enum';
import { IncidentStatus } from '@/common/enums/incident-status.enum';

const SITE_CODES = [
  'OXF01',
  'NYC02',
  'DAL03',
  'SFO04',
  'SEA05',
  'MIA06',
  'ATL07',
  'PHX08',
  'CHI09',
  'DEN10',
];

async function seed(): Promise<void> {
  await dataSource.initialize();

  const companyRepo = dataSource.getRepository(Company);
  const siteRepo = dataSource.getRepository(Site);
  const groupRepo = dataSource.getRepository(PatrolGroup);
  const scheduleRepo = dataSource.getRepository(PatrolSchedule);
  const slotRepo = dataSource.getRepository(PatrolSlot);
  const userRepo = dataSource.getRepository(User);
  const incidentRepo = dataSource.getRepository(Incident);

  await dataSource.query(
    'TRUNCATE TABLE "incidents", "users", "patrol_alerts", "patrol_slots", "patrol_images", "patrol_schedules", "patrol_groups", "sites", "companies" RESTART IDENTITY CASCADE',
  );

  const [alphaCompany, betaCompany] = await companyRepo.save(
    companyRepo.create([
      { companyName: 'Alpha Security', active: true },
      { companyName: 'Beta Security', active: true },
    ]),
  );

  const today = new Date();
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0));

  const defaultPasswordHash = await hashPassword('Password123!');

  await userRepo.save(
    userRepo.create([
      {
        email: 'admin@patrol.local',
        passwordHash: defaultPasswordHash,
        firstName: 'Platform',
        lastName: 'Admin',
        role: UserRole.ADMIN,
        companyId: null,
        active: true,
        approved: true,
      },
      {
        email: 'alpha.admin@patrol.local',
        passwordHash: defaultPasswordHash,
        firstName: 'Alpha',
        lastName: 'Admin',
        role: UserRole.COMPANY_ADMIN,
        companyId: alphaCompany.id,
        active: true,
        approved: true,
      },
      {
        email: 'beta.admin@patrol.local',
        passwordHash: defaultPasswordHash,
        firstName: 'Beta',
        lastName: 'Admin',
        role: UserRole.COMPANY_ADMIN,
        companyId: betaCompany.id,
        active: true,
        approved: true,
      },
      {
        email: 'alpha.guard@patrol.local',
        passwordHash: defaultPasswordHash,
        firstName: 'Alpha',
        lastName: 'Guard',
        role: UserRole.GUARD,
        companyId: alphaCompany.id,
        active: true,
        approved: true,
      },
      {
        email: 'alpha.pending.guard@patrol.local',
        passwordHash: defaultPasswordHash,
        firstName: 'Pending',
        lastName: 'Guard',
        role: UserRole.GUARD,
        companyId: alphaCompany.id,
        active: true,
        approved: false,
      },
    ]),
  );

  for (const [index, siteCode] of SITE_CODES.entries()) {
    const company = index < SITE_CODES.length / 2 ? alphaCompany : betaCompany;
    const site = await siteRepo.save(
      siteRepo.create({
        companyId: company.id,
        siteCode,
        siteName: `Security Site ${index + 1}`,
        clientName: `Client ${index + 1}`,
        active: true,
      }),
    );

    await groupRepo.save(
      groupRepo.create({
        siteId: site.id,
        groupName: `${siteCode} Patrol Group`,
        externalGroupId: `wa-group-${siteCode.toLowerCase()}`,
        active: true,
      }),
    );

    await scheduleRepo.save(
      scheduleRepo.create({
        siteId: site.id,
        scheduleName: 'Day shift',
        expectedGuards: 1,
        frequencyMinutes: 60,
        startHour: 0,
        endHour: 0,
        graceMinutes: 15,
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        active: true,
      }),
    );

    const slots: PatrolSlot[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const expectedAt = new Date(dayStart.getTime() + hour * 60 * 60 * 1000);
      const slotEnd = new Date(expectedAt.getTime() + 60 * 60 * 1000);

      slots.push(
        slotRepo.create({
          siteId: site.id,
          slotStart: expectedAt,
          expectedAt,
          slotEnd,
          status: PatrolSlotStatus.PENDING,
        }),
      );
    }

    await slotRepo.save(slots);
  }

  const alphaGuard = await userRepo.findOneByOrFail({ email: 'alpha.guard@patrol.local' });
  const alphaPrimarySite = await siteRepo.findOneByOrFail({ siteCode: SITE_CODES[0] });

  const seededIncident = incidentRepo.create({
    guardId: alphaGuard.id,
    companyId: alphaPrimarySite.companyId,
    siteId: alphaPrimarySite.id,
    description: 'Seeded incident for trial review',
    severity: IncidentSeverity.MEDIUM,
    status: IncidentStatus.OPEN,
  });

  await incidentRepo.save(seededIncident);

  await dataSource.destroy();
  // eslint-disable-next-line no-console
  console.log('Seed completed with two companies and demo auth users. Default password: Password123!');
}

void seed();
