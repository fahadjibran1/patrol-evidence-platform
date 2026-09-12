[CmdletBinding()]
param(
  [Parameter()]
  [string]$OutRoot,
  [Parameter()]
  [string]$ExpectedPublisher = 'Vesoft Services Limited',
  [Parameter()]
  [string]$ExpectedProductName = 'PatrolSafe by S4',
  [Parameter()]
  [string]$ManifestPath,
  [Parameter()]
  [switch]$RequireInstaller,
  [Parameter()]
  [switch]$SelfTest,
  [Parameter()]
  [string]$VerifyFile
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutRoot) {
  $OutRoot = Join-Path (Split-Path -Parent $scriptRoot) 'out'
}
if (-not $ManifestPath) {
  $ManifestPath = Join-Path $OutRoot 'private-rc-verification-manifest.json'
}

function Get-PatrolSafeRelativePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  $comparison = [System.StringComparison]::OrdinalIgnoreCase

  if ([string]::Equals($rootFull, $pathFull, $comparison)) {
    return '.'
  }

  $rootPrefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
  if (-not $pathFull.StartsWith($rootPrefix, $comparison)) {
    throw "RELATIVE_PATH_OUTSIDE_RELEASE_ROOT root=$rootFull path=$pathFull"
  }

  return $pathFull.Substring($rootPrefix.Length)
}

if ($SelfTest) {
  $selfTestRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'PatrolSafe Verifier Root'
  $rootFile = Join-Path $selfTestRoot 'root file.exe'
  $nestedFile = Join-Path $selfTestRoot 'nested folder\nested file.dll'
  $caseVariantRoot = $selfTestRoot.ToUpperInvariant()
  $outsideFile = Join-Path ([System.IO.Path]::GetTempPath()) 'outside.exe'

  if ((Get-PatrolSafeRelativePath -Root $selfTestRoot -Path $rootFile) -ne 'root file.exe') {
    throw 'RELATIVE_PATH_SELF_TEST_ROOT_FILE_FAILED'
  }
  if ((Get-PatrolSafeRelativePath -Root $selfTestRoot -Path $nestedFile) -ne 'nested folder\nested file.dll') {
    throw 'RELATIVE_PATH_SELF_TEST_NESTED_FILE_FAILED'
  }
  if ((Get-PatrolSafeRelativePath -Root $caseVariantRoot -Path $nestedFile) -ne 'nested folder\nested file.dll') {
    throw 'RELATIVE_PATH_SELF_TEST_CASE_FAILED'
  }

  $outsideRejected = $false
  try {
    Get-PatrolSafeRelativePath -Root $selfTestRoot -Path $outsideFile | Out-Null
  }
  catch {
    $outsideRejected = $_.Exception.Message -like 'RELATIVE_PATH_OUTSIDE_RELEASE_ROOT*'
  }
  if (-not $outsideRejected) {
    throw 'RELATIVE_PATH_SELF_TEST_OUTSIDE_ROOT_FAILED'
  }

  Write-Output 'WINDOWS_SIGNATURE_VERIFIER_SELF_TEST_OK cases=4'
  exit 0
}

$signTool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse |
  Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $signTool) {
  throw 'SIGNATURE_VERIFY_SIGNTOOL_MISSING'
}

function Assert-PatrolSafeAuthenticode {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$ArtifactPath
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "SIGNATURE_VERIFY_ARTIFACT_MISSING artifact=$ArtifactPath"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  $signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
  if ($signature.Status -ne 'Valid') {
    throw "SIGNATURE_INVALID artifact=$ArtifactPath status=$($signature.Status)"
  }
  if ($signerSubject -notmatch "(?:^|,\s*)(?:CN|O)=$([regex]::Escape($ExpectedPublisher))(?:,|$)") {
    throw "SIGNATURE_WRONG_PUBLISHER artifact=$ArtifactPath subject=$signerSubject"
  }
  if (-not $signature.TimeStamperCertificate) {
    throw "SIGNATURE_TIMESTAMP_MISSING artifact=$ArtifactPath"
  }

  & $signTool.FullName verify /pa /all /v $Path | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "SIGNTOOL_VERIFY_FAILED artifact=$ArtifactPath exit=$LASTEXITCODE"
  }

  return $signature
}

if ($VerifyFile) {
  Assert-PatrolSafeAuthenticode -Path $VerifyFile -ArtifactPath $VerifyFile | Out-Null
  Write-Output "WINDOWS_SIGNATURE_FILE_VERIFICATION_OK artifact=$VerifyFile"
  exit 0
}

$packageRoots = @(Get-ChildItem -LiteralPath $OutRoot -Directory |
  Where-Object { $_.Name -match 'win32-x64$' })
if ($packageRoots.Count -ne 1) {
  throw "SIGNATURE_VERIFY_PACKAGE_ROOT_COUNT expected=1 actual=$($packageRoots.Count)"
}
$packageRoot = $packageRoots[0].FullName

$forbiddenRuntime = @(Get-ChildItem -LiteralPath $packageRoot -Directory -Recurse -Force |
  Where-Object { $_.Name -like '.tmp-phase10e-runtime*' })
if ($forbiddenRuntime.Count -ne 0) {
  throw "RELEASE_ARTIFACT_CONTAINS_FORENSIC_RUNTIME count=$($forbiddenRuntime.Count)"
}

