import { SitesService } from './sites.service';
import { UserRole } from '@/common/enums/user-role.enum';
import { Site } from './entities/site.entity';

describe('SitesService archive/restore', () => {
  const user = {
    sub: 'admin-1',
    email: 'admin@patrol.local',
    role: UserRole.ADMIN,
    companyId: null,
  };

  let service: SitesService;
  let sitesRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let scheduleRepo: { count: jest.Mock; update: jest.Mock };
  let groupRepo: { count: jest.Mock };
  let imageRepo: { count: jest.Mock };
  let slotRepo: { count: jest.Mock };

  beforeEach(() => {
    sitesRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    scheduleRepo = {
      count: jest.fn().mockResolvedValue(2),
      update: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    groupRepo = { count: jest.fn().mockResolvedValue(1) };
    imageRepo = { count: jest.fn().mockResolvedValue(5) };
    slotRepo = { count: jest.fn().mockResolvedValue(3) };

    service = new SitesService(
      sitesRepo as never,
      { findOne: jest.fn() } as never,
      groupRepo as never,
      scheduleRepo as never,
      imageRepo as never,
      slotRepo as never,
    );
  });

  it('archives a site without hard-deleting history', async () => {
    const site = {
      id: 'site-1',
      siteCode: 'OXF01',
      siteName: 'Oxford',
      companyId: 'company-1',
      active: true,
      archivedAt: null,
    } as Site;

    sitesRepo.findOne.mockResolvedValue(site);
    sitesRepo.save.mockImplementation(async (value) => value);

    const archived = await service.archive('site-1', user, 'test');
    expect(archived.active).toBe(false);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(scheduleRepo.update).toHaveBeenCalledWith({ siteId: 'site-1', active: true }, { active: false });
  });

  it('restores an archived site and keeps the original site code', async () => {
    const site = {
      id: 'site-1',
      siteCode: 'OXF01',
      siteName: 'Oxford',
      companyId: 'company-1',
      active: false,
      archivedAt: new Date('2026-07-01T00:00:00.000Z'),
    } as Site;

    sitesRepo.findOne.mockResolvedValue(site);
    sitesRepo.save.mockImplementation(async (value) => value);

    const restored = await service.restore('site-1', user);
    expect(restored.active).toBe(true);
    expect(restored.archivedAt).toBeNull();
    expect(restored.siteCode).toBe('OXF01');
    expect(scheduleRepo.update).toHaveBeenCalledWith({ siteId: 'site-1', active: false }, { active: true });
  });

  it('returns archive preview counts for confirmation dialogs', async () => {
    sitesRepo.findOne.mockResolvedValue({
      id: 'site-1',
      siteCode: 'OXF01',
      siteName: 'Oxford',
      companyId: 'company-1',
      active: true,
      archivedAt: null,
    } as Site);

    const preview = await service.getArchivePreview('site-1', user);
    expect(preview).toEqual({
      siteId: 'site-1',
      siteCode: 'OXF01',
      siteName: 'Oxford',
      mappedGroups: 1,
      schedules: 2,
      patrolImages: 5,
      patrolSlots: 3,
    });
  });
});
