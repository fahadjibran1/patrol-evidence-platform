const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(
  projectRoot,
  'desktop',
  'assets-source',
  'patrolsafe-4p-master.png',
);
const outputDirectory = path.join(projectRoot, 'desktop', 'assets');
const webPublicDirectory = path.join(projectRoot, 'web', 'public');
const sizes = [16, 24, 32, 48, 64, 128, 256];

function pixelIndex(width, x, y) {
  return (y * width + x) * 4;
}

function luminance(red, green, blue) {
  return (red * 299 + green * 587 + blue * 114) / 1000;
}

/**
 * The approved master is RGB artwork on an opaque near-white exterior canvas.
 * Isolate only the bright region connected to the canvas boundary. This keeps
 * the enclosed white 4/P geometry byte-for-byte in shape while producing the
 * transparent rounded corners required by Windows icon surfaces.
 */
function isolateExteriorCanvas(input, width, height) {
  const output = Buffer.from(input);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let queueStart = 0;
  let queueEnd = 0;

  const enqueue = (x, y) => {
    const flatIndex = y * width + x;
    if (visited[flatIndex] !== 0) return;

    const offset = pixelIndex(width, x, y);
    if (luminance(input[offset], input[offset + 1], input[offset + 2]) < 100) return;

    visited[flatIndex] = 1;
    queue[queueEnd] = flatIndex;
    queueEnd += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queueStart < queueEnd) {
    const flatIndex = queue[queueStart];
    queueStart += 1;
    const x = flatIndex % width;
    const y = Math.floor(flatIndex / width);

    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }

  for (let flatIndex = 0; flatIndex < visited.length; flatIndex += 1) {
    if (visited[flatIndex] === 0) continue;
    const offset = flatIndex * 4;
    const lightness = luminance(input[offset], input[offset + 1], input[offset + 2]);
    const alpha = Math.max(0, Math.min(255, Math.round(((255 - lightness) / 155) * 255)));

    if (alpha === 0) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 0;
      continue;
    }

    const normalizedAlpha = alpha / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = Math.max(
        0,
        Math.min(
          255,
          Math.round((input[offset + channel] - 255 * (1 - normalizedAlpha)) / normalizedAlpha),
        ),
      );
    }
    output[offset + 3] = alpha;
  }

  return output;
}

function buildPngBackedIco(pngFrames) {
  const headerLength = 6;
  const entryLength = 16;
  const imageDataOffset = headerLength + entryLength * pngFrames.length;
  const header = Buffer.alloc(headerLength);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngFrames.length, 4);

  const entries = Buffer.alloc(entryLength * pngFrames.length);
  let offset = imageDataOffset;
  pngFrames.forEach(({ size, buffer }, index) => {
    const entryOffset = index * entryLength;
    entries.writeUInt8(size === 256 ? 0 : size, entryOffset);
    entries.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    entries.writeUInt8(0, entryOffset + 2);
    entries.writeUInt8(0, entryOffset + 3);
    entries.writeUInt16LE(1, entryOffset + 4);
    entries.writeUInt16LE(32, entryOffset + 6);
    entries.writeUInt32LE(buffer.length, entryOffset + 8);
    entries.writeUInt32LE(offset, entryOffset + 12);
    offset += buffer.length;
  });

  return Buffer.concat([header, entries, ...pngFrames.map(({ buffer }) => buffer)]);
}

async function main() {
  const metadata = await sharp(sourcePath).metadata();
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
    throw new Error('Approved PatrolSafe master must be a valid PNG image.');
  }
  if (metadata.width !== metadata.height || metadata.width < 256) {
    throw new Error('Approved PatrolSafe master must be square and at least 256px.');
  }

  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const transparentMaster = isolateExteriorCanvas(data, info.width, info.height);

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.mkdir(webPublicDirectory, { recursive: true });

  const pngFrames = [];
  for (const size of sizes) {
    const buffer = await sharp(transparentMaster, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .resize(size, size, {
        fit: 'fill',
        kernel: sharp.kernel.lanczos3,
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer();
    await fs.writeFile(path.join(outputDirectory, `icon-${size}.png`), buffer);
    pngFrames.push({ size, buffer });
  }

  await fs.writeFile(
    path.join(outputDirectory, 'patrolsafe.ico'),
    buildPngBackedIco(pngFrames),
  );

  const canonical256 = pngFrames.find(({ size }) => size === 256).buffer;
  for (const alias of [
    'installer-icon.png',
    'uninstaller-icon.png',
    'shortcut-icon.png',
    'about-logo.png',
  ]) {
    await fs.writeFile(path.join(outputDirectory, alias), canonical256);
  }
  await fs.writeFile(path.join(webPublicDirectory, 'patrolsafe-icon.png'), canonical256);

  console.log(
    `Generated PatrolSafe Windows assets from ${path.relative(projectRoot, sourcePath)}: ${sizes.join(', ')}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
