export const COMMERCIAL_EXPIRED_DOWNLOAD_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow,noarchive">
    <title>Licence download link expired | PatrolSafe by S4</title>
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
        <h1>This licence download link has expired</h1>
        <div class="notice" role="status">
          <strong>For your security, licence download links expire after 24 hours.</strong>
        </div>
        <p class="valid">Your purchase and licence remain valid.</p>
        <p>Please contact PatrolSafe Support to request a new secure download link.</p>
        <p>You can now close this window.</p>
      </section>
    </main>
  </body>
</html>`;
