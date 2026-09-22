import type { SendCommercialLicenceEmailCommand } from './commercial-delivery-provider.port';

const escape = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export function renderCommercialLicenceEmail(command: Readonly<SendCommercialLicenceEmailCommand>) {
  const company = escape(command.companyName);
  const url = escape(command.downloadUrl);
  const text = [
    `Your PatrolSafe licence is ready for ${command.companyName}.`,
    '',
    'PatrolSafe Annual Licence - one Windows workstation',
    `Licence period: ${command.startsAt} to ${command.expiresAt}`,
    `Download your licence: ${command.downloadUrl}`,
    `This secure link expires at ${command.linkExpiresAt}.`,
    '',
    'To activate: open PatrolSafe, open Licence, then choose Activate supplied licence.',
    'If you need help, contact PatrolSafe support.',
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033"><h1>Your PatrolSafe licence is ready</h1><p>Your annual licence for <strong>${company}</strong> is ready.</p><p>One Windows workstation<br>Licence period: ${escape(command.startsAt)} to ${escape(command.expiresAt)}</p><p><a href="${url}" style="display:inline-block;padding:12px 18px;background:#164e63;color:#fff;text-decoration:none;border-radius:4px">Download licence</a></p><p>This secure link expires at ${escape(command.linkExpiresAt)}.</p><h2>Activate in PatrolSafe</h2><p>Open PatrolSafe, open <strong>Licence</strong>, then choose <strong>Activate supplied licence</strong>.</p><p>If you need help, contact PatrolSafe support.</p></body></html>`;
  return { subject: 'Your PatrolSafe licence is ready', text, html };
}
