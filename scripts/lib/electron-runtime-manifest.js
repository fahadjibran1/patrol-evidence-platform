const path = require('path');

/** Electron/Chromium files that must sit next to the packaged .exe (not under resources/app). */
const REQUIRED_EXECUTABLE_ROOT_FILES = [
  'icudtl.dat',
  'resources.pak',
  'chrome_100_percent.pak',
  'chrome_200_percent.pak',
  'snapshot_blob.bin',
  'v8_context_snapshot.bin',
  'ffmpeg.dll',
  'd3dcompiler_47.dll',
  'libEGL.dll',
  'libGLESv2.dll',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll',
];

/** Present on newer Electron builds; copied when available in electron/dist. */
const OPTIONAL_EXECUTABLE_ROOT_FILES = ['dxcompiler.dll', 'dxil.dll'];

const REQUIRED_EXECUTABLE_ROOT_DIRS = ['locales', 'resources'];

const REQUIRED_RESOURCES_CHILDREN = [path.join('app')];

const MIN_ICU_BYTES = 1_024;

function getElectronDistDir(projectRoot) {
  return path.join(projectRoot, 'node_modules', 'electron', 'dist');
}

function getPackagerRuntimeIgnoreBlocklist() {
  return [
    'icudtl.dat',
    'resources.pak',
    'snapshot_blob.bin',
    'v8_context_snapshot.bin',
    'ffmpeg.dll',
    'chrome_100_percent.pak',
    'chrome_200_percent.pak',
    'locales',
    'resources',
  ];
}

module.exports = {
  REQUIRED_EXECUTABLE_ROOT_FILES,
  OPTIONAL_EXECUTABLE_ROOT_FILES,
  REQUIRED_EXECUTABLE_ROOT_DIRS,
  REQUIRED_RESOURCES_CHILDREN,
  MIN_ICU_BYTES,
  getElectronDistDir,
  getPackagerRuntimeIgnoreBlocklist,
};
