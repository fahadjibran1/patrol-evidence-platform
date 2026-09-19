import * as fs from 'fs';
import * as path from 'path';

const repositoryRoot = path.resolve(__dirname, '..', '..');
const read = (...segments: string[]): string => fs.readFileSync(path.join(repositoryRoot, ...segments), 'utf8');

describe('customer site to WhatsApp mapping workflow contract', () => {
  const setupPage = read('web', 'src', 'pages', 'setup-page.tsx');
  const sitesPage = read('web', 'src', 'pages', 'sites-page.tsx');
  const layout = read('web', 'src', 'components', 'layout.tsx');
  const mappingService = read('src', 'patrol-groups', 'patrol-groups.service.ts');
  const collectorService = read('src', 'collectors', 'whatsapp-collector.service.ts');

  it('keeps a newly created site actionable even when historical mappings already exist', () => {
    expect(sitesPage).toContain('Add WhatsApp group');
    expect(sitesPage).toContain('Manage WhatsApp groups');
    expect(sitesPage).toContain('/setup?siteId=');
    expect(setupPage).toContain('focusedSiteMappings');
    expect(setupPage).toContain('Other sites do not mark this site complete.');
  });

  it('offers searchable human-readable discovery with customer mapping states', () => {
    expect(setupPage).toContain("Search {groupForm.sourceType === 'group' ? 'WhatsApp groups'");
    expect(setupPage).toContain('source.name.toLowerCase().includes(query)');
    expect(setupPage).toContain("'Available'");
    expect(setupPage).toContain('Mapped to ${mappedSite?.siteName');
    expect(setupPage).toContain('Paused — administrator review required');
    expect(setupPage).toContain('Internal WhatsApp identifiers are hidden.');
  });

  it('shows available groups before mapped and paused groups without hiding any status', () => {
    expect(setupPage).toContain('if (sourceMappings.some((mapping) => mapping.active)) return 1;');
    expect(setupPage).toContain('if (sourceMappings.length > 0) return 2;');
    expect(setupPage).toContain('priority(left.id) - priority(right.id)');
    expect(setupPage).toContain(".filter((source) => !query || source.name.toLowerCase().includes(query))");
    expect(setupPage).toContain("'Paused — administrator review required'");
  });

  it('uses the existing protected mapping lifecycle instead of duplicating backend writes', () => {
    expect(setupPage).toContain("apiRequest(\n        '/patrol-groups'");
    expect(mappingService).toContain('assertNoDuplicateActiveMapping');
    expect(mappingService).toContain('This WhatsApp group already has an active site mapping.');
    expect(mappingService).toContain('notifyMappingChanged()');
  });

  it('reconciles mapping changes on the current helper without reconnecting WhatsApp', () => {
    expect(collectorService).toContain("reconcileProductionMonitoring('mapping-change')");
    expect(collectorService).not.toContain("reason=mapping-change action=start-new-helper");
    expect(setupPage).toContain('Monitoring configuration is being refreshed');
  });

  it('routes paused-conflict review and preserves explicit administrator choice', () => {
    expect(layout).toContain('/setup?step=mapping&review=conflicts');
    expect(layout).toContain('Review WhatsApp mappings');
    expect(setupPage).not.toContain('automatically activate');
  });

  it('hands the selected site to scheduling and explains schedule-independent monitoring', () => {
    expect(setupPage).toContain("setSearchParams({ siteId: mappedSiteId, step: 'schedule' })");
    expect(setupPage).toContain('Monitoring can remain active without a current schedule window');
    expect(setupPage).toContain('Patrol schedule saved. Monitoring remains active.');
  });

  it('states that reassignment affects future evidence without rewriting history', () => {
    expect(setupPage).toContain('Future evidence will use the new site. Historical evidence will not change.');
  });
});
