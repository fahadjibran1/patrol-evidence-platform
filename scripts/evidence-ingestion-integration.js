/* Isolated 9B.1 service-level certification. Run with Electron's Node ABI. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { DataSource } = require('typeorm');
const sharp = require('sharp');

const dist = path.resolve(__dirname, '..', 'dist');
const PatrolImage = new (require('typeorm').EntitySchema)({ name: 'PatrolImage', tableName: 'patrol_images', columns: {
  id: { type: 'varchar', primary: true, generated: 'uuid' }, siteId: { type: 'varchar' }, groupId: { type: 'varchar', nullable: true },
  collectorType: { type: 'varchar' }, senderName: { type: 'varchar', nullable: true }, senderNumber: { type: 'varchar', nullable: true }, senderExternalId: { type: 'varchar', nullable: true }, messageExternalId: { type: 'varchar', nullable: true }, linkedAccountId: { type: 'varchar', nullable: true }, sentAt: { type: 'datetime' }, receivedAt: { type: 'datetime' }, patrolDate: { type: 'varchar' }, patrolHour: { type: 'integer' }, originalFileName: { type: 'varchar', nullable: true }, storedFileName: { type: 'varchar' }, filePath: { type: 'varchar' }, fileSize: { type: 'varchar' }, mimeType: { type: 'varchar' }, contentSha256: { type: 'varchar', nullable: true }, integrityStatus: { type: 'varchar', default: 'FINALIZED' }, status: { type: 'varchar' }, notes: { type: 'text', nullable: true }, createdAt: { type: 'datetime', createDate: true }, updatedAt: { type: 'datetime', updateDate: true },
}, indices: [{ name: 'UQ_patrol_images_whatsapp_identity', columns: ['linkedAccountId', 'messageExternalId'], unique: true, where: '"collectorType" = \'WHATSAPP\' AND "linkedAccountId" IS NOT NULL AND "messageExternalId" IS NOT NULL' }] });
async function walk(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) result.push(...await walk(p)); else result.push(p);
  }
  return result;
}
function assert(ok, msg) { if (!ok) throw new Error(`ASSERTION FAILED: ${msg}`); }

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'patrol-9b1-'));
  const dbPath = path.join(root, 'patrol.sqlite');
  const evidenceRoot = path.join(root, 'evidence');
  await fsp.mkdir(evidenceRoot, { recursive: true });
  const ds = new DataSource({ type: 'better-sqlite3', database: dbPath, entities: [PatrolImage], synchronize: true });
  await ds.initialize();
  const CollectorType = require(path.join(dist, 'common/enums/collector-type.enum.js')).CollectorType;
  const PatrolSlotStatus = require(path.join(dist, 'common/enums/patrol-slot-status.enum.js')).PatrolSlotStatus;
  const { StorageService } = require(path.join(dist, 'storage/storage.service.js'));
  const { PatrolImageIngestionService } = require(path.join(dist, 'patrol-images/patrol-image-ingestion.service.js'));
  const { PatrolImageSchemaService } = require(path.join(dist, 'patrol-images/patrol-image-schema.service.js'));
  const { PatrolImageReconciliationService } = require(path.join(dist, 'patrol-images/patrol-image-reconciliation.service.js'));
  const repo = ds.getRepository(PatrolImage);
  const repoFindOne = repo.findOne.bind(repo);
  repo.findOne = (options) => { if (options && options.relations) delete options.relations; return repoFindOne(options); };
  const config = { getOrThrow: (k) => k === 'storageRootPath' ? evidenceRoot : (() => { throw new Error(k); })(), get: (k) => k === 'securityCompanyName' ? '9B Test' : undefined };
  const storage = new StorageService(config);
  const site = { id: crypto.randomUUID(), siteCode: 'TST01', siteName: 'Test Site' };
  const sites = { findActiveByCode: async (code) => ({ ...site, siteCode: code.startsWith('..') ? code : 'TST01' }) };
  const compliance = { updateSlotStatusFromImage: async () => PatrolSlotStatus.RECEIVED_ON_TIME };
  const service = () => new PatrolImageIngestionService(sites, repo, storage, compliance);
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 40, g: 120, b: 220 } } }).jpeg().toBuffer();
  const event = (account, id, buffer = jpeg, extra = {}) => ({ collectorType: CollectorType.WHATSAPP, siteCode: 'TST01', timestamp: '2026-09-06T10:00:00.000Z', linkedAccountId: account, messageExternalId: id, originalFileName: 'same.jpg', mimeType: 'image/jpeg', fileSize: buffer.length, fileBuffer: buffer, senderName: 'synthetic', ...extra });
  const evidenceFiles = async () => (await walk(evidenceRoot)).filter((p) => !path.basename(p).startsWith('.staging-'));
  const temps = async () => (await walk(evidenceRoot)).filter((p) => path.basename(p).startsWith('.staging-'));

  const s = service();
  const same = await Promise.all(Array.from({ length: 10 }, () => s.ingestPatrolImage(event('acct-a', 'same-message'))));
  let rows = await repo.find();
  assert(rows.length === 1 && new Set(same.map((x) => x.id)).size === 1, '10-way duplicate is one logical record');
  assert(rows[0].integrityStatus === 'FINALIZED' && (await evidenceFiles()).length === 1 && (await temps()).length === 0, 'duplicate finalization');
  const different = await Promise.all(Array.from({ length: 10 }, (_, i) => s.ingestPatrolImage(event('acct-a', `different-${i}`))));
  rows = await repo.find();
  assert(rows.length === 11 && new Set(different.map((x) => x.filePath)).size === 10, 'different messages do not collide');
  await s.ingestPatrolImage(event('acct-b', 'same-message'));
  assert((await repo.find()).length === 12, 'same ID scoped by account');
  await ds.destroy();

  const ds2 = new DataSource({ type: 'better-sqlite3', database: dbPath, entities: [PatrolImage], synchronize: true });
  await ds2.initialize();
  await new PatrolImageSchemaService(ds2).onModuleInit();
  const repo2 = ds2.getRepository(PatrolImage);
  const repo2FindOne = repo2.findOne.bind(repo2);
  repo2.findOne = (options) => { if (options && options.relations) delete options.relations; return repo2FindOne(options); };
  const storage2 = new StorageService(config);
  const s2 = new PatrolImageIngestionService(sites, repo2, storage2, compliance);
  await s2.ingestPatrolImage(event('acct-a', 'same-message'));
  assert((await repo2.find()).length === 12 && (await evidenceFiles()).length === 12, 'restart replay idempotent');
  await Promise.all([s2.ingestPatrolImage(event('acct-a', 'overlap')), s2.ingestPatrolImage(event('acct-a', 'overlap'))]);
  assert((await repo2.find()).filter((x) => x.messageExternalId === 'overlap').length === 1, 'live/backfill overlap');

  const originalFinalize = storage2.finalizePatrolEvidence.bind(storage2);
  storage2.finalizePatrolEvidence = async () => { throw new Error('injected rename failure'); };
  let failed = false; try { await s2.ingestPatrolImage(event('acct-a', 'rename-failure')); } catch { failed = true; }
  assert(failed && !(await repo2.findOne({ where: { linkedAccountId: 'acct-a', messageExternalId: 'rename-failure' } })) && (await temps()).length === 0, 'rename failure compensated');
  storage2.finalizePatrolEvidence = originalFinalize;
  await s2.ingestPatrolImage(event('acct-a', 'rename-failure'));
  const originalSave = repo2.save.bind(repo2); let saveCalls = 0;
  repo2.save = async (...args) => { saveCalls += 1; if (saveCalls === 2) throw new Error('injected DB finalization failure'); return originalSave(...args); };
  failed = false; try { await s2.ingestPatrolImage(event('acct-a', 'db-finalization-failure')); } catch { failed = true; }
  assert(failed && !(await repo2.findOne({ where: { linkedAccountId: 'acct-a', messageExternalId: 'db-finalization-failure' } })) && (await temps()).length === 0, 'DB finalization failure compensated');
  repo2.save = originalSave;
  await s2.ingestPatrolImage(event('acct-a', 'db-finalization-failure'));
  const complianceFail = { updateSlotStatusFromImage: async () => { throw new Error('injected compliance failure'); } };
  let complianceServiceFailed = false; try { await new PatrolImageIngestionService(sites, repo2, storage2, complianceFail).ingestPatrolImage(event('acct-a', 'compliance-failure')); } catch { complianceServiceFailed = true; }
  assert(complianceServiceFailed, 'compliance failure is observable');
  const complianceRow = await repo2.findOneByOrFail({ linkedAccountId: 'acct-a', messageExternalId: 'compliance-failure' });
  assert(complianceRow.integrityStatus === 'FINALIZED' && fs.existsSync(complianceRow.filePath), 'primary evidence survives compliance failure');
  await s2.ingestPatrolImage(event('acct-a', 'compliance-failure'));

  const bad = Buffer.from('not-an-image');
  failed = false; try { await s2.ingestPatrolImage(event('acct-a', 'corrupt', bad)); } catch { failed = true; }
  assert(failed && !(await repo2.findOne({ where: { messageExternalId: 'corrupt' } })), 'corrupt media rejected');
  failed = false; try { await s2.ingestPatrolImage(event('acct-a', 'oversize', Buffer.alloc(25 * 1024 * 1024 + 1))); } catch { failed = true; }
  assert(failed && !(await repo2.findOne({ where: { messageExternalId: 'oversize' } })), 'oversize rejected');
  await s2.ingestPatrolImage(event('acct-a', 'path-escape', jpeg, { siteCode: '../escape' }));
  for (const p of await evidenceFiles()) assert(path.resolve(p).startsWith(path.resolve(evidenceRoot) + path.sep), 'path remains contained');

  const successful = await repo2.findOneByOrFail({ messageExternalId: 'same-message', linkedAccountId: 'acct-a' });
  const bytes = await fsp.readFile(successful.filePath);
  assert(crypto.createHash('sha256').update(bytes).digest('hex') === successful.contentSha256 && String(bytes.length) === successful.fileSize, 'independent hash/size');
  const recon = new PatrolImageReconciliationService(repo2, config);
  await fsp.unlink(successful.filePath);
  const missing = await recon.reconcile();
  assert(missing.missing >= 1 && (await repo2.findOneByOrFail({ id: successful.id })).integrityStatus === 'INTEGRITY_FAILED', 'missing file detected');
  const other = (await repo2.find()).find((x) => x.filePath !== successful.filePath);
  await fsp.writeFile(other.filePath, Buffer.from('altered'));
  const mismatch = await recon.reconcile();
  assert(mismatch.mismatched >= 1 && (await repo2.findOneByOrFail({ id: other.id })).integrityStatus === 'INTEGRITY_FAILED', 'hash mismatch detected');
  const temp = path.join(evidenceRoot, 'TST01', '.staging-owned.tmp'); await fsp.mkdir(path.dirname(temp), { recursive: true }); await fsp.writeFile(temp, 'owned');
  const keep = path.join(path.dirname(temp), 'keep.txt'); await fsp.writeFile(keep, 'keep'); await recon.reconcile();
  assert(!fs.existsSync(temp) && fs.existsSync(keep), 'owned temp only cleanup');
  await new PatrolImageSchemaService(ds2).onModuleInit();
  const indexRows = await ds2.query(`PRAGMA index_list("patrol_images")`);
  assert(indexRows.some((x) => x.name === 'UQ_patrol_images_whatsapp_identity'), 'unique index present');
  const BetterSqlite = require('better-sqlite3');
  const legacyPath = path.join(root, 'legacy.sqlite'); const legacyDb = new BetterSqlite(legacyPath);
  legacyDb.exec('CREATE TABLE patrol_images (id varchar(40), collectorType varchar(32), linkedAccountId varchar(120), messageExternalId varchar(120))');
  legacyDb.prepare("INSERT INTO patrol_images VALUES ('a','WHATSAPP','acct','dup')").run(); legacyDb.prepare("INSERT INTO patrol_images VALUES ('b','WHATSAPP','acct','dup')").run();
  const legacy = { options: { type: 'better-sqlite3' }, query: async (sql) => legacyDb.prepare(sql).all() };
  let migrationBlocked = false; try { await new PatrolImageSchemaService(legacy).onModuleInit(); } catch { migrationBlocked = true; }
  assert(migrationBlocked && legacyDb.prepare('SELECT COUNT(*) c FROM patrol_images').get().c === 2, 'ambiguous legacy migration fails closed'); legacyDb.close();
  console.log(JSON.stringify({ ok: true, root, rows: (await repo2.count()), files: (await evidenceFiles()).length, temps: (await temps()).length, uniqueIndex: true }));
  await ds2.destroy();
  await fsp.rm(root, { recursive: true, force: true });
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
