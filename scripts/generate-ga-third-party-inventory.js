const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const repositoryRoot = path.resolve(__dirname, '..');
const defaultAppRoot = path.join(
  repositoryRoot,
  'out',
  'PatrolSafe by S4-win32-x64',
  'resources',
  'app',
);
const appRoot = path.resolve(process.argv[2] || defaultAppRoot);
const outputRoot = path.join(repositoryRoot, 'docs', 'ga', 'generated');
const releasePackageJson = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
);
const sourceCommit = childProcess
  .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' })
  .trim();

if (!fs.existsSync(path.join(appRoot, 'node_modules'))) {
  throw new Error(`Packaged node_modules was not found under ${appRoot}`);
}

const normalizePath = (value) => value.split(path.sep).join('/');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const csv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

function collectInstalledPackageRoots(nodeModulesDirectory, output = []) {
  if (!fs.existsSync(nodeModulesDirectory)) return output;

  for (const entry of fs.readdirSync(nodeModulesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    const entryPath = path.join(nodeModulesDirectory, entry.name);
    const candidates = entry.name.startsWith('@') || entry.name === '.prisma'
      ? fs
          .readdirSync(entryPath, { withFileTypes: true })
          .filter((child) => child.isDirectory())
          .map((child) => path.join(entryPath, child.name))
      : [entryPath];

    for (const packageRoot of candidates) {
      if (!fs.existsSync(path.join(packageRoot, 'package.json'))) continue;
      output.push(packageRoot);
      collectInstalledPackageRoots(path.join(packageRoot, 'node_modules'), output);
    }
  }

  return output;
}

function declaredLicense(pkg) {
  if (typeof pkg.license === 'string' && pkg.license.trim()) return pkg.license.trim();
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type.trim();
  if (Array.isArray(pkg.licenses)) {
    const values = pkg.licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter(Boolean);
    if (values.length) return values.join(' OR ');
  }
  return '';
}

function riskFor(record) {
  if (!record.license) {
    return record.name.startsWith('@patrol/')
      ? 'INTERNAL_METADATA_REVIEW'
      : 'MISSING_METADATA_REVIEW';
  }
  if (/AGPL|LGPL|(?:^|[^L])GPL/i.test(record.license)) return 'COPYLEFT_REVIEW';
  if (/\s(?:AND|OR)\s|SEE LICEN[CS]E|WTFPL|Python-2\.0/i.test(record.license)) {
    return 'MULTI_OR_SPECIAL_LICENCE_REVIEW';
  }
  return 'METADATA_RECORDED';
}

const recordsByKey = new Map();
const packageRoots = collectInstalledPackageRoots(path.join(appRoot, 'node_modules'));
for (const packageRoot of packageRoots) {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    continue;
  }
  if (!pkg.name || !pkg.version) continue;

  const key = `${pkg.name}@${pkg.version}`;
  const directFiles = fs.readdirSync(packageRoot, { withFileTypes: true });
  const licenceFiles = directFiles
    .filter((entry) => entry.isFile() && /^(LICEN[CS]E|COPYING|NOTICE|COPYRIGHT)(\.|$|-)/i.test(entry.name))
    .map((entry) => {
      const filePath = path.join(packageRoot, entry.name);
      const content = fs.readFileSync(filePath);
      return {
        name: entry.name,
        sha256: sha256(content),
        content: content.toString('utf8'),
      };
    });

  const existing = recordsByKey.get(key);
  if (existing) {
    existing.packagePaths.add(normalizePath(path.relative(appRoot, packageRoot)));
    for (const file of licenceFiles) {
      if (!existing.licenceFiles.some((candidate) => candidate.sha256 === file.sha256)) {
        existing.licenceFiles.push(file);
      }
    }
    continue;
  }

  const record = {
    name: pkg.name,
    version: pkg.version,
    license: declaredLicense(pkg),
    repository:
      typeof pkg.repository === 'string'
        ? pkg.repository
        : pkg.repository?.url || '',
    homepage: pkg.homepage || '',
    packagePaths: new Set([normalizePath(path.relative(appRoot, packageRoot))]),
    licenceFiles,
  };
  record.review = riskFor(record);
  recordsByKey.set(key, record);
}

