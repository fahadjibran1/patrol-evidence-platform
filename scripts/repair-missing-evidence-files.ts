import 'dotenv/config';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import dataSource from '@/database/data-source';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { getPatrolTimeParts } from '@/common/utils/patrol-time.util';

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcTimePart(value: Date): string {
  const hh = String(value.getUTCHours()).padStart(2, '0');
  const mm = String(value.getUTCMinutes()).padStart(2, '0');
  const ss = String(value.getUTCSeconds()).padStart(2, '0');
  return `${hh}-${mm}-${ss}`;
}

function utcHourFolder(value: Date): string {
  return `${String(value.getUTCHours()).padStart(2, '0')}00`;
}

async function repair(): Promise<void> {
  await dataSource.initialize();

  const rootPath = process.env.STORAGE_ROOT_PATH;
  if (!rootPath) {
    throw new Error('STORAGE_ROOT_PATH is not configured.');
  }

  const imageRepo = dataSource.getRepository(PatrolImage);
  const images = await imageRepo.find({
    relations: ['site'],
    order: { sentAt: 'ASC' },
  });

  let repaired = 0;
  let unresolved = 0;

  for (const image of images) {
    if (existsSync(image.filePath)) {
      continue;
    }

    const siteCode = image.site.siteCode;
    const extension = path.extname(image.storedFileName) || '.jpg';
    const patrolTime = getPatrolTimeParts(image.sentAt);
    const desiredDir = path.join(rootPath, siteCode, patrolTime.date, patrolTime.hourFolder);
    const desiredPath = path.join(desiredDir, image.storedFileName);

    const legacyBaseName = `${siteCode}_${utcDate(image.sentAt)}_${utcTimePart(image.sentAt)}${extension}`;
    const candidates = [
      path.join(rootPath, siteCode, utcDate(image.sentAt), legacyBaseName),
      path.join(rootPath, siteCode, utcDate(image.sentAt), utcHourFolder(image.sentAt), legacyBaseName),
      path.join(rootPath, siteCode, patrolTime.date, legacyBaseName),
      path.join(rootPath, siteCode, patrolTime.date, patrolTime.hourFolder, legacyBaseName),
    ];

    const sourcePath = candidates.find((candidate) => existsSync(candidate));
    if (!sourcePath) {
      unresolved += 1;
      continue;
    }

    await fs.mkdir(desiredDir, { recursive: true });

    if (!existsSync(desiredPath)) {
      await fs.rename(sourcePath, desiredPath);
    }

    image.filePath = desiredPath;
    await imageRepo.save(image);
    repaired += 1;
  }

  await dataSource.destroy();
  console.log(`Repaired ${repaired} missing patrol image file(s). Unresolved: ${unresolved}.`);
}

void repair().catch(async (error) => {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }

  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
