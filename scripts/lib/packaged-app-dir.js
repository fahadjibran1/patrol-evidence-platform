const fs = require('fs');
const path = require('path');

function findPackagedAppDir(outRoot = path.resolve(__dirname, '..', '..', 'out')) {
  if (!fs.existsSync(outRoot)) {
    return null;
  }

  const candidates = fs
    .readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outRoot, entry.name))
    .filter((entryPath) => /win32-x64$/i.test(path.basename(entryPath)));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0];
}

module.exports = {
  findPackagedAppDir,
};
