const { appendFileSync, mkdirSync } = require('fs');
const path = require('path');
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('C:/Users/Admin/patrol-evidence-platform/out/PatrolSafe by S4-win32-x64/resources/app/dist/app.module.js');

const probeLogPath =
  process.env.BOOTSTRAP_PROBE_LOG ||
  path.join(process.env.APPDATA || process.cwd(), 'Patrol Evidence Platform', 'bootstrap-probe.log');

mkdirSync(path.dirname(probeLogPath), { recursive: true });

function logLine(message) {
  appendFileSync(probeLogPath, `${message}\n`, 'utf8');
  console.log(message);
}

process.on('uncaughtException', (error) => {
  logLine(`BOOTSTRAP_PROBE_UNCAUGHT ${error instanceof Error ? error.stack || error.message : String(error)}`);
});

process.on('unhandledRejection', (reason) => {
  logLine(`BOOTSTRAP_PROBE_REJECTION ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
});

async function run() {
  logLine('BOOTSTRAP_PROBE_START');
  const app = await NestFactory.create(AppModule);
  logLine('BOOTSTRAP_PROBE_NEST_CREATED');
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();
  logLine('BOOTSTRAP_PROBE_PIPES_READY');
  await app.listen(process.env.PORT ?? 3001);
  logLine(`BOOTSTRAP_PROBE_LISTENING ${process.env.PORT ?? 3001}`);

  setTimeout(async () => {
    logLine('BOOTSTRAP_PROBE_EXIT');
    await app.close();
    process.exit(0);
  }, 5000);
}

run().catch((error) => {
  logLine(`BOOTSTRAP_PROBE_ERROR ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
