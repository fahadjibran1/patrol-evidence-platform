console.log('BACKEND_WRAPPER_PROBE_START');

process.on('uncaughtException', (error) => {
  console.error('WRAPPER_UNCAUGHT_EXCEPTION');
  console.error(error instanceof Error ? error.stack || error.message : String(error));
});

process.on('unhandledRejection', (reason) => {
  console.error('WRAPPER_UNHANDLED_REJECTION');
  console.error(reason instanceof Error ? reason.stack || reason.message : String(reason));
});

try {
  console.log('BACKEND_WRAPPER_BEFORE_REQUIRE');
  require('C:/Users/Admin/patrol-evidence-platform/out/Patrol Evidence Platform-win32-x64/resources/app/dist/main.js');
  console.log('BACKEND_WRAPPER_AFTER_REQUIRE');
} catch (error) {
  console.error('BACKEND_WRAPPER_REQUIRE_ERROR');
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}

setTimeout(() => {
  console.log('BACKEND_WRAPPER_PROBE_DONE');
  process.exit(0);
}, 25000);
