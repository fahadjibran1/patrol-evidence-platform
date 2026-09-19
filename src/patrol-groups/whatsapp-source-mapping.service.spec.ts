import { WhatsAppSourceMappingService } from './whatsapp-source-mapping.service';
import { PatrolGroup } from './entities/patrol-group.entity';

describe('WhatsAppSourceMappingService', () => {
  const patrolGroupRepo = {
    find: jest.fn(),
    save: jest.fn(),
  };
  const service = new WhatsAppSourceMappingService(patrolGroupRepo as never);

  beforeEach(() => {
    jest.clearAllMocks();
    patrolGroupRepo.find.mockResolvedValue([]);
  });

  function createGroup(overrides: Partial<PatrolGroup>): PatrolGroup {
    return {
      id: 'group-1',
      siteId: 'site-1',
      groupName: 'Mapped source',
      externalGroupId: '120363000000000000@g.us',
      sourceType: 'group',
      active: true,
      site: {
        id: 'site-1',
        siteCode: 'TS001',
        active: true,
      },
      ...overrides,
    } as PatrolGroup;
  }

  it('accepts legacy mappings without linkedAccountId for the configured linked account', () => {
    const group = createGroup({ linkedAccountId: undefined });

    expect(service.isMappingEligibleForIngest(group, '447700000001@c.us')).toBe(true);
  });

  it('requires matching linkedAccountId when the mapping is account-scoped', () => {
    const matching = createGroup({ linkedAccountId: '447700000001@c.us' });
    const otherAccount = createGroup({ linkedAccountId: '447700000002@c.us' });

    expect(service.isMappingEligibleForIngest(matching, '447700000001@c.us')).toBe(true);
    expect(service.isMappingEligibleForIngest(otherAccount, '447700000001@c.us')).toBe(false);
  });

  it('excludes inactive sites and inactive mappings', () => {
    const inactiveSite = createGroup({ site: { id: 'site-1', siteCode: 'TS001', active: false } as never });
    const inactiveMapping = createGroup({ active: false });

    expect(service.isMappingEligibleForIngest(inactiveSite, '447700000001@c.us')).toBe(false);
    expect(service.isMappingEligibleForIngest(inactiveMapping, '447700000001@c.us')).toBe(false);
  });

  it('keeps seven paused migration conflicts excluded when six approved mappings are eligible', async () => {
    const accountId = '447700000001@c.us';
    const approved = Array.from({ length: 6 }, (_, index) => createGroup({
      id: `approved-${index}`,
      externalGroupId: `12036320000000000${index}@g.us`,
      linkedAccountId: accountId,
    }));
    const paused = Array.from({ length: 7 }, (_, index) => createGroup({
      id: `paused-${index}`,
      externalGroupId: `12036330000000000${index}@g.us`,
      linkedAccountId: accountId,
      active: false,
    }));
    patrolGroupRepo.find.mockResolvedValue([...approved, ...paused]);

    await expect(service.findActiveMappingsForIngest(accountId)).resolves.toEqual(approved);
    expect(paused.every((mapping) => mapping.active === false)).toBe(true);
    expect(patrolGroupRepo.save).not.toHaveBeenCalled();
  });

  it('excludes archived sites from ingest eligibility', () => {
    const archivedSite = createGroup({
      site: {
        id: 'site-1',
        siteCode: 'TS001',
        active: false,
        archivedAt: new Date('2026-07-01T00:00:00.000Z'),
      } as never,
    });

    expect(service.isMappingEligibleForIngest(archivedSite, '447700000001@c.us')).toBe(false);
  });

  it('notifies and cleanly unsubscribes mapping lifecycle observers', () => {
    const listener = jest.fn();
    const unsubscribe = service.subscribeToMappingChanges(listener);
    service.notifyMappingChanged();
    unsubscribe();
    service.notifyMappingChanged();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  describe('certification tuple scope', () => {
    const accountId = '447700000001@c.us';
    const sourceId = '120363000000000000@g.us';
    const siteId = 'site-1';

    async function findMatches(groups: PatrolGroup[]): Promise<PatrolGroup[]> {
      patrolGroupRepo.find.mockResolvedValue(groups);
      return service.findActiveCertificationMappings(accountId, sourceId, siteId);
    }

    it('returns one exact tuple when there are no unrelated mappings', async () => {
      const exact = createGroup({ linkedAccountId: accountId });

      await expect(findMatches([exact])).resolves.toEqual([exact]);
    });

    it('returns one exact tuple while ignoring seven unrelated mappings', async () => {
      const exact = createGroup({ linkedAccountId: accountId });
      const unrelated = Array.from({ length: 7 }, (_, index) =>
        createGroup({
          id: `unrelated-${index}`,
          externalGroupId: `12036310000000000${index}@g.us`,
          linkedAccountId: accountId,
        }),
      );

      await expect(findMatches([exact, ...unrelated])).resolves.toEqual([exact]);
    });

    it('returns no match when only unrelated mappings exist', async () => {
      const unrelated = createGroup({ externalGroupId: '120363999999999999@g.us', linkedAccountId: accountId });

      await expect(findMatches([unrelated])).resolves.toEqual([]);
    });

    it('returns both duplicate exact tuples so the caller can fail closed', async () => {
      const first = createGroup({ id: 'exact-1', linkedAccountId: accountId });
      const second = createGroup({ id: 'exact-2', linkedAccountId: accountId });

      await expect(findMatches([first, second])).resolves.toEqual([first, second]);
    });

    it('does not count the same source mapped to a different site', async () => {
      const differentSite = createGroup({ siteId: 'site-2', linkedAccountId: accountId });

      await expect(findMatches([differentSite])).resolves.toEqual([]);
    });

    it('does not count the same site mapped to a different source', async () => {
      const differentSource = createGroup({ externalGroupId: '120363999999999999@g.us', linkedAccountId: accountId });

      await expect(findMatches([differentSource])).resolves.toEqual([]);
    });

    it('does not count another account or an unscoped legacy mapping', async () => {
      const differentAccount = createGroup({ id: 'other-account', linkedAccountId: '447700000002@c.us' });
      const unscoped = createGroup({ id: 'legacy-unscoped', linkedAccountId: undefined });

      await expect(findMatches([differentAccount, unscoped])).resolves.toEqual([]);
    });

    it('does not count an inactive exact mapping', async () => {
      const inactive = createGroup({ linkedAccountId: accountId, active: false });

      await expect(findMatches([inactive])).resolves.toEqual([]);
    });

    it('does not mutate mappings while validating the tuple', async () => {
      const exact = createGroup({ linkedAccountId: accountId });

      await findMatches([exact]);

      expect(patrolGroupRepo.save).not.toHaveBeenCalled();
      expect(patrolGroupRepo.find).toHaveBeenCalledWith({
        where: { active: true },
        relations: ['site', 'site.company'],
      });
    });
  });
});
