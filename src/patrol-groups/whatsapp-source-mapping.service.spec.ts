import { WhatsAppSourceMappingService } from './whatsapp-source-mapping.service';
import { PatrolGroup } from './entities/patrol-group.entity';

describe('WhatsAppSourceMappingService', () => {
  const service = new WhatsAppSourceMappingService({} as never);

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
});
