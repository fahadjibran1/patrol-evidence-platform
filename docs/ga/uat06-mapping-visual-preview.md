# GA-UAT-06 mapping workflow visual preview

This is a local, synthetic-data preview of the real PatrolSafe v1.0.2 React UI. It is **not** the signed installer or a packaged-runtime certification. The fixture uses Northstar Security Ltd, three existing sites, six active mappings, seven paused historical conflicts, and 120 synthetic discovered WhatsApp groups. It does not connect to WhatsApp, read customer data, or persist a database.

Use two PowerShell windows in `C:\Users\Admin\patrol-evidence-platform`:

Window 1:

```powershell
node scripts/preview-site-mapping-uat06.js
```

Window 2:

```powershell
$env:VITE_API_BASE_URL = 'http://127.0.0.1:43123'
npm --prefix web run build
npm --prefix web run preview -- --host 127.0.0.1 --port 43124
```

Open `http://127.0.0.1:43124/login` in a private browser window. Sign in using the preview button; no real credentials are required. In **Sites**, create a site such as `HQR — Harbour Quarter Offices`. Use its **Add WhatsApp group** action. The Setup Guide must focus on that new site even though other sites already have mappings. Search for `Northstar Patrol Group 120`, select the available result, and save the mapping. Configure the site's patrol schedule. The focused setup summary should then say **Ready for live monitoring**, with the site's group **Mapped**, schedule **Ready**, and Monitoring **Active**. Return to Sites and use **Manage WhatsApp groups** to inspect the same site's mapping again. The seven paused synthetic conflicts must remain inactive.

The synthetic API simulates active monitoring and successful mapping persistence in memory; backend reconciliation and three-listener behaviour are covered by automated tests, not this preview. Other pages may show incomplete fixture data. Do not use this preview as evidence of live WhatsApp or licensing behaviour.

Stop both local processes with Ctrl+C when finished. The preview build embeds a loopback API URL in ignored `web/dist`; restore an ordinary frontend build before other use:

```powershell
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
npm run frontend:build
```

No installer is built, signed, or published by these steps.
