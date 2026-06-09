import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import dataSource from '@/database/data-source';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { getPatrolTimeParts } from '@/common/utils/patrol-time.util';

async function repair(): Promise<void> {
  await dataSource.initialize();

  const imageRepo = dataSource.getRepository(PatrolImage);
  const images = await imageRepo.find({
    relations: ['site'],
    order: { sentAt: 'ASC' },
  });

  let updated = 0;

  for (const image of images) {
    const patrolTime = getPatrolTimeParts(image.sentAt);
    const extension = path.extname(image.storedFileName) || '.jpg';
    const nextFileName = `${image.site.siteCode}_${patrolTime.date}_${patrolTime.timePart}${extension}`;
    const nextDir = path.join(process.env.STORAGE_ROOT_PATH || '', image.site.siteCode, patrolTime.date, patrolTime.hourFolder);
    const nextPath = path.join(nextDir, nextFileName);

    if (image.filePath !== nextPath) {
      await fs.mkdir(nextDir, { recursive: true });

      try {
        await fs.access(image.filePath);
        await fs.rename(image.filePath, nextPath);
      } catch {
        // If the file is already gone or was previously moved, keep the database update.
      }
    }

    image.patrolDate = patrolTime.date;
    image.patrolHour = patrolTime.hour;
    image.storedFileName = nextFileName;
    image.filePath = nextPath;
    await imageRepo.save(image);
    updated += 1;
  }

  await dataSource.destroy();
  console.log(`Repaired ${updated} patrol image record(s) for timezone-aware date/hour storage.`);
}

void repair().catch(async (error) => {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }

  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
