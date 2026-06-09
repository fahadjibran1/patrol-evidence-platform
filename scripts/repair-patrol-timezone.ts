import dataSource from '@/database/data-source';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { getPatrolTimeParts, patrolTimeZone } from '@/common/utils/patrol-time.util';

async function main(): Promise<void> {
  const applyChanges = process.argv.includes('--apply');
  await dataSource.initialize();

  try {
    const repo = dataSource.getRepository(PatrolImage);
    const images = await repo.find({
      order: {
        sentAt: 'ASC',
      },
    });

    let scanned = 0;
    let changed = 0;

    for (const image of images) {
      scanned += 1;
      const patrolTime = getPatrolTimeParts(image.sentAt);

      if (image.patrolDate === patrolTime.date && image.patrolHour === patrolTime.hour) {
        continue;
      }

      changed += 1;
      console.log(
        [
          `image=${image.id}`,
          `site=${image.siteId}`,
          `sentAt=${image.sentAt.toISOString()}`,
          `from=${image.patrolDate} ${String(image.patrolHour).padStart(2, '0')}:00`,
          `to=${patrolTime.date} ${String(patrolTime.hour).padStart(2, '0')}:00`,
        ].join(' '),
      );

      if (applyChanges) {
        image.patrolDate = patrolTime.date;
        image.patrolHour = patrolTime.hour;
        await repo.save(image);
      }
    }

    console.log(`Business timezone: ${patrolTimeZone()}`);
    console.log(`Scanned images: ${scanned}`);
    console.log(`Images requiring repair: ${changed}`);
    console.log(applyChanges ? 'Repair applied.' : 'Dry run only. Re-run with --apply to persist changes.');
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error('Failed to repair patrol timezone buckets.');
  console.error(error);
  process.exitCode = 1;
});
