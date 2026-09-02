import type { LicenceIssuedTemplateData } from '../dto/send-email.dto';
import { escapeHtml, renderBaseTemplate, type RenderedNotificationTemplate } from './base.template';

export function buildDefaultLicenceIssuedSubject(licenseId: string): string {
  return `Your Patrol Evidence Platform Licence – ${licenseId}`;
}

export function buildLicenceActivationInstructions(): string {
  return [
    '1. Open Patrol Evidence Platform.',
    '2. Go to Licence.',
    '3. Select Import licence file.',
    '4. Choose the attached .lic file.',
    '5. Confirm activation.',
    '6. Restart the application if requested.',
  ].join('\n');
}

export function renderLicenceIssuedTemplate(
  data: LicenceIssuedTemplateData,
): RenderedNotificationTemplate {
  const brand = data.companyBrandName?.trim() || 'Patrol Evidence Platform';
  const subject = buildDefaultLicenceIssuedTemplateSubject(data);
  const adminNoteHtml = data.adminNote?.trim()
    ? `<p style="margin:0 0 16px;">${escapeHtml(data.adminNote.trim())}</p>`
    : '';
  const adminNoteText = data.adminNote?.trim() ? `${data.adminNote.trim()}\n\n` : '';
  const featuresRow = data.featuresDisplay?.trim()
    ? `<tr><td style="padding:8px 0;color:#64748b;">Features</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(data.featuresDisplay.trim())}</td></tr>`
    : '';
  const featuresText = data.featuresDisplay?.trim() ? `Features:\n${data.featuresDisplay.trim()}\n\n` : '';

  const bodyHtml = `
    <p style="margin:0 0 16px;">Hello ${escapeHtml(data.contactName)},</p>
    ${adminNoteHtml}
    <p style="margin:0 0 16px;">Thank you for your purchase.</p>
    <p style="margin:0 0 16px;">Your Patrol Evidence Platform commercial licence has now been issued.</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td style="padding:8px 0;color:#64748b;width:160px;">Company</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(data.companyName)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Licence ID</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(data.licenseId)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Plan</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(data.plan)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Maximum devices</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(String(data.maxDevices))}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Valid from</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(data.startsAtDisplay)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Expiry</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(data.expiresAtDisplay)}</td></tr>
      ${featuresRow}
    </table>
    <p style="margin:0 0 16px;">Your licence file is attached as: <strong>${escapeHtml(data.attachmentFilename)}</strong></p>
    <p style="margin:0 0 8px;font-weight:600;">Activation</p>
    <pre style="margin:0 0 16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;white-space:pre-wrap;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:1.45;">${escapeHtml(data.activationInstructions)}</pre>
    <p style="margin:0 0 16px;">If you need assistance, contact: <a href="mailto:${escapeHtml(data.supportEmail)}">${escapeHtml(data.supportEmail)}</a></p>
    <p style="margin:0;color:#64748b;font-size:13px;">Store the attached licence file securely. The email body never includes the full commercial licence key.</p>
  `;

  const bodyText = [
    `Hello ${data.contactName},`,
    '',
    adminNoteText.trimEnd(),
    adminNoteText ? '' : null,
    'Thank you for your purchase.',
    '',
    'Your Patrol Evidence Platform commercial licence has now been issued.',
    '',
    `Company:\n${data.companyName}`,
    '',
    `Licence ID:\n${data.licenseId}`,
    '',
    `Plan:\n${data.plan}`,
    '',
    `Maximum devices:\n${data.maxDevices}`,
    '',
    `Valid from:\n${data.startsAtDisplay}`,
    '',
    `Expiry:\n${data.expiresAtDisplay}`,
    '',
    featuresText.trimEnd() || null,
    featuresText ? '' : null,
    `Your licence file is attached as:\n${data.attachmentFilename}`,
    '',
    'Activation:',
    data.activationInstructions,
    '',
    `If you need assistance, contact:\n${data.supportEmail}`,
    '',
    'Store the attached licence file securely. The email body never includes the full commercial licence key.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const rendered = renderBaseTemplate({
    headerTitle: subject,
    bodyHtml,
    bodyText,
    brandName: brand,
    signatureName: data.fromName || brand,
  });

  return {
    ...rendered,
    subject,
  };
}

function buildDefaultLicenceIssuedTemplateSubject(data: LicenceIssuedTemplateData): string {
  return buildDefaultLicenceIssuedSubject(data.licenseId);
}
