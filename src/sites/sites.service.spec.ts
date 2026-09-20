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
    manager: { transaction: jest.Mock; getRepository: jest.Mock; createQueryBuilder: jest.Mock };
  };
  let scheduleRepo: { count: jest.Mock; update: jest.Mock };
  let groupRepo: { count: jest.Mock; find: jest.Mock };
  let imageRepo: { count: jest.Mock };
  let slotRepo: { count: jest.Mock };
  let transactionManager: { update: jest.Mock; save: jest.Mock; getRepository: jest.Mock; delete: jest.Mock; createQueryBuilder: jest.Mock };

  beforeEach(() => {
    transactionManager = {
      update: jest.fn(),
      save: jest.fn(async (_entity, value) => value),
      getRepository: jest.fn(() => ({ count: jest.fn().mockResolvedValue(0), find: jest.fn().mockResolvedValue([]) })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(), from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(), getRawOne: jest.fn().mockResolvedValue({ count: '0' }),
      })),
    };
    sitesRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        transaction: jest.fn(async (callback) => callback(transactionManager)),
        getRepository: jest.fn(() => ({ count: jest.fn().mockResolvedValue(0) })),
        createQueryBuilder: jest.fn(() => ({
          select: jest.fn().mockReturnThis(), from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(), getRawOne: jest.fn().mockResolvedValue({ count: '0' }),
        })),
      },
    };
    scheduleRepo = {
      count: jest.fn().mockResolvedValue(2),
      update: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    groupRepo = { count: jest.fn().mockResolvedValue(1), find: jest.fn().mockResolvedValue([]) };
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
    expect(sitesRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(transactionManager.update).toHaveBeenCalledWith(expect.any(Function), { siteId: 'site-1', active: true }, { active: false });
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
    expect(scheduleRepo.update).not.toHaveBeenCalled();
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
      patrolAlerts: 0,
      incidents: 0,
      shiftAssignments: 0,
      mappingConflictRecords: 0,
      mayDeletePermanently: false,
    });
  });

  it('requires the site code before deleting an empty site', async () => {
    sitesRepo.findOne.mockResolvedValue({ id: 'site-1', siteCode: 'OXF01', companyId: 'company-1' } as Site);
    await expect(service.deleteEmpty('site-1', user, 'wrong')).rejects.toThrow('Type the site code exactly');
    expect(sitesRepo.manager.transaction).not.toHaveBeenCalled();
  });

  it('deletes only a history-free site and removes its mappings and schedules transactionally', async () => {
    sitesRepo.findOne.mockResolvedValue({ id: 'site-1', siteCode: 'OXF01', companyId: 'company-1' } as Site);
    await service.deleteEmpty('site-1', user, 'OXF01');
    expect(transactionManager.delete).toHaveBeenCalledTimes(3);
    expect(transactionManager.delete).toHaveBeenCalledWith(Site, { id: 'site-1' });
  });

  it('refuses permanent deletion when historical records exist', async () => {
    sitesRepo.findOne.mockResolvedValue({ id: 'site-1', siteCode: 'OXF01', companyId: 'company-1' } as Site);
    transactionManager.getRepository.mockReturnValue({ count: jest.fn().mockResolvedValue(1) });
    await expect(service.deleteEmpty('site-1', user, 'OXF01')).rejects.toThrow('Archive it instead');
    expect(transactionManager.delete).not.toHaveBeenCalled();
  });
});
