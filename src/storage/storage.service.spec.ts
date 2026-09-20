import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
const sharp = require('sharp') as typeof import('sharp').default;
import { normalizeStorageWriteError, StorageService } from './storage.service';

describe('StorageService', () => {
  let rootPath: string;
  let service: StorageService;

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'patrol-storage-'));
    service = new StorageService({
      getOrThrow: jest.fn((key: string) => {
        if (key === 'storageRootPath') {
          return rootPath;
        }

        throw new Error(`Unexpected key ${key}`);
      }),
      get: jest.fn((key: string) => {
        if (key === 'securityCompanyName') {
          return 'Tech Guards Security';
        }

        if (key === 'businessTimeZone') {
          return 'Europe/London';
        }

        return undefined;
      }),
    } as never);
  });

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it('saves a stamped image into the expected path', async () => {
    const originalBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: '#225577',
      },
    })
      .jpeg()
      .toBuffer();

    const stored = await service.savePatrolEvidence({
      siteCode: 'SWI01',
      siteName: 'Corner Copse, Swindon',
      senderName: 'MJ',
      timestamp: new Date('2026-04-04T16:03:22.000Z'),
      buffer: originalBuffer,
      mimeType: 'image/jpeg',
      uniqueSuffix: 'test',
    });

    const savedBuffer = await fs.readFile(stored.filePath);
    const metadata = await sharp(savedBuffer).metadata();

    expect(stored.filePath).toContain(path.join('SWI01', '2026-04-04', '1700', 'MJ'));
    expect(stored.storedFileName).toMatch(/^SWI01_2026-04-04_17-03-22_[0-9a-f-]+\.jpg$/);
    expect(savedBuffer.equals(originalBuffer)).toBe(false);
    expect(stored.fileSize).toBe(savedBuffer.length);
    expect(stored.contentSha256).toBe(createHash('sha256').update(savedBuffer).digest('hex'));
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(600);
  }, 15_000);

  it('renders overlay text using the configured timezone', () => {
    const overlaySvg = (service as any).buildOverlaySvg({
      width: 800,
      height: 120,
      paddingX: 20,
      paddingY: 14,
      titleSize: 24,
      bodySize: 18,
      lineGap: 8,
      companyName: 'Tech Guards Security',
      siteCode: 'SWI01',
      siteName: 'Corner Copse, Swindon',
      dateTime: (service as any).formatOverlayDateTime(new Date('2026-04-04T16:03:22.000Z')),
      senderName: 'MJ',
    });

    expect(overlaySvg).toContain('Tech Guards Security');
    expect(overlaySvg).toContain('Site: SWI01 - Corner Copse, Swindon');
    expect(overlaySvg).toContain('Date/Time: 4 Apr 2026, 17:03:22');
    expect(overlaySvg).toContain('Sender: MJ');
  });

  it('classifies storage folders using the configured international workspace timezone', async () => {
    const dubaiService = new StorageService({
      getOrThrow: jest.fn(() => rootPath),
      get: jest.fn((key: string) => key === 'businessTimeZone' ? 'Asia/Dubai' : 'PatrolSafe UAT Ltd'),
    } as never);
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#225577' } })
      .jpeg()
      .toBuffer();

    const stored = await dubaiService.savePatrolEvidence({
      siteCode: 'DXB01',
      timestamp: new Date('2026-09-13T21:30:00.000Z'),
      buffer: image,
      mimeType: 'image/jpeg',
    });

    expect(stored.filePath).toContain(path.join('DXB01', '2026-09-14', '0100', 'Unknown Sender'));
  });

  it('rejects corrupt image bytes instead of saving them as evidence', async () => {
    const originalBuffer = Buffer.from('not-an-image');
    await expect(service.savePatrolEvidence({
      siteCode: 'SWI01',
      siteName: 'Corner Copse, Swindon',
      senderName: 'MJ',
      timestamp: new Date('2026-04-04T16:03:22.000Z'),
      buffer: originalBuffer,
      mimeType: 'image/jpeg',
    })).rejects.toThrow();
  });

  it('rejects an oversized image before invoking the native decoder', async () => {
    await expect(service.savePatrolEvidence({
      siteCode: 'SWI01',
      timestamp: new Date('2026-04-04T16:03:22.000Z'),
      buffer: Buffer.alloc(25 * 1024 * 1024 + 1),
      mimeType: 'image/jpeg',
    })).rejects.toThrow('Evidence image exceeds the 25MB limit');
  });

  it('returns customer-safe guidance for disk-full writes', () => {
    const error = normalizeStorageWriteError(Object.assign(new Error('no space'), { code: 'ENOSPC' }));
    expect(error.message).toContain('Storage full or insufficient space');
    expect((error as NodeJS.ErrnoException).code).toBe('PATROLSAFE_INSUFFICIENT_SPACE');
  });

  it('fails closed before image processing when evidence storage lacks headroom', async () => {
    const statfs = jest.spyOn(fs, 'statfs').mockResolvedValue({ bavail: 0, bsize: 4096 } as never);
    try {
      await expect(service.savePatrolEvidence({
        siteCode: 'SWI01',
        timestamp: new Date('2026-04-04T16:03:22.000Z'),
        buffer: Buffer.from('not-processed'),
        mimeType: 'image/jpeg',
      })).rejects.toThrow('Storage full or insufficient space');
    } finally {
      statfs.mockRestore();
    }
  });

  it('gives simultaneous messages distinct final files', async () => {
    const originalBuffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#225577' } }).jpeg().toBuffer();
    const [first, second] = await Promise.all([
      service.savePatrolEvidence({ siteCode: 'SWI01', timestamp: new Date('2026-04-04T16:03:22.000Z'), buffer: originalBuffer, mimeType: 'image/jpeg' }),
      service.savePatrolEvidence({ siteCode: 'SWI01', timestamp: new Date('2026-04-04T16:03:22.000Z'), buffer: originalBuffer, mimeType: 'image/jpeg' }),
    ]);
    expect(first.filePath).not.toBe(second.filePath);
    expect((await fs.readFile(first.filePath)).length).toBeGreaterThan(0);
    expect((await fs.readFile(second.filePath)).length).toBeGreaterThan(0);
  });

  it('organises multiple senders and repeat images without using sender identity as a folder', async () => {
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#225577' } }).jpeg().toBuffer();
    const timestamp = new Date('2026-04-04T16:03:22.000Z');
    const save = (senderName: string) => service.savePatrolEvidence({ siteCode: 'SWI01', senderName, timestamp, buffer: image, mimeType: 'image/jpeg' });
    const [sidraOne, sidraTwo, other] = await Promise.all([save('Sidra'), save('Sidra'), save('Patrol Team A')]);
    expect(path.dirname(sidraOne.filePath)).toBe(path.dirname(sidraTwo.filePath));
    expect(sidraOne.filePath).not.toBe(sidraTwo.filePath);
    expect(path.dirname(sidraOne.filePath)).toBe(path.join(rootPath, 'SWI01', '2026-04-04', '1700', 'Sidra'));
    expect(path.dirname(other.filePath)).toBe(path.join(rootPath, 'SWI01', '2026-04-04', '1700', 'Patrol Team A'));
    for (const stored of [sidraOne, sidraTwo, other]) {
      expect(createHash('sha256').update(await fs.readFile(stored.filePath)).digest('hex')).toBe(stored.contentSha256);
    }
  });

  it('keeps exact duplicate display names safe through unique file names', async () => {
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#225577' } }).jpeg().toBuffer();
    const timestamp = new Date('2026-04-04T16:03:22.000Z');
    const first = await service.savePatrolEvidence({ siteCode: 'SWI01', senderName: 'Alex', timestamp, buffer: image, mimeType: 'image/jpeg' });
    const second = await service.savePatrolEvidence({ siteCode: 'SWI01', senderName: 'Alex', timestamp, buffer: image, mimeType: 'image/jpeg' });
    expect(path.dirname(first.filePath)).toBe(path.dirname(second.filePath));
    expect(first.filePath).not.toBe(second.filePath);
    expect(await fs.readdir(path.dirname(first.filePath))).toHaveLength(2);
  });

  it('uses the capture-time label after a sender rename without moving old evidence', async () => {
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#225577' } }).jpeg().toBuffer();
    const timestamp = new Date('2026-04-04T16:03:22.000Z');
    const before = await service.savePatrolEvidence({ siteCode: 'SWI01', senderName: 'Sidra', timestamp, buffer: image, mimeType: 'image/jpeg' });
    const after = await service.savePatrolEvidence({ siteCode: 'SWI01', senderName: 'Sidra Khan', timestamp, buffer: image, mimeType: 'image/jpeg' });
    expect(path.dirname(before.filePath)).toMatch(/Sidra$/u);
    expect(path.dirname(after.filePath)).toMatch(/Sidra Khan$/u);
    expect(await fs.readFile(before.filePath)).toBeTruthy();
  });

  it('rejects a path-escaping site code', async () => {
    const originalBuffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#225577' } }).jpeg().toBuffer();
    await expect(service.savePatrolEvidence({
      siteCode: '..', timestamp: new Date('2026-04-04T16:03:22.000Z'), buffer: originalBuffer, mimeType: 'image/jpeg',
    })).rejects.toThrow('escapes configured storage root');
  });
});
