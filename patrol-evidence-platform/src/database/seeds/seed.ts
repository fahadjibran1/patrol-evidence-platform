import 'dotenv/config';
import dataSource from '@/database/data-source';
import { Site } from '@/sites/entities/site.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';

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

  const siteRepo = dataSource.getRepository(Site);
  const groupRepo = dataSource.getRepository(PatrolGroup);
  const scheduleRepo = dataSource.getRepository(PatrolSchedule);
  const slotRepo = dataSource.getRepository(PatrolSlot);

  await groupRepo.delete({});
  await scheduleRepo.delete({});
  await slotRepo.delete({});
  await siteRepo.delete({});

  const today = new Date();
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0));

  for (const [index, siteCode] of SITE_CODES.entries()) {
    const site = await siteRepo.save(
      siteRepo.create({
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
        frequencyMinutes: 60,
        startHour: 0,
        endHour: 23,
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

  await dataSource.destroy();
  // eslint-disable-next-line no-console
  console.log('Seed completed for 10 demo sites with hourly schedules and today slots.');
}

void seed();
