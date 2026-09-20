import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@/common/enums/user-role.enum';
import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';
import { PatrolGroupsService } from './patrol-groups.service';
import type { PatrolGroup } from './entities/patrol-group.entity';

describe('PatrolGroupsService customer mapping lifecycle', () => {
  const currentAccount = '447700000001@c.us';
  const sourceId = '120363000000000000@g.us';
  const companyAdmin = {
    sub: 'user-1',
    email: 'admin@example.test',
    role: UserRole.COMPANY_ADMIN,
    companyId: 'company-1',
  };
  let duplicate: PatrolGroup | null;
  let found: PatrolGroup | null;
  let query: Record<string, jest.Mock>;
  let repo: Record<string, jest.Mock>;
  let sites: { findOne: jest.Mock; findActiveById: jest.Mock };
  let mappings: {
    getConfiguredLinkedAccountId: jest.Mock;
    notifyMappingChanged: jest.Mock;
  };
  let service: PatrolGroupsService;

  const group = (overrides: Partial<PatrolGroup> = {}): PatrolGroup => ({
    id: 'mapping-1',
    siteId: 'site-a',
    groupName: 'Night patrol',
    externalGroupId: sourceId,
    linkedAccountId: currentAccount,
    sourceType: PatrolSourceType.GROUP,
    active: true,
    site: { id: 'site-a', companyId: 'company-1', siteCode: 'A' },
    ...overrides,
  } as PatrolGroup);

  beforeEach(() => {
    duplicate = null;
    found = group();
    query = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockImplementation(() => Promise.resolve(
        query.where.mock.calls.some((call) => call[0] === 'group.active = :active') ? duplicate : found,
      )),
    };
    repo = {
      createQueryBuilder: jest.fn(() => query),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      remove: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    sites = {
      findOne: jest.fn().mockImplementation((siteId: string) =>
        Promise.resolve({ id: siteId, companyId: 'company-1' }),
      ),
      findActiveById: jest.fn().mockImplementation((siteId: string) =>
        Promise.resolve({ id: siteId, companyId: 'company-1', active: true }),
      ),
    };
    mappings = {
      getConfiguredLinkedAccountId: jest.fn(() => currentAccount),
      notifyMappingChanged: jest.fn(),
    };
    service = new PatrolGroupsService(repo as never, sites as never, mappings as never);
  });

  it('creates an account-scoped mapping for the current COMPANY_ADMIN connection', async () => {
    const saved = await service.create({
      siteId: 'site-a', groupName: 'Night patrol', externalGroupId: sourceId,
      sourceType: PatrolSourceType.GROUP, active: true,
    }, companyAdmin);

    expect(saved.linkedAccountId).toBe(currentAccount);
    expect(sites.findActiveById).toHaveBeenCalledWith('site-a', companyAdmin);
    expect(mappings.notifyMappingChanged).toHaveBeenCalledTimes(1);
  });

  it('rejects a COMPANY_ADMIN supplied linked account mismatch', async () => {
    await expect(service.create({
      siteId: 'site-a', groupName: 'Night patrol', externalGroupId: sourceId,
      linkedAccountId: 'other-account', active: true,
    }, companyAdmin)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('reassigns an owned mapping while retaining the mapping identity', async () => {
    const saved = await service.update('mapping-1', { siteId: 'site-b' }, companyAdmin);

    expect(saved).toMatchObject({
      id: 'mapping-1',
      siteId: 'site-b',
      site: { id: 'site-b', companyId: 'company-1' },
      linkedAccountId: currentAccount,
    });
    expect(mappings.notifyMappingChanged).toHaveBeenCalledTimes(1);
  });

  it.each([
    { active: false, label: 'deactivate' },
    { active: true, label: 'reactivate' },
  ])('$label updates future eligibility and notifies listener reconciliation', async ({ active }) => {
    found = group({ active: !active });
    const saved = await service.update('mapping-1', { active }, companyAdmin);
    expect(saved.active).toBe(active);
    expect(mappings.notifyMappingChanged).toHaveBeenCalledTimes(1);
  });

  it('rejects mutation of another linked account mapping', async () => {
    found = group({ linkedAccountId: 'other-account' });
    await expect(service.update('mapping-1', { active: false }, companyAdmin)).rejects.toThrow(
      'This mapping does not belong to the current WhatsApp connection.',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects duplicate active source/account mappings with a customer-safe error', async () => {
    duplicate = group({ id: 'duplicate' });
    await expect(service.create({
      siteId: 'site-a', groupName: 'Duplicate', externalGroupId: sourceId, active: true,
    }, companyAdmin)).rejects.toThrow('This WhatsApp group is already mapped.');
  });

  it('detects a real-style discovered group already mapped in another company before Save', async () => {
    const foreignMapping = group({ site: { id: 'historic-site', companyId: 'other-company' } as never });
    repo.find.mockResolvedValue([foreignMapping]);
    const availability = await service.getSourceAvailability([sourceId], companyAdmin);
    expect(availability).toEqual([{ sourceId, status: 'mapped-elsewhere' }]);
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ linkedAccountId: currentAccount, active: true }),
      relations: ['site'],
    }));
    duplicate = foreignMapping;
    await expect(service.create({
      siteId: 'new-site', groupName: 'test1', externalGroupId: sourceId, active: true,
    }, companyAdmin)).rejects.toThrow('This WhatsApp group is already mapped.');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('enforces tenant site ownership through SitesService', async () => {
    sites.findActiveById.mockRejectedValue(new BadRequestException('Invalid site'));
    await expect(service.update('mapping-1', { siteId: 'other-company-site' }, companyAdmin)).rejects.toThrow(
      'Invalid site',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('scopes mapping lists to the COMPANY_ADMIN company', async () => {
    query.getMany.mockResolvedValue([
      group(),
      group({ id: 'other-account-map', linkedAccountId: 'other-account' }),
      group({ id: 'manual-group', externalGroupId: undefined, linkedAccountId: undefined }),
    ]);
    const result = await service.findAll(companyAdmin);
    expect(query.where).toHaveBeenCalledWith('site.companyId = :companyId', { companyId: 'company-1' });
    expect(result.map((entry) => entry.id)).toEqual(['mapping-1', 'manual-group']);
  });
});
