// ============================================================
// sources/tmdb.js — Nguồn TMDB (cần API key, xem config.js)
// ĐÃ XÁC MINH (09/2025): request chi tiết kèm append_to_response=
// external_ids,images&include_image_language=vi,en,null → 1 request/phim
// lấy được: IMDb ID + poster tiếng Việt + overview tiếng Việt.
// Discover: /discover/movie|tv với language=vi-VN, with_genres=16 (Animation)
// hoặc 99 (Documentary), with_original_language=ja (anime) / en (kids, docs).
// ============================================================
const C = require('../config');
const { httpGet } = require('../util');

let warnedNoKey = false;
const extIdCache = new Map(); // 'movie:123' → imdbId|null (cache resolve cho KKPhim)

// ---- FIELD MAP ----
const F = {
  discover: (kind, p, page) => {
    const qs = new URLSearchParams({
      api_key: C.TMDB_API_KEY || '',
      language: C.TMDB_LANGUAGE,
      sort_by: 'popularity.desc',
      include_adult: 'false',
      page: String(page),
      with_genres: String(p.with_genres),
    });
    if (p.with_original_language) qs.set('with_original_language', p.with_original_language);
    return `${C.TMDB_BASE}/discover/${kind}?${qs.toString()}`;
  },
  detail: (kind, id) =>
    `${C.TMDB_BASE}/${kind}/${id}?api_key=${C.TMDB_API_KEY}&language=${C.TMDB_LANGUAGE}` +
    `&append_to_response=external_ids,images&include_image_language=vi,en,null`,
  enOverview: (kind, id) =>
    `${C.TMDB_BASE}/${kind}/${id}?api_key=${C.TMDB_API_KEY}&language=en-US`,
  externalIds: (kind, id) =>
    `${C.TMDB_BASE}/${kind}/${id}/external_ids?api_key=${C.TMDB_API_KEY}`,
  results: (d) => (d && d.results) || [],
};

// Chọn poster: iso_639_1 === 'vi' → 'en' → không ngôn ngữ → poster gốc
function pickViPoster(imagesBlock, fallbackPath) {
  const posters = (imagesBlock && imagesBlock.posters) || [];
  const pick =
    posters.find((p) => p.iso_639_1 === 'vi') ||
    posters.find((p) => p.iso_639_1 === 'en') ||
    posters.find((p) => !p.iso_639_1);
  if (pick && pick.file_path) return C.TMDB_IMG + pick.file_path;
  return fallbackPath ? C.TMDB_IMG + fallbackPath : '';
}

// Resolve TMDB id → IMDb id (dùng cho phim KKPhim chỉ có tmdb_id; có cache)
async function resolveImdb(tmdbId, kind, log) {
  const key = `${kind}:${tmdbId}`;
  if (extIdCache.has(key)) return extIdCache.get(key);
  let imdb = null;
  try {
    const d = await httpGet(F.externalIds(kind, tmdbId));
    const v = d && d.imdb_id;
    if (v && /^tt\d{7,10}$/.test(v)) imdb = v;
  } catch (e) {
    log.warn(`TMDB external_ids lỗi ${kind}/${tmdbId}: ${e.message}`);
  }
  extIdCache.set(key, imdb);
  return imdb;
}

// Lấy 1 catalog TMDB từ discover + chi tiết từng phim
async function fetchCatalog(srcDef, catalogType, log) {
  if (!C.TMDB_API_KEY) {
    if (!warnedNoKey) {
      log.warn('Chưa có TMDB_API_KEY — bỏ qua nguồn TMDB. Các catalog Anime / Hoạt hình (Bộ) / Tài liệu sẽ trống (xem config.js).');
      warnedNoKey = true;
    }
    return [];
  }
  const kind = srcDef.kind === 'tv' ? 'tv' : 'movie';
  const type = kind === 'tv' ? 'series' : 'movie';
  const cap = Math.ceil(C.TARGET_PER_CATALOG * 1.3);
  const out = [];

  for (let page = 1; page <= C.TMDB_MAX_PAGES && out.length < cap; page++) {
    const d = await httpGet(F.discover(kind, srcDef, page));
    const items = F.results(d);
    if (!items.length) break;

    for (const it of items) {
      if (out.length >= cap) break;
      // 1 request/phim: imdb_id + poster vi + mô tả vi (append_to_response)
      let imdbId = null, poster = '', description = '', name = '', originalName = '', releaseInfo = '';
      try {
        const full = await httpGet(F.detail(kind, it.id));
        const ext = (full && full.external_ids) || {};
        if (ext.imdb_id && /^tt\d{7,10}$/.test(ext.imdb_id)) imdbId = ext.imdb_id;
        poster = C.TMDB_VI_POSTER
          ? pickViPoster(full && full.images, it.poster_path)
          : (it.poster_path ? C.TMDB_IMG + it.poster_path : '');
        description = String((full && full.overview) || '').trim();
        name = String((full && (kind === 'tv' ? full.name : full.title)) || '').trim();
        originalName = String((full && (kind === 'tv' ? full.original_name : full.original_title)) || '').trim();
        const date = full && (kind === 'tv' ? full.first_air_date : full.release_date);
        if (date) releaseInfo = String(date).slice(0, 4);
      } catch (e) {
        continue; // 404/lỗi chi tiết → bỏ qua phim này
      }
      // Mô tả vi rỗng → thử tiếng Anh; vẫn rỗng → bỏ mô tả
      if (!description && C.TMDB_EN_OVERVIEW_FALLBACK) {
        try {
          const en = await httpGet(F.enOverview(kind, it.id));
          description = String((en && en.overview) || '').trim();
        } catch (e) { /* bỏ qua */ }
      }
      if (!imdbId) continue; // quy tắc bắt buộc: phải có IMDb ID
      out.push({
        source: 'tmdb',
        type,
        imdbId,
        name: name || originalName,
        originalName,
        poster,
        description,
        releaseInfo,
      });
    }
  }
  return out;
}

module.exports = { fetchCatalog, resolveImdb };
