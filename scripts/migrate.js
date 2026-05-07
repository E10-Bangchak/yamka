/**
 * migrate.js — ย้ายข้อมูลจาก Firebase Project เก่า → ใหม่
 *
 * ขั้นตอน:
 *   Phase 1 (EXPORT): node scripts/migrate.js export
 *   Phase 2 (MAP):    แก้ไฟล์ uid-map.json (old UID → new UID)
 *   Phase 3 (IMPORT): node scripts/migrate.js import
 *
 * ต้องการ:
 *   - old-service-account.json  (Service Account ของ project เก่า)
 *   - new-service-account.json  (Service Account ของ project ใหม่)
 *
 * วิธีได้ Service Account:
 *   Firebase Console → Project Settings → Service accounts
 *   → Generate new private key → บันทึกเป็น old/new-service-account.json
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const PHASE = process.argv[2]; // 'export' | 'import'
const SCRIPTS_DIR = __dirname;
const DATA_DIR = path.join(SCRIPTS_DIR, 'migration-data');
const UID_MAP_FILE = path.join(SCRIPTS_DIR, 'uid-map.json');

// Collections ทั้งหมดที่ต้อง migrate
const COLLECTIONS = [
  'members',
  'shifts',
  'swapRequests',
  'shiftProperties',
  'notes',
  'pairGroups',
];
// settings มีแค่ doc 'system' เดียว
const SETTINGS_DOC = 'system';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function loadApp(serviceAccountFile, appName) {
  const sa = require(path.resolve(SCRIPTS_DIR, serviceAccountFile));
  return admin.initializeApp(
    { credential: admin.credential.cert(sa) },
    appName
  );
}

async function exportCollection(db, colName) {
  console.log(`  → export ${colName}...`);
  const snap = await db.collection(colName).get();
  const docs = {};
  snap.forEach(d => { docs[d.id] = d.data(); });
  console.log(`     ${snap.size} docs`);
  return docs;
}

function applyUidMap(data, uidMap) {
  // แทนที่ old UID ทุกตำแหน่งด้วย new UID (ทำงานบน JSON string)
  let json = JSON.stringify(data);
  for (const [oldUid, newUid] of Object.entries(uidMap)) {
    if (!oldUid || !newUid || oldUid === newUid) continue;
    // replace ทุก occurrence (escape สำหรับ regex)
    const escaped = oldUid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    json = json.replace(new RegExp(escaped, 'g'), newUid);
  }
  return JSON.parse(json);
}

async function importCollection(db, colName, docs, uidMap, batchSize = 400) {
  // remap doc IDs (members doc ID = UID)
  const remapped = {};
  for (const [id, data] of Object.entries(docs)) {
    const newId = uidMap[id] || id; // ถ้าไม่มีใน map → ใช้ id เดิม
    remapped[newId] = applyUidMap(data, uidMap);
  }

  const entries = Object.entries(remapped);
  console.log(`  → import ${colName} (${entries.length} docs)...`);

  // batch write ทีละ batchSize
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = db.batch();
    for (const [id, data] of entries.slice(i, i + batchSize)) {
      batch.set(db.collection(colName).doc(id), data);
    }
    await batch.commit();
    console.log(`     committed ${Math.min(i + batchSize, entries.length)}/${entries.length}`);
  }
}

// ─────────────────────────────────────────────
// PHASE 1: EXPORT
// ─────────────────────────────────────────────
async function runExport() {
  console.log('\n══ PHASE 1: EXPORT ══');

  if (!fs.existsSync(path.join(SCRIPTS_DIR, 'old-service-account.json'))) {
    console.error('❌ ไม่พบ old-service-account.json ใน scripts/');
    console.error('   → Firebase Console → Project Settings → Service accounts → Generate new private key');
    process.exit(1);
  }

  const oldApp = loadApp('old-service-account.json', 'old');
  const db = oldApp.firestore();

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const allData = {};
  for (const col of COLLECTIONS) {
    allData[col] = await exportCollection(db, col);
  }

  // export settings doc
  const settingsDoc = await db.collection('settings').doc(SETTINGS_DOC).get();
  if (settingsDoc.exists) {
    allData['settings'] = { [SETTINGS_DOC]: settingsDoc.data() };
    console.log('  → export settings/system... 1 doc');
  }

  const outFile = path.join(DATA_DIR, 'firestore-export.json');
  fs.writeFileSync(outFile, JSON.stringify(allData, null, 2), 'utf-8');
  console.log(`\n✅ Export เสร็จ → ${outFile}`);

  // สร้าง uid-map.json template
  if (!fs.existsSync(UID_MAP_FILE)) {
    const members = allData['members'] || {};
    const template = {};
    for (const [id, data] of Object.entries(members)) {
      // เฉพาะ members ที่ login ด้วย Google (uid ไม่ใช่ empId)
      if (data.uid && data.uid === id && !data.empId?.includes(id)) {
        template[id] = '<<NEW_UID_HERE>>';
      }
    }
    fs.writeFileSync(UID_MAP_FILE, JSON.stringify(template, null, 2), 'utf-8');
    console.log(`\n📝 สร้าง uid-map.json template → ${UID_MAP_FILE}`);
    console.log('   แก้ไขไฟล์นี้: ใส่ New UID ของแต่ละคนที่ login ด้วย Google');
    console.log('   (สมาชิกที่ login ด้วย PIN ไม่ต้องใส่ — UID เป็น empId ไม่เปลี่ยน)\n');
  } else {
    console.log(`\n📝 uid-map.json มีอยู่แล้ว → ${UID_MAP_FILE}`);
  }

  await oldApp.delete();
}

// ─────────────────────────────────────────────
// PHASE 3: IMPORT
// ─────────────────────────────────────────────
async function runImport() {
  console.log('\n══ PHASE 3: IMPORT ══');

  const exportFile = path.join(DATA_DIR, 'firestore-export.json');
  if (!fs.existsSync(exportFile)) {
    console.error('❌ ไม่พบ migration-data/firestore-export.json — รัน export ก่อน');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(SCRIPTS_DIR, 'new-service-account.json'))) {
    console.error('❌ ไม่พบ new-service-account.json ใน scripts/');
    process.exit(1);
  }

  // โหลด UID map
  let uidMap = {};
  if (fs.existsSync(UID_MAP_FILE)) {
    uidMap = JSON.parse(fs.readFileSync(UID_MAP_FILE, 'utf-8'));
    // กรอง entry ที่ยังไม่ได้แก้
    const pending = Object.entries(uidMap).filter(([, v]) => v === '<<NEW_UID_HERE>>');
    if (pending.length > 0) {
      console.warn(`⚠️  uid-map.json ยังมี ${pending.length} รายการที่ยังไม่ได้ใส่ New UID:`);
      pending.forEach(([k]) => console.warn(`     ${k}`));
      console.warn('   รายการเหล่านี้จะใช้ UID เดิม (อาจ login ด้วย Google ไม่ได้)');
      console.warn('   กด Ctrl+C เพื่อยกเลิก หรือรอ 5 วินาทีเพื่อดำเนินการต่อ...\n');
      await new Promise(r => setTimeout(r, 5000));
      // ลบ entry ที่ยังไม่ได้แก้ออก (ใช้ key เดิม)
      for (const [k] of pending) delete uidMap[k];
    }
  } else {
    console.log('ℹ️  ไม่พบ uid-map.json — ใช้ doc ID เดิมทั้งหมด');
  }

  const allData = JSON.parse(fs.readFileSync(exportFile, 'utf-8'));

  const newApp = loadApp('new-service-account.json', 'new');
  const db = newApp.firestore();

  for (const col of COLLECTIONS) {
    if (allData[col] && Object.keys(allData[col]).length > 0) {
      await importCollection(db, col, allData[col], uidMap);
    } else {
      console.log(`  → ${col}: ไม่มีข้อมูล ข้าม`);
    }
  }

  // import settings doc
  if (allData['settings']?.[SETTINGS_DOC]) {
    console.log('  → import settings/system...');
    await db.collection('settings').doc(SETTINGS_DOC).set(allData['settings'][SETTINGS_DOC]);
    console.log('     1 doc');
  }

  console.log('\n✅ Import เสร็จสมบูรณ์');
  console.log('\n── ขั้นตอนต่อไป ──');
  console.log('1. อัปเดต src/firebase.ts ด้วย config ของ project ใหม่');
  console.log('2. รัน: npm run build && firebase deploy (ใช้ project ใหม่)');
  console.log('3. ทดสอบ login + ตรวจสอบข้อมูล\n');

  await newApp.delete();
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
(async () => {
  if (PHASE === 'export') {
    await runExport();
  } else if (PHASE === 'import') {
    await runImport();
  } else {
    console.log(`
ใช้งาน:
  node scripts/migrate.js export   ← ดึงข้อมูลจาก project เก่า
  node scripts/migrate.js import   ← นำเข้าข้อมูลไป project ใหม่

ไฟล์ที่ต้องเตรียม (วางใน scripts/):
  old-service-account.json   ← Service Account ของ project เก่า
  new-service-account.json   ← Service Account ของ project ใหม่

ไฟล์ที่ script สร้างให้:
  scripts/migration-data/firestore-export.json  ← ข้อมูลทั้งหมด
  scripts/uid-map.json                          ← template mapping UID
    `);
  }
})().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
