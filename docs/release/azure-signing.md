# PatrolSafe Azure Artifact Signing

PatrolSafe by S4 Windows release candidates are signed by Microsoft Azure Artifact Signing.
The legal publisher is **Vesoft Services Limited**. Signing is a release operation; ordinary
developer package builds remain unsigned.

## Certified Azure architecture

- Subscription: `Azure subscription 1`
- Resource group: `rg-vesoft-signing-prod`
- Artifact Signing account: `vesoft-signing-prod` (Basic, North Europe)
- Certificate profile: `vesoft-public-trust` (`PublicTrust`)
- Endpoint: `https://neu.codesigning.azure.net/`
- Expected subject: `CN=Vesoft Services Limited, O=Vesoft Services Limited`
- Digest: SHA-256
- Timestamp service: `http://timestamp.acs.microsoft.com/`

Account and profile names are deployment coordinates, not credentials. Do not store tokens,
client secrets, passwords, private keys, or exported certificates in this repository.

## Supported local toolchain

Use Microsoft's Artifact Signing Client Tools, an x64 Windows SDK SignTool newer than
`10.0.2261.755`, and .NET 8 or later. Install the client tools with:

```powershell
winget install -e --id Microsoft.Azure.ArtifactSigningClientTools
```

The Phase 10G certification used Azure CLI 2.90.0, Artifact Signing Client Tools 0.1.128,
`Azure.CodeSigning.Dlib.dll` 1.0.119.0, and Windows SDK SignTool 10.0.26100.0.

## Interactive private RC

Authenticate with the authorized release operator identity:

```powershell
az login
az account set --subscription "Azure subscription 1"
npm run release:windows:signed-rc
```

`scripts/artifact-signing-hook.js` invokes SignTool with the Artifact Signing Dlib. Its temporary
metadata selects only `AzureCliCredential`; it contains resource coordinates and a correlation ID,
never an access token. The temporary file is removed when the signing process exits.

## Signing order and fail-closed behavior

1. Forge builds the final packaged application and applies Windows version/icon resources.
2. Electron Packager signs every shipped EXE, DLL, and native `.node` binary.
3. The post-package runtime completeness check runs. Any copied PE is caught by final verification.
4. Maker Squirrel copies the signed application, creates and icons its Squirrel/update executable,
   builds the full NuGet package, and signs the final Setup executable through the same hook.
5. `scripts/verify-windows-signatures.ps1` verifies the final packaged tree, Setup EXE, and every PE
   extracted from the full `.nupkg`, including Squirrel/update machinery.
6. Verification requires a valid Vesoft Services Limited signature and timestamp, runs
   `signtool verify /pa /all /v`, rejects forensic runtime directories, and writes the private RC
   hash manifest.

`PATROLSAFE_WINDOWS_RELEASE=rc|release|production|commercial` without
`PATROLSAFE_WINDOWS_SIGN_HOOK` stops Forge configuration immediately. The signed-RC runner also
stops on any build, signing, or verification error. This post-make verification is essential because
the installed `@electron/windows-sign` hook adapter logs individual hook failures without reliably
propagating all of them.

The generated manifest is `out/private-rc-verification-manifest.json`. It records SHA-256, size,
version metadata, signer, and timestamp status. `out/` is ignored and must not be committed.

## Verification and common failures

Run verification independently after make:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows-signatures.ps1 `
  -OutRoot .\out -RequireInstaller
```

The verifier is compatible with the inbox Windows PowerShell 5.1 release environment; it does not
require PowerShell 7 for relative-path handling. Its path-policy self-test can be run independently:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows-signatures.ps1 -SelfTest
```

For a single-file fail-closed check, pass `-VerifyFile <path>`. The same publisher, timestamp, and
SignTool policy is applied, and missing, unsigned, or differently published files fail non-zero.

Common failures:

- `WINDOWS_RELEASE_SIGNING_REQUIRED`: an RC/release build omitted the signing hook.
- `AZURE_ARTIFACT_SIGNING_FAILED`: inspect Azure CLI login, profile-signer RBAC, region endpoint,
  timestamp connectivity, and certificate profile status. Do not fall back to unsigned output.
- `SIGNATURE_WRONG_PUBLISHER`: stop; never publish under an unexpected subject.
- `SIGNATURE_TIMESTAMP_MISSING`: stop; Artifact Signing certificates are short-lived.
- `RELEASE_*_CONTAINS_FORENSIC_RUNTIME`: local diagnostic data entered the package; stop and clean
  the build configuration, not the preserved source data.

## Certificate lifecycle and emergency response

Artifact Signing rotates short-lived certificates within the active profile. Before each release,
confirm the profile is Active and its subject remains Vesoft Services Limited. If identity or profile
renewal is required, complete it through the controlled Azure process and re-run a private RC.

For suspected signing compromise, stop releases, revoke release-operator access and/or the affected
federated credential, review Artifact Signing transactions, and revoke the certificate profile where
Microsoft guidance requires it. Do not create replacement long-lived secrets.

## SmartScreen

Authenticode validity and Microsoft Defender SmartScreen reputation are separate. A new valid public
trust identity can still receive reputation prompts until reputation develops. Do not disable or ask
customers to bypass SmartScreen.

## Future CI/CD design

Use a dedicated release workflow with GitHub Actions OIDC/workload identity federation and the
official Microsoft Artifact Signing action, scoped to the certificate profile signer role. Use
short-lived tokens, protected environments, approvals, immutable source commits, and post-signature
verification. Do not create client secrets or broaden RBAC as part of this local certification.
