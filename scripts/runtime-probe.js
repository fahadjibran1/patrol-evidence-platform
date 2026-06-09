console.log('RUNTIME_PROBE_START');
console.log(`argv=${JSON.stringify(process.argv)}`);
console.log(`cwd=${process.cwd()}`);
console.log(`electron=${process.versions.electron || 'none'}`);
console.log(`modules=${process.versions.modules || 'unknown'}`);
setTimeout(() => {
  console.log('RUNTIME_PROBE_DONE');
  process.exit(0);
}, 1000);
