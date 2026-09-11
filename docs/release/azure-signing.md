# Azure signing integration point

PatrolSafe by S4 is currently packaged unsigned. The legal publisher for the production
certificate must be **Vesoft Services Limited**.

Electron Forge now exposes one signing insertion point through the
`PATROLSAFE_WINDOWS_SIGN_HOOK` environment variable. When set, its value must be the absolute
path to a trusted local JavaScript module exporting the `@electron/windows-sign` hook function.
Forge passes that hook to both Electron Packager and Maker Squirrel. No Azure credentials,
account identifiers, certificate profile names, or secrets belong in this repository.

The release signing job must:

1. authenticate to Azure Trusted Signing using the release pipeline's managed identity or
   secret store;
2. verify that the selected certificate identity is Vesoft Services Limited;
3. sign the packaged application EXE and applicable DLL/native `.node` binaries;
4. sign Squirrel's `Update.exe`/uninstall machinery and the final Setup EXE;
5. apply a trusted RFC 3161 timestamp;
6. verify every required signature and publisher identity before publishing `RELEASES`, NuGet
   packages, or the installer.

The unsigned Phase 10D artifact is for branding and packaging verification only. It must not be
distributed as the production release.