$makeRoot = Join-Path $OutRoot 'make'
$setupFiles = @(Get-ChildItem -LiteralPath $makeRoot -Filter '*.exe' -Recurse -File -ErrorAction SilentlyContinue)
$nupkgFiles = @(Get-ChildItem -LiteralPath $makeRoot -Filter '*-full.nupkg' -Recurse -File -ErrorAction SilentlyContinue)
if ($RequireInstaller -and ($setupFiles.Count -ne 1 -or $nupkgFiles.Count -ne 1)) {
  throw "SIGNATURE_VERIFY_INSTALLER_ARTIFACTS setup=$($setupFiles.Count) nupkg=$($nupkgFiles.Count)"
}

$temporaryExtractRoot = Join-Path ([System.IO.Path]::GetTempPath()) "patrolsafe-nupkg-verify-$PID"
$records = [System.Collections.Generic.List[object]]::new()

function Add-ManifestRecord {
  param(
    [string]$Path,
    [string]$ArtifactPath,
    [bool]$RequireSignature
  )

  $item = Get-Item -LiteralPath $Path
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  $signatureStatus = 'NotApplicable'
  $signerSubject = $null
  $signerIssuer = $null
  $timestampStatus = 'NotApplicable'
  $timestampSubject = $null

  if ($RequireSignature) {
    $signature = Assert-PatrolSafeAuthenticode -Path $Path -ArtifactPath $ArtifactPath
    $signatureStatus = [string]$signature.Status
    $signerSubject = $signature.SignerCertificate.Subject
    $signerIssuer = $signature.SignerCertificate.Issuer
    $timestampSubject = $signature.TimeStamperCertificate.Subject
    $timestampStatus = 'Present'
  }

  $records.Add([ordered]@{
      artifact = $ArtifactPath.Replace('\', '/')
      sha256 = $hash
      size = $item.Length
      version = $item.VersionInfo.FileVersion
      productName = $item.VersionInfo.ProductName
      companyName = $item.VersionInfo.CompanyName
      signatureStatus = $signatureStatus
      signerSubject = $signerSubject
      signerIssuer = $signerIssuer
      timestampStatus = $timestampStatus
      timestampSubject = $timestampSubject
    })
}

try {
  $packagePeFiles = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
    Where-Object { $_.Extension -in '.exe', '.dll', '.node' })
  foreach ($file in $packagePeFiles) {
    Add-ManifestRecord -Path $file.FullName -ArtifactPath (Get-PatrolSafeRelativePath -Root $OutRoot -Path $file.FullName) -RequireSignature $true
  }

  foreach ($setup in $setupFiles) {
    Add-ManifestRecord -Path $setup.FullName -ArtifactPath (Get-PatrolSafeRelativePath -Root $OutRoot -Path $setup.FullName) -RequireSignature $true
  }

  foreach ($nupkg in $nupkgFiles) {
    Add-ManifestRecord -Path $nupkg.FullName -ArtifactPath (Get-PatrolSafeRelativePath -Root $OutRoot -Path $nupkg.FullName) -RequireSignature $false
    New-Item -ItemType Directory -Path $temporaryExtractRoot -Force | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($nupkg.FullName, $temporaryExtractRoot)

    $embeddedForbidden = @(Get-ChildItem -LiteralPath $temporaryExtractRoot -Directory -Recurse -Force |
      Where-Object { $_.Name -like '.tmp-phase10e-runtime*' })
    if ($embeddedForbidden.Count -ne 0) {
      throw "RELEASE_NUPKG_CONTAINS_FORENSIC_RUNTIME count=$($embeddedForbidden.Count)"
    }

    $embeddedPeFiles = @(Get-ChildItem -LiteralPath $temporaryExtractRoot -Recurse -File |
      Where-Object { $_.Extension -in '.exe', '.dll', '.node' })
    foreach ($file in $embeddedPeFiles) {
      $relative = "nupkg/$(Get-PatrolSafeRelativePath -Root $temporaryExtractRoot -Path $file.FullName)"
      Add-ManifestRecord -Path $file.FullName -ArtifactPath $relative -RequireSignature $true
    }
  }

  $releaseIndexes = @(Get-ChildItem -LiteralPath $makeRoot -Filter 'RELEASES' -Recurse -File -ErrorAction SilentlyContinue)
  foreach ($file in $releaseIndexes) {
    Add-ManifestRecord -Path $file.FullName -ArtifactPath (Get-PatrolSafeRelativePath -Root $OutRoot -Path $file.FullName) -RequireSignature $false
  }

  $mainExe = Join-Path $packageRoot 'PatrolEvidencePlatform.exe'
  $mainInfo = (Get-Item -LiteralPath $mainExe).VersionInfo
  if ($mainInfo.ProductName -ne $ExpectedProductName -or $mainInfo.CompanyName -ne $ExpectedPublisher) {
    throw "MAIN_EXE_METADATA_MISMATCH product=$($mainInfo.ProductName) company=$($mainInfo.CompanyName)"
  }

  $manifest = [ordered]@{
    formatVersion = 1
    productName = $ExpectedProductName
    publisher = $ExpectedPublisher
    releaseVersion = '1.0.0'
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    signedReleaseCandidate = $true
    published = $false
    artifacts = $records
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $ManifestPath) -Force | Out-Null
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding utf8
  Write-Output "WINDOWS_SIGNATURE_VERIFICATION_OK artifacts=$($records.Count) manifest=$ManifestPath"
}
finally {
  if (Test-Path -LiteralPath $temporaryExtractRoot) {
    Remove-Item -LiteralPath $temporaryExtractRoot -Recurse -Force
  }
}
