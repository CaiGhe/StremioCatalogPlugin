// ============================================================
// build.js — đọc catalog/{movie,series}/*.json → sinh manifest.json
// Quy tắc:
//  - Chỉ khai báo catalog có ≥ 1 item.
//  - KHÔNG khai báo resource stream/subtitles (addon này chỉ catalog).
// Chạy: node build.js
// ============================================================
const fs = require('fs');
const path = require('path');
const C = require('./config');

function main() {
  // ---- Tự tăng version mỗi lần build (+1 bản vá) để Stremio/Nuvio
  //      nhận dữ liệu mới thay vì dùng cache manifest cũ ----
  let version = C.ADDON_VERSION;
  try {
    const old = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
    const parts = String(old.version || '').split('.').map((n) => parseInt(n, 10) || 0);
    if (parts.length === 3) version = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  } catch (e) { /* chưa có manifest → dùng version gốc trong config */ }

  const catalogs = [];
  const missing = [];
  let total = 0;

  for (const cat of C.CATALOGS) {
    const file = path.join(__dirname, 'catalog', cat.type, `${cat.id}.json`);
    let count = 0;
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        count = Array.isArray(data.metas) ? data.metas.length : 0;
      } catch (e) {
        console.warn(`[WARN] File catalog lỗi, bỏ qua: ${file} (${e.message})`);
      }
    }
    if (count > 0) {
      catalogs.push({ type: cat.type, id: cat.id, name: cat.name });
      total += count;
    } else {
      missing.push(cat.id);
    }
  }

  const manifest = {
    id: C.ADDON_ID,
    version,
    name: C.ADDON_NAME,
    description: C.ADDON_DESCRIPTION,
    resources: ['catalog'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs,
    behaviorHints: { configurable: false },
  };

  const out = path.join(__dirname, 'manifest.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`✔ manifest.json: ${catalogs.length} catalogs / ${total} items`);
  if (missing.length) console.warn(`[WARN] Catalog trống, không khai báo: ${missing.join(', ')}`);

  // ---- Tự kiểm tra tối thiểu theo schema manifest của Stremio ----
  const errors = [];
  if (!/^([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+$/.test(manifest.id)) errors.push('id không đúng định dạng domain-like');
  if (!Array.isArray(manifest.resources) || manifest.resources.length !== 1 || manifest.resources[0] !== 'catalog') {
    errors.push('resources phải là ["catalog"]');
  }
  if (!manifest.types.includes('movie') || !manifest.types.includes('series')) errors.push('types thiếu movie/series');
  if (!manifest.idPrefixes.includes('tt')) errors.push('idPrefixes phải chứa "tt"');
  const ids = catalogs.map((c) => c.id);
  if (new Set(ids).size !== ids.length) errors.push('catalog id bị trùng');
  for (const c of catalogs) {
    if (!c.type || !c.id || !c.name) errors.push(`catalog thiếu trường: ${JSON.stringify(c)}`);
  }
  if (errors.length) {
    console.error('[LỖI] Manifest không hợp lệ:', errors.join('; '));
    process.exit(1);
  }
  console.log('✔ Manifest hợp lệ (kiểm tra schema tối thiểu của Stremio).');
  console.log('\nSau khi push lên GitHub + bật Pages, manifest URL sẽ là:');
  console.log('  https://<user>.github.io/<repo>/manifest.json');
  console.log('Dán URL đó vào Stremio (Addons → Community) hoặc Nuvio (Settings → Addons).');
}

main();
