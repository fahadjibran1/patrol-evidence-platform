export interface RenderedNotificationTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface BaseTemplateSections {
  headerTitle: string;
  bodyHtml: string;
  bodyText: string;
  footerNote?: string;
  signatureName?: string;
  brandName?: string;
}

export function renderBaseTemplate(sections: BaseTemplateSections): RenderedNotificationTemplate {
  const brand = sections.brandName?.trim() || 'Patrol Evidence Platform';
  const signature = sections.signatureName?.trim() || brand;
  const footer =
    sections.footerNote?.trim() ||
    'This message was sent by the Patrol Licence Administration Portal. Do not reply with licence keys.';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(sections.headerTitle)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;">
          <tr>
            <td style="padding:24px 28px;border-bottom:1px solid #e5e7eb;background:#0f172a;color:#ffffff;">
              <div style="font-size:13px;letter-spacing:0.04em;text-transform:uppercase;opacity:0.8;">${escapeHtml(brand)}</div>
              <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;">${escapeHtml(sections.headerTitle)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-size:15px;line-height:1.55;">
              ${sections.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;font-size:14px;line-height:1.5;color:#334155;">
              <p style="margin:0;">Kind regards,</p>
              <p style="margin:4px 0 0;font-weight:600;">${escapeHtml(signature)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;border-top:1px solid #e5e7eb;background:#f8fafc;font-size:12px;line-height:1.45;color:#64748b;">
              ${escapeHtml(footer)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    brand,
    sections.headerTitle,
    '',
    sections.bodyText.trim(),
    '',
    'Kind regards,',
    signature,
    '',
    footer,
    '',
  ].join('\n');

  return {
    subject: sections.headerTitle,
    html,
    text,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
