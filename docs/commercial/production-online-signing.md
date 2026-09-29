# Production online licence signing

## Trust identities

- `vesoft-offline-v1` remains the packaged legacy production public key. Existing valid manual/offline licences continue to verify.
- `vesoft-online-v1` is the first production online commercial issuer. It is public metadata, not secret material.
- `test-phase6-online-key` remains staging-only. Production API configuration and production desktop packages reject it.

Commercial `.tglic` files do not download trust dynamically. Verification tries only the explicitly packaged trust-ring entries, applies the entry policy after a valid signature is found, and rejects signatures from unknown keys. Signature integrity, annual-product policy, expiry, installation ID, and machine fingerprint checks remain mandatory.

## Initial provider contract

The initial low-volume adapter is `secret-file-ed25519-v1`. It implements the existing signing-provider interface so it can later be replaced by a managed/HSM adapter without changing the licence payload or signature contract.

Production live mode requires all of:

- `COMMERCIAL_PRODUCTION_SIGNING_PROVIDER=secret-file-ed25519-v1`
- `COMMERCIAL_PRODUCTION_SIGNING_KEY_ID=vesoft-online-v1`
- `COMMERCIAL_PRODUCTION_SIGNING_PRIVATE_KEY_FILE=/etc/secrets/patrolsafe-production-ed25519-private.pem`
- `COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256=<authorised uppercase/lowercase 64-hex SHA-256 of public SPKI DER>`

There is no default fingerprint. Placeholder, staging, test-key, wrong-path, malformed, non-Ed25519, unreadable, or mismatched configuration fails production startup. The provider signs only after preflight and independently verifies each signature before returning it. It never exposes private key material to callers.

Safe startup evidence is limited to provider ID, key ID, public SPKI fingerprint, validation booleans, and PASS/FAIL. PEM or secret values must never be logged.

## Desktop production build contract

A production Windows build must set:

- `PATROLSAFE_COMMERCIAL_PRODUCTION_BUILD=true`
- `PATROLSAFE_PRODUCTION_ONLINE_PUBLIC_KEY_FILE=<authorised public-only Ed25519 PEM outside the repository>`
- `PATROLSAFE_PRODUCTION_ONLINE_PUBLIC_KEY_SHA256=<authorised 64-hex SPKI fingerprint>`

The packager verifies the supplied public key and fingerprint, packages it as `license-online-public.pem`, and writes a public production runtime manifest bound to `https://licensing.sfour.co.uk` and `vesoft-online-v1`. Packaged startup re-verifies that manifest and fingerprint. Staging and production manifests cannot coexist. A normal production package trusts only `vesoft-offline-v1` and `vesoft-online-v1`; it rejects test and unknown IDs.

No production public key exists in source yet. Consequently a new production installer is required after the real key is generated, authorised, and supplied to the production build.

## Rotation

For a future `vesoft-online-v2`:

1. Generate and authorise v2 under the same controlled process.
2. Ship desktop releases that explicitly trust v1 and v2 while the issuer still signs with v1.
3. Confirm adoption of the overlapping trust release.
4. Switch new issuance to v2 only after supported clients trust v2.
5. Retain v1 public trust for existing unexpired licences unless a documented compromise decision requires revocation.

Trust remains packaged; there is no remote key download. Compromise response is to disable issuance, preserve audit evidence, revoke hosting access, authorise a replacement key, ship an updated explicit trust ring, and decide—under documented incident authority—whether affected licences require replacement.

## Initial storage and recovery

At initial low volume, a Render Secret File is acceptable when the service account is tightly restricted, deployment access is least-privilege, logs are reviewed, and the file is never copied into an image, repository, build artifact, environment dump, or desktop. A managed KMS/HSM is preferable when a realistically available service supports Ed25519 signing with acceptable cost and operations; migration requires only another provider adapter.

Before live activation, create at least two encrypted offline backups of the private key on separately controlled media. Protect them with strong independent encryption, record custodians and access, and prohibit plaintext repository, ticket, email, chat, or ordinary cloud-drive copies. Verify backup fingerprints against the authorised public SPKI fingerprint, conduct and record a restoration/preflight test in an isolated recovery environment, then return restored plaintext to secure disposal. Loss triggers recovery; suspected exposure triggers immediate issuance disablement and the compromise/rotation procedure—not silent restoration.

## Real-key authorisation runbook (later)

1. On a controlled offline workstation, generate one Ed25519 keypair with an approved cryptographic tool; never generate it in CI or chat.
2. Export the private key as PKCS#8 PEM and public key as SPKI PEM.
3. Calculate SHA-256 over the public key's SPKI DER and independently verify it twice.
4. Record an approval linking `vesoft-online-v1`, the public PEM, and that fingerprint. Confirm it differs from the staging fingerprint.
5. Create encrypted offline recovery copies and perform the restoration test described above.
6. Add only the private PEM as the Render Secret File at `/etc/secrets/patrolsafe-production-ed25519-private.pem`.
7. Set the four production variables above, with the authorised fingerprint; do not enable `PRODUCTION_LIVE` yet.
8. Supply only the authorised public PEM and fingerprint to the controlled production Windows build, then verify the package contains both production public keys and no test/private keys.
9. Deploy the production service while commercial mode remains disabled, then enable live mode only after all other production gates and controlled end-to-end UAT are approved.
