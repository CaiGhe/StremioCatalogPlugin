// ============================================================
// sources/nguonc.js — Nguồn NguonC (phim.nguonc.com)
// ĐÃ XÁC MINH response thực tế (09/2025):
//  - List  : GET /api/films/quoc-gia/{slug}?page={n} → items[] CÓ SẴN
//            description (tiếng Việt), year, poster_url, original_name.
//            items_per_page = 10. paginate.total_page.
//  - Chi tiết: GET /api/film/{slug} → movie.category là DICT dạng
//            { "1": {group:{name:'Định dạng'}, list:[{name}...]}, ... }
//  - QUAN TRỌNG: hiện KHÔNG có trường imdb_id ở bất kỳ đâu (đã thử 10
//    detail) → không thể làm nguồn chính theo quy tắc "phải có IMDb ID".
//    → Vai trò trong addon: BỘ BÙ mô tả/poster tiếng Việt, ghép theo
//      tên gốc + năm với phim đã có IMDb ID từ KKPhim (xem fetch.js).
//    Nếu sau này NguonC thêm imdb_id, các entry có ID sẽ tự động đi
//    qua đường gộp chính (dedupe theo IMDb) như mọi nguồn khác.
// ============================================================
const C = require('../config');
const { httpGet, normTitle, pickPoster } = require('../util');

// ---- FIELD MAP: nếu NguonC đổi tên trường, chỉ cần sửa ở đây ----
const F = {
  listPath: (country, page) => `${C.NGUONC_BASE}/api/films/quoc-gia/${country}?page=${page}`,
  detailPath: (slug) => `${C.NGUONC_BASE}/api/film/${slug}`,
  items: (d) => (d && d.items) || [],
  name: (it) => it.name,
  originalName: (it) => it.original_name,
  year: (it) => (it.year ? String(it.year) : ''),
  poster: (it) => pickPoster(C.NGUONC_BASE, it.poster_url, it.thumb_url),
  description: (it) => String(it.description || '').replace(/\s+/g, ' ').trim(),
  imdb: (m) => m && (m.imdb_id || m.imdbId) || null, // sẵn sàng cho tương lai
};

// Chỉ mục ghép tên theo quốc gia: Map "tên-chuẩn-hoá|năm" → dữ liệu bù
const indexes = new Map(); // country → Map

function entryOf(it) {
  const year = F.year(it);
  const poster = F.poster(it);
  const description = F.description(it);
  if (!year || (!poster && !description)) return null;
  return { poster, description, releaseInfo: year };
}

// Lấy/xây chỉ mục 1 quốc gia (cache toàn process, dùng chung các catalog)
async function getIndex(country, log) {
  if (indexes.has(country)) return indexes.get(country);
  const map = new Map();
  try {
    for (let page = 1; page <= C.NGUONC_INDEX_PAGES; page++) {
      const data = await httpGet(F.listPath(country, page));
      const items = F.items(data);
      if (!items.length) break;
      for (const it of items) {
        const entry = entryOf(it);
        if (!entry) continue;
        const y = F.year(it);
        for (const t of [F.originalName(it), F.name(it)]) {
          const n = normTitle(t);
          const key = `${n}|${y}`;
          if (n && !map.has(key)) map.set(key, entry);
        }
      }
    }
    log.info(`NguonC: chỉ mục '${country}' gồm ${map.size} khoá (bộ bù mô tả tiếng Việt)`);
  } catch (e) {
    log.warn(`NguonC lỗi khi xây chỉ mục '${country}' — bỏ qua nguồn này: ${e.message}`);
  }
  indexes.set(country, map);
  return map;
}

// Bù mô tả/poster/năm vào 1 entry đã có IMDb ID (fetch.js gọi)
async function fillEntry(entry, country, log) {
  const idx = await getIndex(country, log);
  if (!idx || !idx.size) return entry;
  const keys = [];
  for (const t of [entry.originalName, entry.name]) {
    const n = normTitle(t);
    if (n && entry.releaseInfo) keys.push(`${n}|${entry.releaseInfo}`);
  }
  for (const key of keys) {
    const f = idx.get(key);
    if (!f) continue;
    if (!entry.description && f.description) entry.description = f.description;
    if (!entry.poster && f.poster) entry.poster = f.poster;
    if (!entry.releaseInfo && f.releaseInfo) entry.releaseInfo = f.releaseInfo;
    break; // chỉ lấy bản khớp đầu tiên
  }
  return entry;
}

// Tương thích kiến trúc chuẩn: nếu sau này NguonC trả imdb_id thì nguồn
// này trở thành nguồn chính bình thường (entry có imdbId sẽ được gộp).
async function fetchCatalog(srcDef, catalogType, log) {
  // Thử nhanh 1 trang đầu: nếu item nào có imdb_id thì trả về dạng entry
  try {
    const data = await httpGet(F.listPath(srcDef.country, 1));
    const items = F.items(data).filter((it) => F.imdb(it));
    if (items.length) {
      log.info('NguonC: phát hiện imdb_id trong list — dùng làm nguồn chính!');
      return items.map((it) => ({
        source: 'nguonc',
        type: catalogType,
        imdbId: String(F.imdb(it)).match(/tt\d{7,10}/i)[0],
        name: String(F.name(it) || '').trim(),
        originalName: String(F.originalName(it) || '').trim(),
        poster: F.poster(it),
        description: F.description(it),
        releaseInfo: F.year(it),
      }));
    }
  } catch (e) {
    log.warn(`NguonC list lỗi — bỏ qua nguồn này: ${e.message}`);
    return [];
  }
  log.warn('NguonC không có IMDb ID (đã kiểm tra) — chỉ dùng làm bộ bù metadata tiếng Việt.');
  return [];
}

module.exports = { fetchCatalog, fillEntry };
