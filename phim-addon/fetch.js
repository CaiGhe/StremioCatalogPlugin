// ============================================================
// fetch.js — ĐIỀU PHỐI TỔNG:
//   fetch tất cả nguồn → gộp/dedupe theo IMDb ID → bù mô tả tiếng Việt
//   (NguonC) → bù metadata + xác thực ID sống (Cinemeta) → ghi
//   catalog/{type}/{id}.json
// Chạy: node fetch.js   (idempotent — chạy lại chỉ ghi đè, không trùng dữ liệu)
// ============================================================
const fs = require('fs');
const path = require('path');
const C = require('./config');
const kkphim = require('./sources/kkphim');
const nguonc = require('./sources/nguonc');
const tmdb = require('./sources/tmdb');
const cinemeta = require('./sources/cinemeta');
const { writeJsonSafe } = require('./util');

const SOURCES = { kkphim, nguonc, tmdb };
const log = {
  info: (...a) => console.log('[INFO] ', ...a),
  warn: (...a) => console.log('[WARN] ', ...a),
};

// KKPhim có thể resolve IMDb qua tmdb_id (chỉ khi có TMDB_API_KEY)
kkphim.setTmdbResolver(tmdb.resolveImdb);

// ---- Chấm điểm bản ghi để chọn bản tốt nhất khi trùng IMDb ID ----
function score(e) {
  let s = 0;
  if (e.description && e.description.length > 30) s += 2;
  if (e.description && e.description.length > 120) s += 1;
  if (e.poster) s += 1;
  if (e.releaseInfo) s += 1;
  if (e.source === 'kkphim' || e.source === 'nguonc') s += 1; // mô tả tiếng Việt
  return s;
}

// ---- Gộp entry theo IMDb ID: giữ bản điểm cao nhất + bù trường thiếu ----
function mergeByImdb(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (!e.imdbId || !C.IMDB_ID_RE.test(e.imdbId)) continue; // không có IMDb ID → LOẠI (quy tắc bắt buộc)
    if (!groups.has(e.imdbId)) groups.set(e.imdbId, []);
    groups.get(e.imdbId).push(e);
  }
  const out = [];
  for (const arr of groups.values()) {
    arr.forEach((e) => (e._score = score(e)));
    arr.sort((a, b) => b._score - a._score);
    const best = { ...arr[0] };
    for (const other of arr.slice(1)) {
      if (!best.poster && other.poster) best.poster = other.poster;
      if (!best.description && other.description) best.description = other.description;
      if (!best.releaseInfo && other.releaseInfo) best.releaseInfo = other.releaseInfo;
      if (!best.imdbRating && other.imdbRating) best.imdbRating = other.imdbRating;
      if (!best.name && other.name) best.name = other.name;
    }
    out.push(best);
  }
  return out;
}

// ---- Entry → meta catalog Stremio (bo trống, đủ tên mới giữ) ----
function toMeta(e) {
  const name = (e.name || e.originalName || '').trim();
  if (!name) return null;
  const m = { id: e.imdbId, type: e.type, name };
  if (e.poster) m.poster = e.poster;
  if (e.description) m.description = e.description;
  if (e.releaseInfo) m.releaseInfo = String(e.releaseInfo);
  if (e.imdbRating) m.imdbRating = String(e.imdbRating);
  return m;
}

// ---- Sắp thứ tự trường đúng như ví dụ spec ----
function orderMeta(m) {
  const o = { id: m.id, type: m.type, name: m.name };
  if (m.poster) o.poster = m.poster;
  if (m.description) o.description = m.description;
  if (m.releaseInfo) o.releaseInfo = m.releaseInfo;
  if (m.imdbRating) o.imdbRating = m.imdbRating;
  return o;
}

// ---- Xoá file catalog cũ không còn khai báo trong config ----
function cleanupStale() {
  const valid = new Set(C.CATALOGS.map((c) => path.join('catalog', c.type, `${c.id}.json`)));
  for (const type of ['movie', 'series']) {
    const dir = path.join(__dirname, 'catalog', type);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const rel = path.join('catalog', type, f);
      if (!valid.has(rel)) {
        fs.rmSync(path.join(dir, f));
        log.warn(`Đã xoá file cũ không còn trong config: ${rel}`);
      }
    }
  }
}

