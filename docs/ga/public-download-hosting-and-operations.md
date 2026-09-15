# PatrolSafe public download hosting and operations

Status: **DESIGN RECOMMENDATION — NOT IMPLEMENTED OR AUTHORIZED**

## Recommendation

Use a dedicated Vesoft-owned Azure Storage account for immutable release objects, fronted by Azure Front Door on an S4-controlled HTTPS hostname. Keep release upload credentials and the origin private; expose only explicitly approved versioned objects through Front Door.

Recommended customer URL:

`https://downloads.sfour.co.uk/patrolsafe/v1.0.0/PatrolEvidencePlatformSetup.exe`

Adjacent checksum:

`https://downloads.sfour.co.uk/patrolsafe/v1.0.0/SHA256SUMS.txt`

The v1.0.0 object must never be overwritten. A corrected binary is v1.0.1 at a new path.

The certified v1.0.0 binary is not currently authorized for this public path because `GA-DIST-01` is open. The URLs are architecture examples only; deploy the new certified version/hash selected after that blocker closes.

## Architecture comparison

| Option | Strengths | Risks/limits | Assessment |
|---|---|---|---|
| Website static artifact | Simple and low operational overhead at low volume | Deployment systems may replace assets, large binaries can exceed hosting/build limits, origin and website failures are coupled | Viable only after host size, bandwidth, immutability and rollback controls are proven |
| Azure Blob Storage + Front Door | Vesoft-controlled object store; scalable delivery; custom TLS domain; origin and website separated; blob versioning/WORM options; clear withdrawal control | New production resources, RBAC, cost monitoring and operational runbook required | **RECOMMENDED** |
| Generic file-sharing link | Fast to create | Link mutation, provider UI, access ambiguity, weak version association and unsuitable permanent URL | Not acceptable as permanent public distribution |

Azure supports version-level immutable blob policies, while Azure Front Door provides a custom HTTPS edge for Blob origins. See [Azure immutable blob storage](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-version-level-worm-policies) and [Azure Front Door with Blob Storage](https://learn.microsoft.com/en-us/azure/frontdoor/scenario-storage-blobs).

## Required controls

1. Separate release storage from support-transfer and customer-data storage.
2. Use least-privilege Entra/RBAC roles; no shared public write credentials.
3. Keep the origin container private and permit public acquisition through the approved Front Door route rather than enabling broad container listing.
4. Enable versioning and evaluate a locked retention/WORM period long enough to protect released bytes while preserving the ability to withdraw customer access at the edge.
5. Upload only after independent hash/signature verification and dual-person release approval.
6. Set `Content-Type: application/vnd.microsoft.portable-executable` or a tested safe download type, `Content-Disposition: attachment`, and a fixed filename.
7. Publish exact size, SHA-256, version, publisher and timestamp alongside the download.
8. Configure HTTPS-only, a managed certificate, modern TLS, health monitoring and cost/bandwidth alerts.
9. Make the versioned path immutable; never reuse it for different bytes.
10. Exercise disable/withdraw, cache purge and restoration before launch.
11. Preserve the certified object, manifest and logs outside the live serving path.

## Logging and privacy

Start without marketing tags or in-app telemetry. If standard Front Door/Storage access logs are enabled, restrict access and retention. Aggregate request time, path/version, status and volume. Do not log URL secrets, device fingerprints, installation IDs or evidence. Coarse country/region analytics must be separately approved and reflected in the Privacy Notice before use.

## Release operation

1. Stage the certified artifact in a private release area.
2. Verify exact SHA-256 and Authenticode independently.
3. Upload once to the new versioned object key.
4. Read the object back through the final HTTPS URL and verify hash, size, content type and signature.
5. Publish the adjacent checksum and customer documentation links.
6. Record production URL, ETag/blob version, verification time and approvers.
7. Enable the website CTA only after the publication register authorizes it.

## Withdrawal

Disable the Front Door route/website CTA, purge edge cache if necessary, and leave the certified origin object unchanged. Continue support for installed users. Do not point the v1.0.0 URL to new bytes. A fixed build follows the full v1.0.1 release process.
