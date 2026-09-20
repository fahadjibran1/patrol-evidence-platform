import { randomUUID } from 'node:crypto';
import { validateSync } from 'class-validator';
// @ts-ignore Node 22 provides node:sqlite; the repository's @types/node predates its declaration.
import { DatabaseSync } from 'node:sqlite';
import { UserRole } from '@/common/enums/user-role.enum';
import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';
import { PatrolGroupsService } from './patrol-groups.service';
import { CheckSourceAvailabilityDto } from './dto/check-source-availability.dto';
import { loadSourceAvailabilityBatched } from '../../web/src/lib/source-availability';

/** Isolated persisted-data contract; never opens the installed PatrolSafe database. */
describe('discovered-source mapping against synthetic persisted SQLite state', () => {
  const accountId = 'synthetic-account@c.us';
  const sourceId = '120363000000000001@g.us';
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE sites (id TEXT PRIMARY KEY, company_id TEXT NOT NULL);
      CREATE TABLE patrol_groups (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, linked_account_id TEXT,
        external_group_id TEXT, group_name TEXT NOT NULL, active INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX unique_active_account_group ON patrol_groups(linked_account_id, external_group_id)
        WHERE active = 1 AND linked_account_id IS NOT NULL AND external_group_id IS NOT NULL;
      INSERT INTO sites VALUES ('historical-site', 'historical-company');
      INSERT INTO sites VALUES ('new-site', 'new-company');
    `);
    database.prepare('INSERT INTO patrol_groups VALUES (?, ?, ?, ?, ?, ?)')
      .run('historical-mapping', 'historical-site', accountId, sourceId, 'test1', 1);
  });

  afterEach(() => database.close());

  it('recognises the foreign active mapping, refuses duplicate Save, then persists only after explicit release', async () => {
    const repo = {
      find: jest.fn(async () => database.prepare(`
        SELECT g.*, s.company_id FROM patrol_groups g JOIN sites s ON s.id = g.site_id
        WHERE g.active = 1 AND g.linked_account_id = ?
      `).all(accountId).map((row: Record<string, unknown>) => ({
        id: row.id, siteId: row.site_id, linkedAccountId: row.linked_account_id,
        externalGroupId: row.external_group_id, active: Boolean(row.active),
        site: { companyId: row.company_id },
      }))),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => database.prepare(`
          SELECT id FROM patrol_groups WHERE active = 1 AND linked_account_id = ? AND external_group_id = ?
        `).get(accountId, sourceId) ?? null),
      })),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        const id = randomUUID();
        database.prepare('INSERT INTO patrol_groups VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, value.siteId, value.linkedAccountId, value.externalGroupId, value.groupName, Number(value.active));
        return { ...value, id };
      }),
    };
    const mappingChanged = jest.fn();
    const service = new PatrolGroupsService(
      repo as never,
      { findActiveById: jest.fn(async (id) => ({ id, companyId: 'new-company', active: true })) } as never,
      { getConfiguredLinkedAccountId: () => accountId, notifyMappingChanged: mappingChanged } as never,
    );
    const user = { sub: 'synthetic-admin', email: 'admin@example.test', role: UserRole.COMPANY_ADMIN, companyId: 'new-company' };

    expect(await service.getSourceAvailability([sourceId], user)).toEqual([
      { sourceId, status: 'mapped-elsewhere' },
    ]);
    const discovered = [
      sourceId,
      ...Array.from({ length: 117 }, (_, index) => `synthetic-group-${index}@g.us`),
      ...Array.from({ length: 422 }, (_, index) => `synthetic-contact-${index}@c.us`),
    ];
    const batchSizes: number[] = [];
    const batched = await loadSourceAvailabilityBatched(discovered, async (sourceIds) => {
      const dto = new CheckSourceAvailabilityDto();
      dto.sourceIds = sourceIds;
      expect(validateSync(dto)).toEqual([]);
      batchSizes.push(sourceIds.length);
      return service.getSourceAvailability(sourceIds, user);
    });
    expect(batchSizes).toEqual([200, 200, 140]);
    expect(batched.statuses[sourceId]).toBe('mapped-elsewhere');
    expect(batched.unavailableCount).toBe(0);
    const request = {
      siteId: 'new-site', groupName: 'test1', externalGroupId: sourceId,
      sourceType: PatrolSourceType.GROUP, active: true,
    };
    await expect(service.create(request, user)).rejects.toThrow('This WhatsApp group is already mapped.');
    expect(repo.save).not.toHaveBeenCalled();

    // An authorised owner must explicitly release the old mapping. The product does not transfer it silently.
    database.prepare('UPDATE patrol_groups SET active = 0 WHERE id = ?').run('historical-mapping');
    expect(await service.getSourceAvailability([sourceId], user)).toEqual([
      { sourceId, status: 'available' },
    ]);
    await service.create(request, user);
    expect(database.prepare('SELECT COUNT(*) AS count FROM patrol_groups WHERE site_id = ? AND active = 1')
      .get('new-site')).toMatchObject({ count: 1 });
    expect(database.prepare('SELECT site_id, active FROM patrol_groups WHERE id = ?')
      .get('historical-mapping')).toMatchObject({ site_id: 'historical-site', active: 0 });
    expect(mappingChanged).toHaveBeenCalledTimes(1);
  });
});
