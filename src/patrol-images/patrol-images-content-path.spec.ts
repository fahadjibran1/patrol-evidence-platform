import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PatrolImagesController } from './patrol-images.controller';

describe('evidence content path compatibility', () => {
  it('streams legacy and sender-organised files using each stored database path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'patrol-content-layout-'));
    try {
      const legacy = path.join(root, 'SITE-A', '2026-09-20', '2000', 'legacy.jpg');
      const organised = path.join(root, 'SITE-A', '2026-09-20', '2000', 'Sidra', 'new.jpg');
      await fs.mkdir(path.dirname(legacy), { recursive: true });
      await fs.mkdir(path.dirname(organised), { recursive: true });
      await fs.writeFile(legacy, Buffer.from('legacy-bytes'));
      await fs.writeFile(organised, Buffer.from('new-bytes'));
      const byId = {
        legacy: { filePath: legacy, storedFileName: 'legacy.jpg', mimeType: 'image/jpeg' },
        organised: { filePath: organised, storedFileName: 'new.jpg', mimeType: 'image/jpeg' },
      };
      const service = { findOne: jest.fn((id: keyof typeof byId) => Promise.resolve(byId[id])) };
      const controller = new PatrolImagesController(service as never, {} as never);
      const response = { setHeader: jest.fn() };
      for (const [id, expected] of [['legacy', 'legacy-bytes'], ['organised', 'new-bytes']] as const) {
        const file = await controller.content(id, {} as never, response as never);
        const chunks: Buffer[] = [];
        for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString()).toBe(expected);
      }
      expect(service.findOne).toHaveBeenCalledTimes(2);
      expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