const records = [...recordsByKey.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
);
fs.mkdirSync(outputRoot, { recursive: true });

function collectRepositoryProductionRecords() {
  const npmExecutable = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
  const npmArguments = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm ls --omit=dev --all --parseable']
    : ['ls', '--omit=dev', '--all', '--parseable'];
  const result = childProcess.spawnSync(
    npmExecutable,
    npmArguments,
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `npm production inventory failed: ${result.error?.message || result.stderr || result.stdout || 'unknown error'}`,
    );
  }

  const byKey = new Map();
  for (const packageRoot of result.stdout.split(/\r?\n/).filter(Boolean)) {
    if (path.resolve(packageRoot) === repositoryRoot) continue;
    const packageJsonPath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch {
      continue;
    }
    if (!pkg.name || !pkg.version) continue;
    const key = `${pkg.name}@${pkg.version}`;
    const record = byKey.get(key) || {
      name: pkg.name,
      version: pkg.version,
      license: declaredLicense(pkg),
      paths: new Set(),
    };
    record.paths.add(normalizePath(path.relative(repositoryRoot, packageRoot)));
    byKey.set(key, record);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

const repositoryRecords = collectRepositoryProductionRecords();

const csvLines = [
  [
    'package',
    'version',
    'declared_licence',
    'technical_review',
    'licence_files',
    'licence_file_sha256',
    'packaged_paths',
    'repository',
    'homepage',
  ].map(csv).join(','),
];
for (const record of records) {
  csvLines.push(
    [
      record.name,
      record.version,
      record.license || '[missing]',
      record.review,
      record.licenceFiles.map((file) => file.name).join(' | '),
      record.licenceFiles.map((file) => `${file.name}:${file.sha256}`).join(' | '),
      [...record.packagePaths].sort().join(' | '),
      record.repository,
      record.homepage,
    ].map(csv).join(','),
  );
}
fs.writeFileSync(
  path.join(outputRoot, 'third-party-production-dependencies.csv'),
  `${csvLines.join('\n')}\n`,
  'utf8',
);

const repositoryCsvLines = [
  ['package', 'version', 'declared_licence', 'repository_paths'].map(csv).join(','),
];
for (const record of repositoryRecords) {
  repositoryCsvLines.push(
    [
      record.name,
      record.version,
      record.license || '[missing]',
      [...record.paths].sort().join(' | '),
    ].map(csv).join(','),
  );
}
fs.writeFileSync(
  path.join(outputRoot, 'repository-production-dependencies.csv'),
  `${repositoryCsvLines.join('\n')}\n`,
  'utf8',
);

const repositoryKeys = new Set(repositoryRecords.map((record) => `${record.name}@${record.version}`));
const packagedKeys = new Set(records.map((record) => `${record.name}@${record.version}`));
const reconciliationLines = [
  [
    'package',
    'version',
    'in_repository_production_resolution',
    'in_packaged_application',
    'packaged_instance_count',
    'declared_licence',
    'collected_direct_text_count',
    'technical_classification',
  ].map(csv).join(','),
];
const union = new Map();
for (const record of repositoryRecords) union.set(`${record.name}@${record.version}`, record);
for (const record of records) union.set(`${record.name}@${record.version}`, record);
for (const [key, record] of [...union].sort((a, b) => a[0].localeCompare(b[0]))) {
  const packaged = recordsByKey.get(key);
  const inPackage = packagedKeys.has(key);
  const classification = !inPackage
    ? 'NOT_SHIPPED'
    : packaged.review === 'COPYLEFT_REVIEW'
      ? 'SHIPPED_LEGAL_COPYLEFT_REVIEW'
      : packaged.review === 'MULTI_OR_SPECIAL_LICENCE_REVIEW'
        ? 'SHIPPED_LEGAL_SPECIAL_REVIEW'
        : packaged.license === 'UNLICENSED'
          ? 'SHIPPED_INTERNAL_PRODUCT_COMPONENT'
          : packaged.review === 'MISSING_METADATA_REVIEW'
            ? 'SHIPPED_METADATA_DEFECT'
            : 'SHIPPED_NOTICE_TEXT_COLLECTED';
  reconciliationLines.push(
    [
      record.name,
      record.version,
      repositoryKeys.has(key),
      inPackage,
      packaged ? packaged.packagePaths.size : 0,
      (packaged?.license || record.license) || '[missing]',
      packaged?.licenceFiles.length || 0,
      classification,
    ].map(csv).join(','),
  );
}
fs.writeFileSync(
  path.join(outputRoot, 'third-party-reconciliation.csv'),
  `${reconciliationLines.join('\n')}\n`,
  'utf8',
);

const textByHash = new Map();
for (const record of records) {
  for (const file of record.licenceFiles) {
    const key = file.sha256;
    const existing = textByHash.get(key) || {
      sha256: key,
      packages: new Set(),
      names: new Set(),
      content: file.content,
    };
    existing.packages.add(`${record.name}@${record.version}`);
    existing.names.add(file.name);
    textByHash.set(key, existing);
  }
}

function addSupplementalText(label, filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath);
  const key = sha256(content);
  const existing = textByHash.get(key) || {
    sha256: key,
    packages: new Set(),
    names: new Set(),
    content: content.toString('utf8'),
  };
  existing.packages.add(label);
  existing.names.add(path.basename(filePath));
  textByHash.set(key, existing);
}

