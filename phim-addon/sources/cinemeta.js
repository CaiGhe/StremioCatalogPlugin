// ============================================================
// sources/cinemeta.js — Cinemeta của Stremio (metadata dự phòng)
// GET https://v3-cinemeta.strem.io/meta/{type}/{imdb_id}.json
// Dùng để: (a) xác thực IMDb ID còn sống (404 = chết),
//          (b) bù poster/mô tả/năm/imdbRating còn thiếu.
// Lưu ý: mô tả Cinemeta thường là tiếng Anh → CHỈ dùng khi thiếu
//        mô tả tiếng Việt từ KKPhim/NguonC/TMDB.
// ============================================================
const C = require('../config');
const { httpGet } = require('../util');

const cache = new Map(); // 'movie/tt123' → { dead:true } | { meta } | { error:true }

async function getMeta(type, imdbId, log) {
  const key = `${type}/${imdbId}`;
  if (cache.has(key)) return cache.get(key);
  let result;
  try {
    const d = await httpGet(`${C.CINEMETA_BASE}/${type}/${imdbId}.json`);
    const meta = (d && d.meta) || null;
    result = meta ? { meta } : { dead: true };
  } catch (e) {
    if (e.status === 404) {
      result = { dead: true };
    } else {
      log.warn(`Cinemeta lỗi ${imdbId}: ${e.message}`);
      result = { error: true }; // lỗi mạng → không kết luận, giữ phim
    }
  }
  cache.set(key, result);
  return result;
}

// Bù trường thiếu cho 1 meta đầu ra.
// Trả về true nếu GIỮ phim, false nếu LOẠI (IMDb ID chết).
async function enrich(m, log) {
  if (!C.CINEMETA_ENRICH) return true;
  const r = await getMeta(m.type, m.id, log);
  if (r.dead) return !C.CINEMETA_DROP_DEAD_ID;
  if (r.meta) {
    const meta = r.meta;
    if (!m.poster && meta.poster) m.poster = String(meta.poster);
    if (!m.description && meta.description) m.description = String(meta.description).trim();
    if (!m.releaseInfo && meta.releaseInfo) m.releaseInfo = String(meta.releaseInfo);
    if (meta.imdbRating && Number(meta.imdbRating) > 0) m.imdbRating = String(meta.imdbRating);
  }
  return true;
}

module.exports = { enrich };
