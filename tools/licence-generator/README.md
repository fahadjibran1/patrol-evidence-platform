# Offline licence generator (operator workstation)

Loads a `.tgreq` request file and signs a `.tglic` commercial licence with an **external** Ed25519 private key.

## Security

- Set `LICENSE_PRIVATE_KEY_FILE` to a path **outside** this repository’s `dist/`, `out/`, and `resources/` folders.
- Never copy the private key into the customer application package.
- The desktop app only ships `resources/license-public.pem`.

## Usage

```bash
npm --prefix packages/license-core run build
set LICENSE_PRIVATE_KEY_FILE=C:\secure\keys\license-private.pem
node tools/licence-generator/generate-licence.js --request customer.tgreq --plan annual --out customer.tglic
```

Plans: `annual`, `three_year`, `lifetime`.
