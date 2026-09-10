import { readFileSync } from 'fs';
import * as path from 'path';

describe('bounded certification live-ingestion gate contract', () => {
  const helper = readFileSync(path.join(process.cwd(), 'src', 'collectors', 'whatsapp-helper.main.ts'), 'utf8');
  const service = readFileSync(path.join(process.cwd(), 'src', 'collectors', 'whatsapp-collector.service.ts'), 'utf8');
  const controller = readFileSync(path.join(process.cwd(), 'src', 'collectors', 'collectors.controller.ts'), 'utf8');
  const types = readFileSync(path.join(process.cwd(), 'src', 'collectors', 'whatsapp-helper.types.ts'), 'utf8');

  it('defines an explicit arm/disarm protocol and safe status projection', () => {
    expect(types).toContain("type: 'arm-certification-live-ingestion'");
    expect(types).toContain("type: 'disarm-certification-live-ingestion'");
    expect(types).toContain("type: 'certification-live-ingestion-status'");
    expect(controller).toContain("@Post('certification/live-ingestion/arm')");
    expect(controller).toContain("@Post('certification/live-ingestion/disarm')");
  });

  it('enforces both certification factors, readiness, account binding and exact mapping', () => {
    expect(service).toContain('isQrOnlyCertificationMode()');
    expect(service).toContain("certificationAuthorizationState !== 'AUTHENTICATION_AUTHORIZED'");
    expect(service).toContain('resolveActiveLinkedAccountId');
    expect(service).toContain('findActiveCertificationMappings');
    expect(service).toContain('matchingMappings.length !== 1');
    expect(controller).toContain('targetSiteId?: string');
    expect(helper).toContain("qrOnlyCertificationGuard.currentState !== 'AUTHENTICATION_AUTHORIZED'");
    expect(helper).toContain('status.connectedAccount !== command.linkedAccountId');
    expect(helper).toContain('exact-mapping-not-present');
  });

  it('arms exactly one item and does not persist armed state', () => {
    expect(service).toContain('budgetRemaining: 0');
    expect(helper).toContain('budgetRemaining: 1');
    expect(helper).toContain("disarmCertificationLiveIngestion('accepted-item')");
    expect(helper).toContain("disarmCertificationLiveIngestion('listener-reset')");
    expect(service).toContain('this.certificationLiveIngestion = {');
  });

  it('filters account and source before media processing', () => {
    expect(helper).toContain('status.connectedAccount === certificationLiveGate.linkedAccountId');
    expect(helper).toContain('previewSource.externalId === certificationLiveGate.sourceExternalId');
    expect(helper).toContain('certification-live-message-rejected');
    const dispatchStart = helper.indexOf('async function dispatchLiveMessage');
    const dispatchEnd = helper.indexOf('function clearReadyHeartbeat', dispatchStart);
    const dispatchBody = helper.slice(dispatchStart, dispatchEnd);
    expect(dispatchBody.indexOf('certification-live-message-rejected')).toBeLessThan(dispatchBody.indexOf('processMessage(message'));
  });

  it('requires a canonical live message id and coalesces duplicate callbacks before download', () => {
    const dispatchStart = helper.indexOf('async function dispatchLiveMessage');
    const dispatchEnd = helper.indexOf('function clearReadyHeartbeat', dispatchStart);
    const dispatchBody = helper.slice(dispatchStart, dispatchEnd);
    expect(dispatchBody).toContain('normalizeCanonicalWhatsAppMessageId(message)');
    expect(dispatchBody).toContain('canonical-message-id-unavailable');
    expect(dispatchBody).toContain('runCanonicalMessageOperationOnce');
    expect(dispatchBody.indexOf('runCanonicalMessageOperationOnce')).toBeLessThan(
      dispatchBody.indexOf('processMessage(message'),
    );
  });

  it('keeps unsupported media and non-media out of evidence and preserves validation', () => {
    expect(helper).toContain('rejectedUnsupportedMediaCount');
    expect(helper).toContain("!media.mimetype?.startsWith('image/')");
    expect(helper).toContain('await postIngest(normalized)');
    expect(helper).toContain('acceptedItemCount += 1');
  });

  it('does not enable discovery, backfill, or sending as part of arming', () => {
    const armStart = helper.indexOf("command.type === 'arm-certification-live-ingestion'");
    const armEnd = helper.indexOf("command.type === 'disarm-certification-live-ingestion'", armStart);
    const armBody = helper.slice(armStart, armEnd);
    expect(armBody).not.toContain('runBackfill');
    expect(armBody).not.toContain('refreshDiscoveredChats');
    expect(armBody).not.toContain('sendMessage');
    expect(armBody).toContain('attachLiveMediaListenersOnce(client)');
  });

  it('uses the existing three-event live listener set only while armed', () => {
    expect(helper).toContain("target.on('message', onClientMessageReceived)");
    expect(helper).toContain("target.on('message_create', onClientMessageCreated)");
    expect(helper).toContain("target.on('media_uploaded', onClientMediaUploaded)");
    expect(helper).toContain('listenerCount: liveMediaListenersAttached ? 3 : 0');
  });

  it('keeps certification idle listener-free until explicit arm', () => {
    const readyStart = helper.indexOf('async function finalizeClientReady');
    const readyEnd = helper.indexOf('async function watchClientInfoAfterAuthentication', readyStart);
    const readyBody = helper.slice(readyStart, readyEnd);
    expect(readyBody).toContain('resetLiveMessageListenerState()');
    expect(readyBody).toContain('CONNECTED_CERTIFICATION_IDLE');
    expect(readyBody.indexOf("if (isQrOnlyCertificationMode())")).toBeLessThan(
      readyBody.indexOf('attachLiveMediaListenersOnce(currentClient)'),
    );
  });

  it('supports idempotent disarm and removes listeners', () => {
    expect(helper).toContain("command.type === 'disarm-certification-live-ingestion'");
    expect(helper).toContain("disarmCertificationLiveIngestion('explicit-command')");
    expect(helper).toContain('detachLiveMediaListeners(client)');
    expect(service).toContain('disarmCertificationLiveIngestion()');
  });

  it('exposes only bounded counters, never message or participant payloads', () => {
    expect(types).toContain('rejectedUnapprovedSourceCount');
    expect(types).toContain('rejectedUnsupportedMediaCount');
    expect(types).not.toContain('messageBody:');
    expect(types).not.toContain('participants:');
  });
});
