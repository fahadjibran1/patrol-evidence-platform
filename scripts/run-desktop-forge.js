const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const mode = process.argv[2];

const internalScriptByMode = {
  package: 'desktop:package:internal',
  make: 'desktop:make:internal',
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 0;
}

function stopRunningPatrolEvidenceProcesses() {
  if (process.platform !== 'win32') {
    return;
  }

  // Never terminate an installed/customer PatrolSafe process merely to package a
  // candidate. Only stale test/package processes executing from this repo's out
  // directory may hold build output open.
  const script = [
    '$root = [IO.Path]::GetFullPath($env:PATROLSAFE_PACKAGE_OUT_ROOT).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar',
    'Get-CimInstance Win32_Process -Filter "Name = \'PatrolEvidencePlatform.exe\'" |',
    'Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } |',
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }',
  ].join(' ');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    cwd: projectRoot,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, PATROLSAFE_PACKAGE_OUT_ROOT: path.join(projectRoot, 'out') },
  });
}

function runDesktopCleanAtProjectRoot() {
  const status = runCommand('cmd', ['/c', 'npm', 'run', 'desktop:clean'], {
    cwd: projectRoot,
    env: process.env,
  });

  if (status !== 0) {
    process.exit(status);
  }
}

function getExistingSubstMap() {
  const result = spawnSync('cmd', ['/c', 'subst'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    return new Map();
  }

  const lines = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const map = new Map();
  for (const line of lines) {
    const match = line.match(/^([A-Z]):\\:\s*=>\s*(.+)$/i);
    if (!match) {
      continue;
    }

    map.set(match[1].toUpperCase(), path.normalize(match[2]));
  }

  return map;
}

function findForgeDriveLetter(targetPath) {
  const normalizedTarget = path.normalize(targetPath);
  const existingMap = getExistingSubstMap();

  for (const [letter, mappedPath] of existingMap.entries()) {
    if (mappedPath.toLowerCase() === normalizedTarget.toLowerCase()) {
      return { letter, alreadyMapped: true };
    }
  }

  const preferredLetters = ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
  for (const letter of preferredLetters) {
    if (!fs.existsSync(`${letter}:\\`) && !existingMap.has(letter)) {
      return { letter, alreadyMapped: false };
    }
  }

  fail('No free drive letter was available for Windows packaging. Close any mapped drives and try again.');
}

function runWindowsForge(internalScript) {
  const { letter, alreadyMapped } = findForgeDriveLetter(projectRoot);
  const driveRoot = `${letter}:\\`;

  try {
    stopRunningPatrolEvidenceProcesses();
    runDesktopCleanAtProjectRoot();
    if (!alreadyMapped) {
      const substStatus = runCommand('cmd', ['/c', 'subst', `${letter}:`, projectRoot], { cwd: projectRoot });
      if (substStatus !== 0) {
        process.exit(substStatus);
      }
    }

    console.log(`Using subst drive ${driveRoot} for Electron Forge ${mode}.`);
    const scriptStatus = runCommand('cmd', ['/c', 'npm', 'run', internalScript], {
      cwd: driveRoot,
      env: {
        ...process.env,
        SKIP_DESKTOP_CLEAN: 'true',
      },
    });
    process.exit(scriptStatus);
  } finally {
    if (!alreadyMapped) {
      spawnSync('cmd', ['/c', 'subst', `${letter}:`, '/d'], {
        cwd: projectRoot,
        stdio: 'inherit',
        windowsHide: true,
      });
    }
  }
}

function runDefaultForge(internalScript) {
  const status = runCommand('cmd', ['/c', 'npm', 'run', internalScript], {
    cwd: projectRoot,
    env: process.env,
  });
  process.exit(status);
}

if (!internalScriptByMode[mode]) {
  fail(`Unknown desktop forge mode "${mode}". Use "package" or "make".`);
}

// Build from the real project path.
// Running Vite through a subst drive causes Rollup to receive an
// absolute C:\ path for web/index.html while the build runs from P:\.
runDefaultForge(internalScriptByMode[mode]);