const packagedRoot = path.dirname(path.dirname(appRoot));
addSupplementalText('Electron 41.1.0 packaged shell', path.join(packagedRoot, 'LICENSE'));
addSupplementalText(
  'electron-winstaller 5.4.0 / Squirrel build input',
  path.join(repositoryRoot, 'node_modules', 'electron-winstaller', 'LICENSE'),
);
addSupplementalText(
  '@electron-forge/maker-squirrel 7.11.1 build input',
  path.join(repositoryRoot, 'node_modules', '@electron-forge', 'maker-squirrel', 'LICENSE'),
);

const textLines = [
  '# Collected third-party licence and notice texts',
  '',
  '> GENERATED RELEASE-ENGINEERING EVIDENCE — REQUIRES LEGAL REVIEW',
  '>',
  `> Source: the existing unsigned packaged application tree reconciled at source commit \`${sourceCommit}\`.`,
  '> Regenerate and reconcile this file against the exact final signed GA package before publication.',
  '',
];
for (const entry of [...textByHash.values()].sort((a, b) => a.sha256.localeCompare(b.sha256))) {
  textLines.push(`## ${entry.sha256}`);
  textLines.push('');
  textLines.push(`Packages: ${[...entry.packages].sort().join(', ')}`);
  textLines.push(`Source filenames: ${[...entry.names].sort().join(', ')}`);
  textLines.push('');
  textLines.push('```text');
  // Preserve the original file hash above while normalising presentation-only
  // trailing spaces so the generated review document passes repository checks.
  textLines.push(
    entry.content
      .replace(/```/g, '``\u200b`')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join('\n')
      .trimEnd(),
  );
  textLines.push('```');
  textLines.push('');
}
fs.writeFileSync(
  path.join(outputRoot, 'third-party-license-texts.md'),
  `${textLines.join('\n').trimEnd()}\n`,
  'utf8',
);

const noticeLines = [
  `PATROLSAFE BY S4 VERSION ${releasePackageJson.version}`,
  'THIRD-PARTY NOTICES DRAFT',
  'REQUIRES LEGAL REVIEW',
  '',
  `Source commit: ${sourceCommit}`,
  `Packaged application records: ${records.length} unique package/version records`,
  '',
  'This technical draft collects licence and notice texts found in the packaged',
  'application plus the Electron/Squirrel build inputs identified below. It is not',
  'legal approval and must be regenerated against the exact final signed GA build.',
  '',
  'Electron/Chromium credits:',
  `- The packaged distribution contains LICENSES.chromium.html at its root.`,
  `- SHA-256: ${sha256(fs.readFileSync(path.join(packagedRoot, 'LICENSES.chromium.html')))}`,
  '- The full Chromium credits remain in that shipped file and are not duplicated here.',
  '',
];
for (const entry of [...textByHash.values()].sort((a, b) => a.sha256.localeCompare(b.sha256))) {
  noticeLines.push('================================================================================');
  noticeLines.push(`ORIGINAL TEXT SHA-256: ${entry.sha256}`);
  noticeLines.push(`APPLIES TO: ${[...entry.packages].sort().join(', ')}`);
  noticeLines.push(`SOURCE FILES: ${[...entry.names].sort().join(', ')}`);
  noticeLines.push('================================================================================');
  noticeLines.push('');
  noticeLines.push(
    entry.content
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join('\n')
      .trimEnd(),
  );
  noticeLines.push('');
}
const noticePath = path.join(repositoryRoot, 'docs', 'ga', 'THIRD_PARTY_NOTICES_DRAFT.txt');
fs.writeFileSync(noticePath, `${noticeLines.join('\n').trimEnd()}\n`, 'utf8');

const countsByLicense = new Map();
const countsByReview = new Map();
for (const record of records) {
  const licence = record.license || '[missing]';
  countsByLicense.set(licence, (countsByLicense.get(licence) || 0) + 1);
  countsByReview.set(record.review, (countsByReview.get(record.review) || 0) + 1);
}

const summary = {
  generator: 'scripts/generate-ga-third-party-inventory.js',
  sourceCommit,
  sourceTree: normalizePath(path.relative(repositoryRoot, appRoot)),
  repositoryProductionUniquePackageVersions: repositoryRecords.length,
  packageInstances: packageRoots
    .map((packageRoot) => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
        return pkg.name && pkg.version ? `${pkg.name}@${pkg.version}` : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean).length,
  uniquePackageVersions: records.length,
  uniqueCollectedTexts: textByHash.size,
  licenceCounts: Object.fromEntries([...countsByLicense].sort((a, b) => b[1] - a[1])),
  reviewCounts: Object.fromEntries([...countsByReview].sort((a, b) => a[0].localeCompare(b[0]))),
  reviewPackages: records
    .filter((record) => record.review !== 'METADATA_RECORDED')
    .map((record) => ({
      package: record.name,
      version: record.version,
      declaredLicence: record.license || '[missing]',
      technicalReview: record.review,
      licenceFiles: record.licenceFiles.map((file) => ({ name: file.name, sha256: file.sha256 })),
    })),
  packagingRootLicenceFiles: ['LICENSE', 'LICENSES.chromium.html']
    .map((name) => path.join(path.dirname(path.dirname(appRoot)), name))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({
      file: path.basename(file),
      size: fs.statSync(file).size,
      sha256: sha256(fs.readFileSync(file)),
    })),
  artifactHashes: {
    repositoryProductionDependenciesCsv: sha256(
      fs.readFileSync(path.join(outputRoot, 'repository-production-dependencies.csv')),
    ),
    packagedProductionDependenciesCsv: sha256(
      fs.readFileSync(path.join(outputRoot, 'third-party-production-dependencies.csv')),
    ),
    reconciliationCsv: sha256(
      fs.readFileSync(path.join(outputRoot, 'third-party-reconciliation.csv')),
    ),
    thirdPartyNoticesDraft: sha256(fs.readFileSync(noticePath)),
  },
};
fs.writeFileSync(
  path.join(outputRoot, 'third-party-inventory-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);

console.log(
  `GA third-party inventory generated: ${summary.packageInstances} packaged instances, ` +
    `${summary.uniquePackageVersions} unique package/version records, ` +
    `${summary.uniqueCollectedTexts} unique licence/notice texts.`,
);
