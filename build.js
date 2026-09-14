// ============================================================
// build.js — đọc catalog/{movie,series}/*.json → sinh manifest.json
// + CHIA TRANG (skip) cho CUỘN VÔ HẠN kiểu Facebook/TikTok:
//   Stremio/Nuvio chỉ hiện tối đa ~100 item mỗi lần trả → khai báo
//   extra "skip" và ghi catalog/{type}/{id}/skip=100.json, skip=200.json…
//   để app tự nạp trang tiếp theo khi người dùng cuộn xuống (infinite
//   scroll). Nhờ vậy MỌI phim đã fetch đều với tới được, không cắt cụt.
// Quy tắc:
//  - Chỉ khai báo catalog có ≥ 1 item.
//  - Có file stream/movie/*.json (link phát KKPhim) → khai báo resource
//    "stream" để Stremio hỏi link phát khi bấm vào phim lẻ.
// Chạy: node build.js
// ============================================================
const fs = require('fs');
const path = require('path');
const C = require('./config');

const PAGE_SIZE = 100; // Stremio giới hạn ~100 item/lần trả

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

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
  const fullMetas = []; // giữ TOÀN BỘ item (mọi trang) cho search-index

  // Có file stream không? (fetch.js ghi stream/movie/{imdbId}.json)
  const streamDir = path.join(__dirname, 'stream', 'movie');
  const nStreamFiles = fs.existsSync(streamDir)
    ? fs.readdirSync(streamDir).filter((f) => f.endsWith('.json')).length
    : 0;

  for (const cat of C.CATALOGS) {
    const file = path.join(__dirname, 'catalog', cat.type, `${cat.id}.json`);
    let metas = [];
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        metas = Array.isArray(data.metas) ? data.metas : [];
      } catch (e) {
        console.warn(`[WARN] File catalog lỗi, bỏ qua: ${file} (${e.message})`);
      }
    }
    if (!metas.length) { missing.push(cat.id); continue; }

    // ---- Chia trang: file chính = trang 1, còn lại vào skip=100, skip=200… ----
    const pages = [];
    for (let i = 0; i < metas.length; i += PAGE_SIZE) pages.push(metas.slice(i, i + PAGE_SIZE));
    writeJson(file, { metas: pages[0] }); // ghi đè file gốc = chỉ trang 1

    // Thư mục con cùng tên chứa các trang skip (catalog/movie/viet-movie/skip=100.json)
    const dir = path.join(__dirname, 'catalog', cat.type, cat.id);
    fs.mkdirSync(dir, { recursive: true });
    const written = new Set(['skip=0.json']);
    writeJson(path.join(dir, 'skip=0.json'), { metas: pages[0] }); // một số client yêu cầu skip=0 thẳng
    for (let p = 1; p < pages.length; p++) {
      const name = `skip=${p * PAGE_SIZE}.json`;
      writeJson(path.join(dir, name), { metas: pages[p] });
      written.add(name);
    }
    // Dọn trang cũ nếu catalog co lại (vd lần trước 300, lần này 200)
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json') && !written.has(f)) fs.rmSync(path.join(dir, f));
    }

    catalogs.push({
      type: cat.type,
      id: cat.id,
      name: cat.name,
      extra: [{ name: 'skip', isRequired: false }], // bật cuộn vô hạn
    });
    fullMetas.push({ cat, metas });
    total += metas.length;
  }

  const manifest = {
    id: C.ADDON_ID,
    version,
    name: C.ADDON_NAME,
    description: C.ADDON_DESCRIPTION,
    resources: nStreamFiles > 0 ? ['catalog', 'stream'] : ['catalog'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs,
    behaviorHints: { configurable: false },
  };

  writeJson(path.join(__dirname, 'manifest.json'), manifest);
  console.log(`✔ manifest.json: ${catalogs.length} catalogs / ${total} items / resources [${manifest.resources.join(', ')}]${nStreamFiles ? ` / ${nStreamFiles} file stream` : ''}`);
  if (missing.length) console.warn(`[WARN] Catalog trống, không khai báo: ${missing.join(', ')}`);

  // ---- Sinh search-index.json — chỉ mục TÌM KIẾM gọn cho worker (Cloudflare) ----
  // Pages tĩnh không trả được /search=... động → worker đứng trước, đọc file này
  // và tự ghép kết quả (xem worker.js). Không dùng worker thì file này vô hại.
  const indexItems = [];
  for (const { cat, metas } of fullMetas) {
    for (const m of metas) {
      if (!m.id || !m.name) continue;
      indexItems.push({ id: m.id, t: cat.type, n: m.name, p: m.poster || '', y: m.releaseInfo || '', c: cat.id });
    }
  }
  fs.writeFileSync(
    path.join(__dirname, 'search-index.json'),
    JSON.stringify({ gen: new Date().toISOString().slice(0, 10), items: indexItems }),
    'utf8',
  );
  console.log(`✔ search-index.json: ${indexItems.length} phim (chỉ mục tìm kiếm cho worker)`);

  // ---- Tự kiểm tra tối thiểu theo schema manifest của Stremio ----
  const errors = [];
  if (!/^([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+$/.test(manifest.id)) errors.push('id không đúng định dạng domain-like');
  const resOk = Array.isArray(manifest.resources) && manifest.resources.length >= 1
    && manifest.resources[0] === 'catalog'
    && manifest.resources.every((r) => r === 'catalog' || r === 'stream');
  if (!resOk) errors.push('resources chỉ được gồm "catalog" và "stream"');
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
