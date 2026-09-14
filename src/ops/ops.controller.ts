import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { getPatrolTimeParts, patrolTimeZone } from '@/common/utils/patrol-time.util';

@Controller('ops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
export class OpsController {
  @Get()
  renderDashboard(@Res() response: Response): void {
    response.type('html').send(this.buildHtml(getPatrolTimeParts(new Date()).date, patrolTimeZone()));
  }

  private buildHtml(operationalToday: string, workspaceTimeZone: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Patrol Ops Console</title>
  <style>
    :root {
      --bg: #f3efe7;
      --panel: rgba(255,255,255,0.88);
      --ink: #1f2a2e;
      --muted: #65757f;
      --line: rgba(31,42,46,0.12);
      --accent: #0c7c59;
      --accent-2: #d96c06;
      --danger: #b63a2b;
      --warn: #b57f00;
      --ok: #0c7c59;
      --shadow: 0 18px 45px rgba(39, 51, 57, 0.12);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Aptos", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(12,124,89,0.12), transparent 28%),
        radial-gradient(circle at top right, rgba(217,108,6,0.12), transparent 24%),
        linear-gradient(180deg, #f7f3ec 0%, #efe7db 100%);
      min-height: 100vh;
    }

    .wrap {
      max-width: 1480px;
      margin: 0 auto;
      padding: 28px;
    }

    .hero {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
      margin-bottom: 24px;
    }

    .hero h1 {
      margin: 0 0 8px;
      font-size: 2.25rem;
      letter-spacing: -0.03em;
    }

    .hero p {
      margin: 0;
      color: var(--muted);
      max-width: 760px;
    }

    .toolbar {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 16px;
    }

    .panel {
      background: var(--panel);
      backdrop-filter: blur(8px);
      border: 1px solid var(--line);
      border-radius: 22px;
      box-shadow: var(--shadow);
      padding: 18px;
    }

    .span-12 { grid-column: span 12; }
    .span-8 { grid-column: span 8; }
    .span-6 { grid-column: span 6; }
    .span-4 { grid-column: span 4; }

    .panel h2 {
      margin: 0 0 12px;
      font-size: 1.1rem;
    }

    .subtle {
      color: var(--muted);
      font-size: 0.94rem;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
    }

    .card {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255,255,255,0.72);
    }

    .card .label {
      color: var(--muted);
      font-size: 0.84rem;
      margin-bottom: 8px;
    }

    .card .value {
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: -0.03em;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 0.9rem;
      font-weight: 600;
      background: rgba(12,124,89,0.1);
      color: var(--ok);
    }

    .status-pill.warn { background: rgba(181,127,0,0.12); color: var(--warn); }
    .status-pill.danger { background: rgba(182,58,43,0.12); color: var(--danger); }
    .status-pill.neutral { background: rgba(101,117,127,0.12); color: var(--muted); }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.94rem;
    }

    th, td {
      text-align: left;
      padding: 11px 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .actions, .inline {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    button, select, input {
      font: inherit;
    }

    button {
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      cursor: pointer;
      background: var(--ink);
      color: white;
    }

    button.secondary {
      background: white;
      color: var(--ink);
      border: 1px solid var(--line);
    }

    button.accent {
      background: var(--accent);
    }

    button.warn {
      background: var(--accent-2);
    }

    select, input[type="date"] {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
      background: white;
      min-width: 180px;
    }

    .hint {
      margin-top: 10px;
      color: var(--muted);
      font-size: 0.88rem;
    }

    .mono {
      font-family: Consolas, "Courier New", monospace;
      font-size: 0.86rem;
    }

    .stack {
      display: grid;
      gap: 10px;
    }

    .empty {
      padding: 18px;
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 16px;
      background: rgba(255,255,255,0.5);
    }

    .toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      max-width: 360px;
      padding: 14px 16px;
      border-radius: 14px;
      background: var(--ink);
      color: white;
      box-shadow: var(--shadow);
      opacity: 0;
      transform: translateY(10px);
      transition: opacity .2s ease, transform .2s ease;
      pointer-events: none;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    @media (max-width: 1180px) {
      .span-8, .span-6, .span-4 { grid-column: span 12; }
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 720px) {
      .wrap { padding: 16px; }
      .hero { display: block; }
      .cards { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div>
        <h1>Patrol Ops Console</h1>
        <p>See which WhatsApp groups are live, map them to patrol groups, and watch incoming evidence, missed patrols, and duplicate images as the trial runs.</p>
      </div>
      <div class="toolbar">
        <input id="dateInput" type="date" />
        <button class="secondary" id="refreshButton">Refresh</button>
        <button class="accent" id="startButton">Start WhatsApp</button>
        <button class="warn" id="stopButton">Stop WhatsApp</button>
      </div>
    </div>

    <div class="grid">
      <section class="panel span-12">
        <div class="actions" style="justify-content: space-between;">
          <div>
            <h2 style="margin-bottom:6px;">Collector Status</h2>
            <div class="subtle">Connected state, session info, and the latest WhatsApp activity.</div>
          </div>
          <div id="statusPill" class="status-pill neutral">Loading</div>
        </div>
        <div class="cards" style="margin-top:16px;">
          <div class="card"><div class="label">Connected Account</div><div class="value mono" id="connectedAccount">-</div></div>
          <div class="card"><div class="label">Session Path</div><div class="value mono" id="sessionPath">-</div></div>
          <div class="card"><div class="label">Last Event</div><div class="value mono" id="lastEventAt">-</div></div>
          <div class="card"><div class="label">Last Message</div><div class="value mono" id="lastMessageAt">-</div></div>
          <div class="card"><div class="label">Last QR</div><div class="value mono" id="lastQrAt">-</div></div>
          <div class="card"><div class="label">Info</div><div class="value mono" id="collectorInfo">-</div></div>
        </div>
      </section>

      <section class="panel span-12">
        <div class="actions" style="justify-content: space-between;">
          <div>
            <h2 style="margin-bottom:6px;">Daily Overview</h2>
            <div class="subtle">Fast signal for whether patrol evidence is arriving and being classified correctly.</div>
          </div>
          <div class="subtle" id="overviewDateLabel"></div>
        </div>
        <div class="cards" style="margin-top:16px;">
          <div class="card"><div class="label">Images Received</div><div class="value" id="imagesReceived">0</div></div>
          <div class="card"><div class="label">On Time</div><div class="value" id="slotsOnTime">0</div></div>
          <div class="card"><div class="label">Late</div><div class="value" id="slotsLate">0</div></div>
          <div class="card"><div class="label">Missing</div><div class="value" id="slotsMissing">0</div></div>
          <div class="card"><div class="label">Duplicate</div><div class="value" id="slotsDuplicate">0</div></div>
          <div class="card"><div class="label">Unresolved Alerts</div><div class="value" id="alertsOpen">0</div></div>
        </div>
      </section>

      <section class="panel span-8">
        <h2>Live WhatsApp Groups</h2>
        <div class="subtle">These are the groups visible to the linked WhatsApp account. Use the mapping panel to decide which one should route into each patrol group.</div>
        <div id="groupsWrap" style="margin-top:16px;"></div>
      </section>

      <section class="panel span-4">
        <h2>Recent Images</h2>
        <div class="subtle">Newest evidence seen by the platform for the selected day.</div>
        <div id="recentImages" class="stack" style="margin-top:16px;"></div>
      </section>

      <section class="panel span-12">
        <h2>Patrol Group Mapping</h2>
        <div class="subtle">Choose a live WhatsApp group for each patrol group. Saving writes the exact WhatsApp group id into the patrol group mapping.</div>
        <div id="mappingWrap" style="margin-top:16px;"></div>
      </section>

      <section class="panel span-12">
        <h2>Site Status</h2>
        <div class="subtle">Use this table to spot missed patrols, duplicate evidence, or sites receiving nothing.</div>
        <div id="siteWrap" style="margin-top:16px;"></div>
      </section>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    const initialToken = new URLSearchParams(window.location.search).get('access_token');
    if (initialToken) {
      window.localStorage.setItem('authToken', initialToken);
    }

    const state = {
      groups: [],
      patrolGroups: [],
      sites: [],
      date: ${JSON.stringify(operationalToday)},
    };

    const dateInput = document.getElementById('dateInput');
    const refreshButton = document.getElementById('refreshButton');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    dateInput.value = state.date;

    refreshButton.addEventListener('click', refreshAll);
    startButton.addEventListener('click', async () => {
      await fetchJson('/collectors/whatsapp/start', { method: 'POST', headers: buildAuthHeaders() });
      toast('WhatsApp collector start requested');
      await refreshAll();
    });
    stopButton.addEventListener('click', async () => {
      await fetchJson('/collectors/whatsapp/stop', { method: 'POST', headers: buildAuthHeaders() });
      toast('WhatsApp collector stop requested');
      await refreshAll();
    });
    dateInput.addEventListener('change', async () => {
      state.date = dateInput.value;
      await refreshAll();
    });

    function toast(message) {
      const node = document.getElementById('toast');
      node.textContent = message;
      node.classList.add('show');
      clearTimeout(node._timer);
      node._timer = setTimeout(() => node.classList.remove('show'), 2200);
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
        ...options,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || ('Request failed for ' + url));
      }

      return response.json();
    }

    function buildAuthHeaders() {
      const token = window.localStorage.getItem('authToken');
      return token ? { Authorization: 'Bearer ' + token } : {};
    }

    function formatTime(value) {
      if (!value) return '-';
      return new Intl.DateTimeFormat('en', {
        timeZone: ${JSON.stringify(workspaceTimeZone)},
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).format(new Date(value));
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function renderCollector(status) {
      const pill = document.getElementById('statusPill');
      pill.textContent = status.state.toUpperCase();
      pill.className = 'status-pill neutral';
      if (status.state === 'ready') pill.className = 'status-pill';
      if (['starting', 'browser-launching', 'whatsapp-loading', 'waiting-for-qr', 'qr-ready', 'authenticated'].includes(status.state)) {
        pill.className = 'status-pill warn';
      }
      if (status.state === 'failed') pill.className = 'status-pill danger';

      document.getElementById('connectedAccount').textContent = status.connectedAccount || '-';
      document.getElementById('sessionPath').textContent = status.sessionPath || '-';
      document.getElementById('lastEventAt').textContent = formatTime(status.lastEventAt);
      document.getElementById('lastMessageAt').textContent = formatTime(status.lastMessageAt);
      document.getElementById('lastQrAt').textContent = formatTime(status.lastQrAt);
      document.getElementById('collectorInfo').textContent = status.info || '-';
    }

    function renderOverview(overview) {
      document.getElementById('overviewDateLabel').textContent = 'Date: ' + overview.date;
      document.getElementById('imagesReceived').textContent = overview.imageTotals.received;
      document.getElementById('slotsOnTime').textContent = overview.slotTotals.RECEIVED_ON_TIME;
      document.getElementById('slotsLate').textContent = overview.slotTotals.RECEIVED_LATE;
      document.getElementById('slotsMissing').textContent = overview.slotTotals.MISSING;
      document.getElementById('slotsDuplicate').textContent = overview.slotTotals.DUPLICATE;
      document.getElementById('alertsOpen').textContent = overview.alerts.unresolved;

      const recentImages = document.getElementById('recentImages');
      if (!overview.recentImages.length) {
        recentImages.innerHTML = '<div class="empty">No images received for this day yet.</div>';
        return;
      }

      recentImages.innerHTML = overview.recentImages.map((image) => \`
        <div class="card">
          <div class="label">\${escapeHtml(image.siteCode)} • \${escapeHtml(image.status)}</div>
          <div style="font-weight:700;">\${escapeHtml(image.senderName || 'Unknown sender')}</div>
          <div class="subtle">\${escapeHtml(formatTime(image.sentAt))}</div>
        </div>
      \`).join('');
    }

    function renderGroups(groups) {
      const wrap = document.getElementById('groupsWrap');
      if (!groups.length) {
        wrap.innerHTML = '<div class="empty">No WhatsApp groups are visible yet. Once the linked account is ready, refresh this page.</div>';
        return;
      }

      wrap.innerHTML = \`
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>WhatsApp Group Id</th>
              <th>Unread</th>
              <th>Read Only</th>
            </tr>
          </thead>
          <tbody>
            \${groups.map((group) => \`
              <tr>
                <td><strong>\${escapeHtml(group.name)}</strong></td>
                <td class="mono">\${escapeHtml(group.id)}</td>
                <td>\${escapeHtml(group.unreadCount)}</td>
                <td>\${group.isReadOnly ? 'Yes' : 'No'}</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      \`;
    }

    function buildOptions(selectedId) {
      const options = ['<option value="">No exact mapping</option>'];
      for (const group of state.groups) {
        const selected = group.id === selectedId ? 'selected' : '';
        options.push(\`<option value="\${escapeHtml(group.id)}" \${selected}>\${escapeHtml(group.name)} • \${escapeHtml(group.id)}</option>\`);
      }
      return options.join('');
    }

    function renderMappings() {
      const wrap = document.getElementById('mappingWrap');
      if (!state.patrolGroups.length) {
        wrap.innerHTML = '<div class="empty">No patrol groups found yet.</div>';
        return;
      }

      wrap.innerHTML = \`
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>Patrol Group</th>
              <th>Current Exact Mapping</th>
              <th>Choose Live WhatsApp Group</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            \${state.patrolGroups.map((group) => \`
              <tr>
                <td><strong>\${escapeHtml(group.site?.siteCode || '-')}</strong><div class="subtle">\${escapeHtml(group.site?.siteName || '')}</div></td>
                <td><strong>\${escapeHtml(group.groupName)}</strong></td>
                <td class="mono">\${escapeHtml(group.externalGroupId || 'Not set')}</td>
                <td>
                  <select id="map-\${escapeHtml(group.id)}">
                    \${buildOptions(group.externalGroupId)}
                  </select>
                </td>
                <td>
                  <button class="accent" onclick="saveMapping('\${escapeHtml(group.id)}')">Save Mapping</button>
                </td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
        <div class="hint">If exact mapping is blank, the pilot fallback from <span class="mono">WHATSAPP_PILOT_GROUP_NAME</span> and <span class="mono">WHATSAPP_PILOT_SITE_CODE</span> can still route images.</div>
      \`;
    }

    function renderSites(rows) {
      const wrap = document.getElementById('siteWrap');
      if (!rows.length) {
        wrap.innerHTML = '<div class="empty">No active sites are available for this day.</div>';
        return;
      }

      wrap.innerHTML = \`
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>Images</th>
              <th>On Time</th>
              <th>Late</th>
              <th>Missing</th>
              <th>Duplicate</th>
              <th>Alerts</th>
              <th>Latest Image</th>
            </tr>
          </thead>
          <tbody>
            \${rows.map((row) => \`
              <tr>
                <td><strong>\${escapeHtml(row.siteCode)}</strong><div class="subtle">\${escapeHtml(row.siteName)}</div></td>
                <td>\${escapeHtml(row.imagesReceived)}</td>
                <td>\${escapeHtml(row.slotsOnTime)}</td>
                <td>\${escapeHtml(row.slotsLate)}</td>
                <td>\${escapeHtml(row.slotsMissing)}</td>
                <td>\${escapeHtml(row.slotsDuplicate)}</td>
                <td>\${escapeHtml(row.unresolvedAlerts)}</td>
                <td class="mono">\${escapeHtml(formatTime(row.latestImageAt))}</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      \`;
    }

    async function saveMapping(groupId) {
      const select = document.getElementById('map-' + groupId);
      const current = state.patrolGroups.find((item) => item.id === groupId);
      await fetchJson('/patrol-groups/' + groupId, {
        method: 'PATCH',
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          siteId: current.siteId,
          groupName: current.groupName,
          active: current.active,
          externalGroupId: select.value || undefined,
        }),
      });
      toast('Mapping saved');
      await refreshAll();
    }

    async function refreshAll() {
      try {
        const authHeaders = buildAuthHeaders();
        const [status, groups, patrolGroups, overview, sites] = await Promise.all([
          fetchJson('/collectors/whatsapp/status', { headers: authHeaders }),
          fetchJson('/collectors/whatsapp/groups', { headers: authHeaders }),
          fetchJson('/patrol-groups', { headers: authHeaders }),
          fetchJson('/dashboard/overview?date=' + encodeURIComponent(state.date), { headers: authHeaders }),
          fetchJson('/dashboard/sites?date=' + encodeURIComponent(state.date), { headers: authHeaders }),
        ]);

        state.groups = groups;
        state.patrolGroups = patrolGroups;

        renderCollector(status);
        renderGroups(groups);
        renderMappings();
        renderOverview(overview);
        renderSites(sites);
      } catch (error) {
        toast(error.message || 'Unable to load ops console');
      }
    }

    window.saveMapping = saveMapping;
    refreshAll();
    setInterval(refreshAll, 15000);
  </script>
</body>
</html>`;
  }
}
