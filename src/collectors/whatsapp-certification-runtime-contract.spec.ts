import { readFileSync } from 'fs';
import * as path from 'path';

describe('WhatsApp QR-only certification runtime contract', () => {
  const helperSource = readFileSync(
    path.join(process.cwd(), 'src', 'collectors', 'whatsapp-helper.main.ts'),
    'utf8',
  );
  const supervisorSource = readFileSync(
    path.join(process.cwd(), 'src', 'collectors', 'whatsapp-collector.service.ts'),
    'utf8',
  );
  const controllerSource = readFileSync(
    path.join(process.cwd(), 'src', 'collectors', 'collectors.controller.ts'),
    'utf8',
  );

  function handlerBody(startMarker: string, endMarker: string): string {
    const start = helperSource.indexOf(startMarker);
    const end = helperSource.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return helperSource.slice(start, end);
  }

  it('guards authenticated before client-info watching or account discovery', () => {
    const body = handlerBody("nextClient.on('authenticated'", "nextClient.on('change_state'");
    expect(body.indexOf("stopForUnexpectedAuthentication('authenticated')")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("stopForUnexpectedAuthentication('authenticated')")).toBeLessThan(
      body.indexOf('watchClientInfoAfterAuthentication'),
    );
  });

  it('guards ready before listeners, chat discovery, backfill, ingestion, or sending', () => {
    const body = handlerBody("nextClient.on('ready'", "nextClient.on('disconnected'");
    expect(body.indexOf("stopForUnexpectedAuthentication('ready')")).toBeGreaterThanOrEqual(0);
    expect(body).not.toContain('attachLiveMediaListenersOnce');

    const finalizeStart = helperSource.indexOf('async function finalizeClientReady');
    const finalizeEnd = helperSource.indexOf('async function watchClientInfoAfterAuthentication', finalizeStart);
    const finalizeBody = helperSource.slice(finalizeStart, finalizeEnd);
    expect(finalizeBody.indexOf("stopForUnexpectedAuthentication('client-identity')")).toBeLessThan(
      finalizeBody.indexOf('resolveConnectedAccountWithRetry'),
    );
    expect(finalizeBody.indexOf("stopForUnexpectedAuthentication('client-identity')")).toBeLessThan(
      finalizeBody.indexOf('waitForPostAuthCompatibility'),
    );
    expect(finalizeBody.indexOf("stopForUnexpectedAuthentication('client-identity')")).toBeLessThan(
      finalizeBody.indexOf('refreshDiscoveredChats'),
    );
  });

  it('preserves LocalAuth by shutting down without logout or session deletion', () => {
    const start = helperSource.indexOf('function stopForUnexpectedAuthentication');
    const end = helperSource.indexOf('function canWriteToSessionPath', start);
    const body = helperSource.slice(start, end);
    expect(body).toContain('shutdown(2, { preserveTerminalState: true })');
    expect(body).not.toContain('.logout(');
    expect(body).not.toContain('fullyDestroyClientSession');
    expect(body).not.toContain('rmSync');
  });

  it('keeps normal stop separate from explicit account logout', () => {
    const commandStart = helperSource.indexOf("if (command.type === 'stop')");
    const commandEnd = helperSource.indexOf("if (command.type === 'authorize-certification-authentication')", commandStart);
    const commandBody = helperSource.slice(commandStart, commandEnd);
    expect(commandBody).toContain('shutdown(0)');
    expect(commandBody).not.toContain('operatorLogout');
    expect(commandBody).not.toContain('.logout(');

    const shutdownStart = helperSource.indexOf('async function shutdown');
    const shutdownEnd = helperSource.indexOf('function wireCommands', shutdownStart);
    const shutdownBody = helperSource.slice(shutdownStart, shutdownEnd);
    expect(shutdownBody).toContain("closeBrowserGracefully(currentClient, 'shutdown')");
    expect(shutdownBody).not.toContain('.logout(');
    expect(shutdownBody).not.toContain('rmSync');
  });

  it('finalizes compatibility before attaching ingestion listeners', () => {
    const finalizeStart = helperSource.indexOf('async function finalizeClientReady');
    const finalizeEnd = helperSource.indexOf('async function watchClientInfoAfterAuthentication', finalizeStart);
    const body = helperSource.slice(finalizeStart, finalizeEnd);
    expect(body.indexOf('waitForPostAuthCompatibility')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('setReadinessFinalized(true')).toBeLessThan(body.indexOf('attachLiveMediaListenersOnce'));
    expect(body).not.toContain('waitForChatDiscoveryReady');
  });

  it('does not use broad getChats serialization as the basic compatibility gate', () => {
    const probeStart = helperSource.indexOf('async function probePostAuthStoreCompatibility');
    const probeEnd = helperSource.indexOf('async function waitForPostAuthCompatibility', probeStart);
    const probeBody = helperSource.slice(probeStart, probeEnd);
    expect(probeBody).toContain('getModelsArray');
    expect(probeBody).not.toContain('currentClient.getChats()');
  });

  it('keeps the supervisor terminal and blocks automatic restart', () => {
    expect(supervisorSource).toContain('this.certificationTerminal = true');
    expect(supervisorSource).toContain('if (this.certificationTerminal)');
    expect(supervisorSource).toContain(
      'this.certificationTerminal || this.helperStatus.state === UNEXPECTED_AUTHENTICATION',
    );
  });

  it('centrally blocks every helper lifecycle callback after terminalization', () => {
    expect(helperSource).toContain('function blockAfterCertificationTerminal');
    for (const event of ['qr', 'authenticated', 'ready', 'auth_failure']) {
      expect(helperSource).toContain(`blockAfterCertificationTerminal('${event}')`);
    }
    expect(helperSource).toContain('blockAfterCertificationTerminal(`change_state:${state}`)');
    expect(helperSource).toContain('blockAfterCertificationTerminal(`disconnected:${reason}`)');
    expect(helperSource).toContain("blockAfterCertificationTerminal('watch-client-info')");
    expect(helperSource).toContain("blockAfterCertificationTerminal('attach-live-media-listeners')");
    expect(helperSource).toContain("blockAfterCertificationTerminal('refresh-discovered-chats')");
  });

  it('masks certification QR presentation until authorization is acknowledged', () => {
    expect(supervisorSource).toContain("this.certificationAuthorizationState !== 'AUTHENTICATION_AUTHORIZED'");
    expect(supervisorSource).toContain('qrCode: certificationQrMasked ? null : this.helperStatus.qrCode');
  });

  it('routes explicit authorization over the private helper command channel', () => {
    expect(controllerSource).toContain("@Post('certification/authorize-authentication')");
    expect(supervisorSource).toContain("type: 'authorize-certification-authentication'");
    expect(helperSource).toContain("command.type === 'authorize-certification-authentication'");
    expect(helperSource).toContain('qrOnlyCertificationGuard.authorizeAuthentication(true)');
    expect(helperSource).toContain('isQrOnlyCertificationMode()');
  });

  it('keeps authorization process-local and out of persistent stores', () => {
    const commandStart = helperSource.indexOf("command.type === 'authorize-certification-authentication'");
    const commandEnd = helperSource.indexOf("command.type === 'manual-backfill'", commandStart);
    const commandBody = helperSource.slice(commandStart, commandEnd);
    expect(commandBody).not.toContain('writeFileSync');
    expect(commandBody).not.toContain('LocalAuth');
    expect(commandBody).not.toContain('workspace');
    expect(commandBody).not.toContain('sqlite');
  });

  it('redacts supervisor log details throughout an active certification runtime', () => {
    expect(supervisorSource).toContain(
      'details && isQrOnlyCertificationMode() ? redactQrOnlyCertificationLog(details) : details',
    );
  });
});
