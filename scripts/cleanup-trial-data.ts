import 'dotenv/config';
import dataSource from '@/database/data-source';
import { Company } from '@/companies/entities/company.entity';
import { Incident } from '@/incidents/entities/incident.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { Site } from '@/sites/entities/site.entity';
import { User } from '@/users/entities/user.entity';
import { UserRole } from '@/common/enums/user-role.enum';

async function cleanup(): Promise<void> {
  await dataSource.initialize();

  const siteRepo = dataSource.getRepository(Site);
  const groupRepo = dataSource.getRepository(PatrolGroup);
  const scheduleRepo = dataSource.getRepository(PatrolSchedule);
  const slotRepo = dataSource.getRepository(PatrolSlot);
  const imageRepo = dataSource.getRepository(PatrolImage);
  const alertRepo = dataSource.getRepository(PatrolAlert);
  const incidentRepo = dataSource.getRepository(Incident);
  const userRepo = dataSource.getRepository(User);
  const companyRepo = dataSource.getRepository(Company);

  const swindonSite = await siteRepo.findOne({
    where: { siteCode: 'SWI01' },
    relations: ['company', 'groups'],
  });

  if (!swindonSite) {
    throw new Error('SWI01 site was not found. Aborting cleanup.');
  }

  await dataSource.transaction(async (manager) => {
    await manager.createQueryBuilder().delete().from(Incident).execute();
    await manager.createQueryBuilder().delete().from(PatrolAlert).execute();
    await manager.createQueryBuilder().delete().from(PatrolSlot).execute();
    await manager.createQueryBuilder().delete().from(PatrolImage).execute();
    await manager.createQueryBuilder().delete().from(PatrolSchedule).execute();

    await manager
      .createQueryBuilder()
      .delete()
      .from(PatrolGroup)
      .where('siteId <> :siteId', { siteId: swindonSite.id })
      .execute();

    await manager
      .createQueryBuilder()
      .delete()
      .from(Site)
      .where('id <> :siteId', { siteId: swindonSite.id })
      .execute();

    await manager
      .createQueryBuilder()
      .delete()
      .from(User)
      .where('role <> :adminRole AND (companyId IS NULL OR companyId <> :companyId)', {
        adminRole: UserRole.ADMIN,
        companyId: swindonSite.companyId,
      })
      .execute();

    await manager
      .createQueryBuilder()
      .delete()
      .from(Company)
      .where('id <> :companyId', { companyId: swindonSite.companyId })
      .execute();
  });

  const remainingSites = await siteRepo.find({ relations: ['company', 'groups'] });
  const remainingUsers = await userRepo.find({ order: { email: 'ASC' } });
  const remainingCompanies = await companyRepo.find({ order: { companyName: 'ASC' } });
  const remainingGroups = await groupRepo.find({ relations: ['site'], order: { groupName: 'ASC' } });
  const remainingSchedules = await scheduleRepo.count();
  const remainingSlots = await slotRepo.count();
  const remainingImages = await imageRepo.count();
  const remainingAlerts = await alertRepo.count();
  const remainingIncidents = await incidentRepo.count();

  await dataSource.destroy();

  console.log('Trial cleanup complete.');
  console.log(`Remaining companies: ${remainingCompanies.map((company) => company.companyName).join(', ')}`);
  console.log(`Remaining site: ${remainingSites.map((site) => `${site.siteCode} (${site.siteName})`).join(', ')}`);
  console.log(`Remaining groups: ${remainingGroups.map((group) => `${group.groupName} -> ${group.externalGroupId ?? 'no external id'}`).join(', ')}`);
  console.log(`Remaining users: ${remainingUsers.map((user) => `${user.email} [${user.role}]`).join(', ')}`);
  console.log(`Schedules: ${remainingSchedules}, Slots: ${remainingSlots}, Images: ${remainingImages}, Alerts: ${remainingAlerts}, Incidents: ${remainingIncidents}`);
}

void cleanup().catch(async (error) => {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }

  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
