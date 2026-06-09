const fs = require('fs');
const path = require('path');
const { DataSource } = require('typeorm');

function resolveProjectRoot() {
  const explicit = process.env.DESKTOP_PROJECT_ROOT;
  if (explicit && explicit.trim().length > 0) {
    return explicit;
  }

  return path.resolve(__dirname, '..');
}

function registerTsRuntimeIfNeeded(projectRoot) {
  const distMain = path.join(projectRoot, 'dist', 'main.js');
  if (fs.existsSync(distMain)) {
    return false;
  }

  require('ts-node/register/transpile-only');
  require('tsconfig-paths/register');
  return true;
}

function buildMigrationConfig(projectRoot) {
  const usingTsRuntime = registerTsRuntimeIfNeeded(projectRoot);
  const entities = usingTsRuntime
    ? [path.join(projectRoot, 'src', '**', '*.entity.ts')]
    : [path.join(projectRoot, 'dist', '**', '*.entity.js')];
  const migrations = usingTsRuntime
    ? [path.join(projectRoot, 'src', 'database', 'migrations', '*.ts')]
    : [path.join(projectRoot, 'dist', 'database', 'migrations', '*.js')];

  return {
    type: 'postgres',
    host: process.env.DESKTOP_DB_HOST,
    port: Number(process.env.DESKTOP_DB_PORT || 5432),
    username: process.env.DESKTOP_DB_USER,
    password: process.env.DESKTOP_DB_PASSWORD,
    database: process.env.DESKTOP_DB_NAME,
    entities,
    migrations,
    synchronize: false,
    logging: false,
  };
}

async function run() {
  const projectRoot = resolveProjectRoot();
  const dataSource = new DataSource(buildMigrationConfig(projectRoot));

  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
