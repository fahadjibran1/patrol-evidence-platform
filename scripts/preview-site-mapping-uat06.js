// Isolated, synthetic API fixture for the real React customer UI. Never connects to WhatsApp or customer data.
const http = require('http');

const API_PORT = 43123;
const UI_ORIGIN = 'http://127.0.0.1:43124';
const timestamp = '2026-09-19T12:00:00.000Z';
const accountId = 'synthetic-preview-account';
const companyId = 'synthetic-northstar-company';
const siteNames = ['Riverside Business Park', 'Central Distribution Hub', 'Westgate Construction Site'];
const sites = siteNames.map((siteName, index) => ({
  id: `synthetic-site-${index + 1}`,
  companyId,
  siteCode: ['RBP', 'CDH', 'WCS'][index],
  siteName,
  clientName: 'Northstar Security Ltd',
  active: true,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}));
const activeNames = ['Patrol Team A', 'Night Patrol', 'Mobile Response', 'Gatehouse Patrol', 'Warehouse Patrol', 'Perimeter Patrol'];
const mappings = Array.from({ length: 13 }, (_, index) => ({
  id: `synthetic-mapping-${index + 1}`,
  siteId: sites[index % 3].id,
  groupName: index < 6 ? activeNames[index] : `Historical Review ${index - 5}`,
  externalGroupId: `synthetic-group-${index + 1}`,
  sourceType: 'group',
  linkedAccountId: accountId,
  active: index < 6,
  createdAt: timestamp,
  site: sites[index % 3],
}));
const schedules = sites.map((site, index) => ({
  id: `synthetic-schedule-${index + 1}`,
  siteId: site.id,
  scheduleName: 'Night patrol coverage',
  expectedGuards: 1,
  frequencyMinutes: 60,
  startHour: 18,
  endHour: 6,
  graceMinutes: 10,
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  active: true,
  createdAt: timestamp,
  site,
}));
const discoveredGroups = Array.from({ length: 120 }, (_, index) => ({
  id: `synthetic-group-${index + 1}`,
  name: index < 6 ? activeNames[index] : index < 13 ? `Historical Review ${index - 5}` : `Northstar Patrol Group ${String(index + 1).padStart(3, '0')}`,
  isGroup: true,
  sourceType: 'group',
  isReadOnly: false,
  unreadCount: 0,
}));
const user = {
  id: 'synthetic-admin', email: 'admin@northstar.invalid', firstName: 'Alex', lastName: 'Morgan',
  role: 'COMPANY_ADMIN', companyId, active: true, approved: true,
};
const collectorStatus = {
  enabled: true, connected: true, ready: true, state: 'ready', info: 'Connected', sessionPath: '',
  qrCode: null, lastQrAt: null, lastMessageAt: timestamp, lastEventAt: timestamp, lastReadyAt: timestamp,
  lastDisconnectAt: null, lastBackfillAt: null, connectedAccount: accountId, backfillRunning: false,
  backfillMessagesScanned: 0, backfillImagesImported: 0, backfillDuplicatesSkipped: 0,
  liveMessagesProcessed: 24, liveImagesImported: 18, liveDuplicatesSkipped: 0, productionListenerCount: 3,
  allowFromMe: false, mappedGroupsCount: 6, pilotGroupName: null, startupStage: 'ready', startupStartedAt: timestamp,
  lastError: null, collectorLogPath: '', latestQrPath: '', qrPayloadLength: null, qrPersistedAt: null,
  qrDeliveredAt: null, collectorLogTail: [], browserExecutablePath: null, browserExecutableSource: null,
  browserCandidatesTried: [], sessionPathExists: true, sessionPathWritable: true,
  monitoringPreference: 'ENABLED', monitoringState: 'ACTIVE', entitlementRestriction: null,
  entitlementMessage: null, sourceDiscoveryState: 'AVAILABLE', sourceDiscoveryError: null,
  lastSourceDiscoveryAt: timestamp,
};

function respond(response, code, data) {
  response.writeHead(code, {
    'Access-Control-Allow-Origin': UI_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(data === undefined ? '' : JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return respond(response, 204);
  const pathname = new URL(request.url, `http://127.0.0.1:${API_PORT}`).pathname;
  if (pathname === '/auth/login' && request.method === 'POST') {
    return respond(response, 200, { accessToken: 'synthetic-preview-access', refreshToken: 'synthetic-preview-refresh', user });
  }
  if (pathname === '/auth/me') return respond(response, 200, user);
  if (pathname === '/sites' && request.method === 'GET') return respond(response, 200, sites);
  if (pathname === '/patrol-groups' && request.method === 'GET') return respond(response, 200, mappings);
  if (pathname === '/patrol-schedules' && request.method === 'GET') return respond(response, 200, schedules);
  if (pathname === '/collectors/whatsapp/groups') return respond(response, 200, discoveredGroups);
  if (pathname === '/collectors/whatsapp/contacts') return respond(response, 200, []);
  if (pathname === '/collectors/whatsapp/status' || pathname === '/collectors/whatsapp/refresh-sources') {
    return respond(response, 200, { ...collectorStatus, mappedGroupsCount: mappings.filter((entry) => entry.active).length });
  }
  if (pathname === '/sites' && request.method === 'POST') {
    const body = await readBody(request);
    if (!body.siteCode || !body.siteName) return respond(response, 400, { message: 'Site code and name are required.' });
    const site = { ...body, id: `synthetic-site-${sites.length + 1}`, companyId, archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
    sites.push(site);
    return respond(response, 201, site);
  }
  if (pathname === '/patrol-groups' && request.method === 'POST') {
    const body = await readBody(request);
    if (mappings.some((entry) => entry.active && entry.externalGroupId === body.externalGroupId && entry.linkedAccountId === accountId)) {
      return respond(response, 409, { message: 'This WhatsApp group already has an active site mapping.' });
    }
    const site = sites.find((entry) => entry.id === body.siteId);
    if (!site) return respond(response, 404, { message: 'Site not found.' });
    const mapping = { ...body, id: `synthetic-mapping-${mappings.length + 1}`, linkedAccountId: accountId, createdAt: timestamp, site };
    mappings.push(mapping);
    return respond(response, 201, mapping);
  }
  if (pathname === '/patrol-schedules' && request.method === 'POST') {
    const body = await readBody(request);
    const site = sites.find((entry) => entry.id === body.siteId);
    if (!site) return respond(response, 404, { message: 'Site not found.' });
    const schedule = { ...body, id: `synthetic-schedule-${schedules.length + 1}`, createdAt: timestamp, site };
    schedules.push(schedule);
    return respond(response, 201, schedule);
  }
  return respond(response, 404, { message: `Synthetic preview route not configured: ${request.method} ${pathname}` });
});

server.listen(API_PORT, '127.0.0.1', () => {
  console.log(`Synthetic PatrolSafe mapping API: http://127.0.0.1:${API_PORT}`);
  console.log('Preview only. No database, WhatsApp, licence, or customer state is used.');
});
