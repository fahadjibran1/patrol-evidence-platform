interface CommercialDownloadPageCopy {
  title: string;
  notice: string;
  assurance: string;
  guidance: string;
}

function commercialDownloadPage(copy: CommercialDownloadPageCopy): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow,noarchive">
    <title>${copy.title} | PatrolSafe by S4</title>
    <style>
      :root { color-scheme: dark; font-family: "Segoe UI", Inter, system-ui, sans-serif; color: #e8eef6; background: #0b1220; }
      * { box-sizing: border-box; }
      body { margin: 0; min-width: 320px; min-height: 100vh; background: radial-gradient(circle at 10% 0%, rgba(99,102,241,.14), transparent 30%), radial-gradient(circle at 90% 10%, rgba(56,189,248,.1), transparent 28%), linear-gradient(180deg, #0b1220 0%, #0f172a 50%, #111827 100%); }
      main { min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; }
      section { width: min(620px, 100%); padding: 2rem; border-radius: 20px; background: rgba(17,24,39,.92); border: 1px solid rgba(148,163,184,.18); box-shadow: 0 18px 48px rgba(0,0,0,.42); }
      .eyebrow { color: #818cf8; font-size: .78rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: .25rem 0 1rem; line-height: 1.15; }
      p { color: #cbd5e1; line-height: 1.6; }
      .notice { margin: 1.25rem 0; padding: 1rem; border-radius: 12px; border: 1px solid rgba(251,191,36,.35); background: rgba(245,158,11,.1); }
      .notice strong { color: #fef3c7; }
      .valid { color: #d1fae5; font-weight: 650; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <p class="eyebrow">PatrolSafe by S4</p>
        <h1>${copy.title}</h1>
        <div class="notice" role="status"><strong>${copy.notice}</strong></div>
        <p class="valid">${copy.assurance}</p>
        <p>${copy.guidance}</p>
        <p>You can now close this window.</p>
      </section>
    </main>
  </body>
</html>`;
}

export const COMMERCIAL_EXPIRED_DOWNLOAD_PAGE = commercialDownloadPage({
  title: 'This licence download link has expired',
  notice: 'For your security, licence download links expire after 24 hours.',
  assurance: 'Your purchase and licence remain valid.',
  guidance: 'Please contact PatrolSafe Support to request a new secure download link.',
});

export const COMMERCIAL_INVALID_DOWNLOAD_PAGE = commercialDownloadPage({
  title: 'This licence download link is not valid',
  notice: 'The link may be incomplete or may no longer be available.',
  assurance: 'No licence file has been downloaded.',
  guidance: 'Please use the complete link from your licence email or contact PatrolSafe Support.',
});
