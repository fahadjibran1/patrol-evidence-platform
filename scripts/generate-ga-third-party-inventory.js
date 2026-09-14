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
const sourceCommit = childProcess
  .execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' })
  .trim();

if (!fs.existsSync(path.join(appRoot, 'node_modules'))) {
  throw new Error(`Packaged node_modules was not found under ${appRoot}`);
}

const normalizePath = (value) => value.split(path.sep).join('/');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
const csv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

function walkPackageJsonFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkPackageJsonFiles(fullPath, output);
    } else if (entry.isFile() && entry.name === 'package.json') {
      output.push(fullPath);
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
for (const packageJsonPath of walkPackageJsonFiles(path.join(appRoot, 'node_modules'))) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    continue;
  }
  if (!pkg.name || !pkg.version) continue;

  const key = `${pkg.name}@${pkg.version}`;
  const packageRoot = path.dirname(packageJsonPath);
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
  packageInstances: walkPackageJsonFiles(path.join(appRoot, 'node_modules'))
    .map((file) => {
      try {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
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