async function main() {
  const t0 = Date.now();
  console.log('=== FETCH CATALOG — Phim Theo Quốc Gia (Stremio/Nuvio static addon) ===');
  if (!C.TMDB_API_KEY) {
    log.warn('TMDB_API_KEY chưa đặt — chạy chỉ với KKPhim + NguonC. Anime / Hoạt hình (Bộ) / Tài liệu có thể trống.');
  }
  cleanupStale();

  // Tuỳ chọn chạy tiếp khi bị gián đoạn: SKIP_EXISTING=1 → bỏ qua catalog đã có file
  const SKIP_EXISTING = process.env.SKIP_EXISTING === '1';
  if (SKIP_EXISTING) log.info('SKIP_EXISTING=1 — bỏ qua các catalog đã có dữ liệu.');

  const summary = [];
  let total = 0;

  for (const cat of C.CATALOGS) {
    console.log(`\n=== ${cat.id} (${cat.type}) — ${cat.name} ===`);
    const outFile = path.join(__dirname, 'catalog', cat.type, `${cat.id}.json`);
    if (SKIP_EXISTING && fs.existsSync(outFile)) {
      try {
        const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        const n = Array.isArray(prev.metas) ? prev.metas.length : 0;
        if (n > 0) {
          log.info(`Đã có ${n} items — bỏ qua.`);
          summary.push([cat.id, n]);
          total += n;
          continue;
        }
      } catch (e) { /* file hỏng → fetch lại bình thường */ }
    }
    let entries = [];
    const nguoncCountries = [];

    // 1) Fetch từng nguồn; nguồn chết → cảnh báo + bỏ qua, catalog vẫn xuất
    for (const src of cat.sources) {
      const mod = SOURCES[src.source];
      if (!mod) { log.warn(`Nguồn không rõ: ${src.source}`); continue; }
      if (src.source === 'nguonc') { nguoncCountries.push(src.country); continue; } // xử lý ở bước bù
      try {
        const t = Date.now();
        const items = await mod.fetchCatalog(src, cat.type, log);
        log.info(`Nguồn ${src.source}: ${items.length} entry thô (${((Date.now() - t) / 1000).toFixed(1)}s)`);
        entries = entries.concat(items);
      } catch (e) {
        log.warn(`Nguồn ${src.source} chết/lỗi — bỏ qua: ${e.message}`);
      }
    }

    // 2) Lọc IMDb + gộp/dedupe theo IMDb ID
    const merged = mergeByImdb(entries);
    log.info(`Sau lọc IMDb + dedupe: ${merged.length} phim`);

    // 3) Bù mô tả tiếng Việt từ NguonC (ghép theo tên gốc + năm)
    for (const country of nguoncCountries) {
      for (const e of merged) {
        if (!e.description || !e.poster) await nguonc.fillEntry(e, country, log);
      }
    }

    // 4) Cinemeta: bù metadata thiếu + loại IMDb ID chết → đến khi đủ TARGET
    const metas = [];
    for (const e of merged) {
      if (metas.length >= C.TARGET_PER_CATALOG) break;
      const m = toMeta(e);
      if (!m) continue;
      try {
        const keep = await cinemeta.enrich(m, log);
        if (keep) metas.push(orderMeta(m));
      } catch (e2) {
        log.warn(`Enrich lỗi ${e.imdbId}: ${e2.message} — vẫn giữ phim`);
        metas.push(orderMeta(m));
      }
    }

    // 5) Ghi file catalog (chỉ ghi khi có item)
    if (metas.length) {
      const file = path.join(__dirname, 'catalog', cat.type, `${cat.id}.json`);
      writeJsonSafe(file, { metas });
      total += metas.length;
      log.info(`→ catalog/${cat.type}/${cat.id}.json : ${metas.length} items`);
      const vd = metas.find((m) => m.description) || metas[0];
      log.info(`   Ví dụ: ${vd.name}${vd.releaseInfo ? ' (' + vd.releaseInfo + ')' : ''} — ${vd.id}${vd.imdbRating ? ' — IMDb ' + vd.imdbRating : ''}`);
    } else {
      log.warn(`→ Catalog ${cat.id} TRỐNG — không ghi file (sẽ không xuất hiện trong manifest).`);
    }
    if (metas.length && metas.length < C.MIN_PER_CATALOG) {
      log.warn(`Catalog ${cat.id} chỉ có ${metas.length} item (< ${C.MIN_PER_CATALOG}) — nên kiểm tra lại nguồn.`);
    }
    summary.push([cat.id, metas.length]);
  }

  console.log('\n================ TỔNG KẾT ================');
  for (const [id, n] of summary) console.log(`  ${id.padEnd(14)} ${String(n).padStart(3)} items`);
  console.log(`Tổng cộng: ${total} items — thời gian ${((Date.now() - t0) / 60000).toFixed(1)} phút`);
  console.log('Bước tiếp theo: node build.js để sinh manifest.json');
}

main().catch((e) => {
  console.error('[FATAL]', e);
  if (e && (e.status === 403 || e.status === 429 || /HTTP 40[34]|HTTP 429/.test(String(e.message)))) {
    console.error('\n[FATAL] Nguồn đang chặn (403/429) — server nghi request là bot. Cách xử lý (README mục "Lỗi HTTP 403"):');
    console.error('  1. Đợi 15-30 phút rồi chạy lại: SKIP_EXISTING=1 node fetch.js (tiếp tục chỗ dở, không mất dữ liệu cũ)');
    console.error('  2. Giảm tốc độ: DELAY_MS=800 node fetch.js');
    console.error('  3. Đổi mạng / tắt-bật VPN, hoặc đi qua proxy: HTTPS_PROXY=http://host:port node fetch.js');
  }
  process.exit(1);
});
