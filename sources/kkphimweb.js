// ============================================================
// sources/kkphimweb.js — SCRAPER web kkphim.com (dự phòng khi API phimapi.com bị 403/chặn)
// ĐÃ XÁC MINH HTML THỰC TẾ (09/2025):
//  - List: GET /danh-sach/{phim-le|phim-bo|hoat-hinh|tv-shows}?country={slug}&page={n}
//          HTML server-render, mỗi trang 24 phim, mỗi phim là 1 hàng <tr> chứa ĐỦ:
//            <img src="https://phimimg.com/...poster.webp">   → poster
//            <a href="/phim/{slug}" class="info-title">Tên vi</a>
//            <div class="info-origin">Tên gốc</div>
//            <td>2026</td>                                    → năm (td đầu dạng năm)
//            themoviedb.org/{movie|tv}/{id}                   → TMDB ID + loại
//            imdb.com/title/ttXXXXXXX/                        → IMDb ID TRỰC TIẾP (không cần TMDB key!)
//            <td>Phim Lẻ|Phim Bộ|TV Shows</td>                → loại phim
//  - Chi tiết: GET /phim/{slug} → <meta name="description"> = mô tả tiếng Việt
//  - Web KHÔNG có trang /danh-sach/tai-lieu (tài liệu) → catalog docs vẫn cần TMDB/API.
//  - ⚠️ kkphim.com (Cloudflare) chặn TLS fingerprint của Node.js: request từ Node
//    (axios lẫn https thuần, dù headers trình duyệt đầy đủ) đều 403 — đã test.
//    → Scraper này gửi request QUA curl (child_process, util.curlGet): curl có
//      TLS fingerprint riêng, được Cloudflare chấp nhận. curl có sẵn trên
//      Linux/macOS/Windows 10+/GitHub Actions.
// ============================================================
const C = require('../config');
const { curlGet, decodeEntities, imdbFrom } = require('../util');

// Trang challenge của Cloudflare (JS challenge — curl không pass được) → báo lỗi rõ thay vì parse rác
function looksLikeChallenge(html) {
  return /Just a moment\.\.\.|challenge-platform\/[hb]\/|cf-chl-browser|Checking your browser|Enable JavaScript and cookies/.test(html)
    && !/info-title/.test(html);
}

// ---- FIELD MAP: nếu kkphim.com đổi markup, chỉ cần sửa các regex ở đây ----
const F = {
  listUrl: (pageCat, country, page) => {
    let url = `${C.KKPHIM_WEB_BASE}/danh-sach/${pageCat}`;
    if (country) url += `?country=${encodeURIComponent(country)}`;
    url += (country ? '&' : '?') + `page=${page}`;
    return url;
  },
  detailUrl: (slug) => `${C.KKPHIM_WEB_BASE}/phim/${slug}`,
  row: {
    slug: /<a href="\/phim\/([a-z0-9-]+)" class="info-title">/,
    title: /class="info-title">([^<]*)</,
    origin: /class="info-origin">([^<]*)</,
    poster: /<img src="(https?:\/\/[^"]+)"/i,
    year: /<td[^>]*>\s*(19\d{2}|20\d{2})\s*</,
    imdb: /imdb\.com\/title\/(tt\d{7,10})/i,
    typeTd: /<td[^>]*>\s*(Phim Lẻ|Phim Bộ|TV Shows)\s*</i,
    rating: /rating-badge[\s\S]*?<\/i>\s*([0-9](?:\.\d)?)/,
  },
  detail: {
    description: /<meta[^>]*name="description"[^>]*content="([^"]*)"/,
    ogImage: /<meta[^>]*property="og:image"[^>]*content="([^"]*)"/,
  },
};

// TMDB marker trong hàng — 2 định dạng tuỳ trang (đã kiểm chứng cả hai):
//   trang phim-le/phim-bo : link https://www.themoviedb.org/movie/1365884
//   trang hoat-hinh       : text thuần trong ô   tv-330275-s1 | movie-21208
function extractTmdb(rowHtml) {
  let m = rowHtml.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
  if (m) return { kind: m[1].toLowerCase(), id: m[2] };
  m = rowHtml.match(/\b(movie|tv)-(\d{2,8})(?:-s\d+)?\b/i);
  if (m) return { kind: m[1].toLowerCase(), id: m[2] };
  return { kind: null, id: null };
}

// 'Phim Lẻ' → movie, 'Phim Bộ'/'TV Shows' → series; không rõ → null (dùng TMDB kind thay)
function rowTypeToCatalog(s) {
  const t = String(s || '').toLowerCase();
  if (t.includes('lẻ')) return 'movie';
  if (t.includes('bộ') || t.includes('tv shows')) return 'series';
  return null;
}

// Parse 1 trang list → mảng entry thô (chưa lọc loại)
function parseListPage(html) {
  const out = [];
  const rows = html.split('<tr').slice(1);
  for (const r of rows) {
    const slugM = r.match(F.row.slug);
    if (!slugM) continue;
    const titleM = r.match(F.row.title);
    const originM = r.match(F.row.origin);
    const posterM = r.match(F.row.poster);
    const yearM = r.match(F.row.year);
    const imdbM = r.match(F.row.imdb);
    const tmdb = extractTmdb(r);
    const typeM = r.match(F.row.typeTd);
    const ratingM = r.match(F.row.rating);
    out.push({
      slug: slugM[1],
      name: decodeEntities(titleM ? titleM[1] : '').trim(),
      originalName: decodeEntities(originM ? originM[1] : '').trim(),
      poster: posterM ? posterM[1] : '',
      releaseInfo: yearM ? yearM[1] : '',
      imdbId: imdbM ? imdbM[1] : imdbFrom(r), // dự phòng: ô imdb dạng text thuần (trang hoat-hinh)
      tmdbId: tmdb.id,
      tmdbKind: tmdb.kind,
      rowType: rowTypeToCatalog(typeM ? typeM[1] : ''),
      imdbRating: ratingM ? ratingM[1] : null,
    });
  }
  return out;
}

// Xác định entry có khớp catalog (movie/series) hay không.
// Ưu tiên cờ loại trên trang; thiếu → dùng TMDB kind; vẫn thiếu → nhận (tránh bỏ sót).
function matchType(entry, catalogType) {
  if (entry.rowType) return entry.rowType === catalogType;
  if (entry.tmdbKind) return (entry.tmdbKind === 'tv') === (catalogType === 'series');
  return true;
}

// Cache chi tiết toàn process (dùng lại giữa các catalog trong 1 lần chạy)
const descCache = new Map();
let detailCalls = 0;
let detailFails = 0;
async function getDescription(slug, log) {
  if (descCache.has(slug)) return descCache.get(slug);
  if (detailCalls >= C.DETAIL_CALL_CAP) return '';
  detailCalls++;
  let desc = '';
  try {
    const body = await curlGet(F.detailUrl(slug));
    const html = typeof body === 'string' ? body : '';
    const m = html.match(F.detail.description);
    if (m) desc = decodeEntities(m[1]).trim();
  } catch (e) {
    detailFails++;
    log.warn(`  Web chi tiết lỗi ${slug}: ${e.message}`);
  }
  descCache.set(slug, desc);
  return desc;
}

// Lấy 1 catalog bằng scrape web — entry đầu ra cùng dạng với kkphim API để fetch.js gộp bình thường
async function fetchCatalog(srcDef, catalogType, log) {
  detailCalls = 0; detailFails = 0;
  // API genre ('hoat-hinh') trên web là trang /danh-sach/ riêng
  const pageCat = srcDef.genre || srcDef.category || 'phim-le';
  if (pageCat === 'tai-lieu') {
    log.warn('Web kkphim.com không có trang /danh-sach/tai-lieu — catalog này cần TMDB hoặc API (khi hết bị chặn).');
    return [];
  }
  const need = Math.ceil(C.TARGET_PER_CATALOG * 1.4);
  const seen = new Set();
  const pool = [];

  // 1) Scrape các trang list (qua curl — Cloudflare chặn TLS của Node, curl thì qua)
  for (let page = 1; page <= C.MAX_PAGES_PER_SOURCE && pool.length < need; page++) {
    const html = await curlGet(F.listUrl(pageCat, srcDef.country, page));
    const body = typeof html === 'string' ? html : '';
    if (!body) break;
    if (looksLikeChallenge(body)) {
      throw new Error('kkphim.com đang bật Cloudflare JS-challenge với IP này — cần đợi/đổi IP (curl không pass được challenge)');
    }
    const items = parseListPage(body);
    if (!items.length) break;
    for (const it of items) {
      if (seen.has(it.slug)) continue;
      seen.add(it.slug);
      // quy tắc bắt buộc: phải có IMDb ID (list web cho trực tiếp) hoặc tmdb id (resolve khi có key)
      if (!it.imdbId && !(it.tmdbId && tmdbResolver)) continue;
      if (!matchType(it, catalogType)) continue;
      pool.push(it);
    }
  }
  log.info(`  Web scrape: ${pool.length} ứng viên từ tối đa ${C.MAX_PAGES_PER_SOURCE} trang /danh-sach/${pageCat}`);

  // 2) Resolve IMDb cho hàng chỉ có tmdb id (cần TMDB_API_KEY) + scrape chi tiết lấy mô tả tiếng Việt
  const cap = Math.ceil(C.TARGET_PER_CATALOG * 1.3);
  const out = [];
  for (const it of pool.slice(0, cap)) {
    let imdbId = it.imdbId;
    if (!imdbId && it.tmdbId && tmdbResolver) {
      const kind = it.tmdbKind === 'tv' ? 'tv' : 'movie';
      imdbId = await tmdbResolver(String(it.tmdbId), kind, log);
      if (imdbId) log.info(`  Web resolve tmdb_id=${it.tmdbId} → ${imdbId} (${it.name})`);
    }
    if (!imdbId) continue; // quy tắc bắt buộc: phải có IMDb ID thật
    const description = await getDescription(it.slug, log);
    out.push({
      source: 'kkphim-web',
      type: catalogType,
      imdbId,
      name: it.name,
      originalName: it.originalName,
      poster: it.poster || '',
      description,
      releaseInfo: it.releaseInfo,
      imdbRating: it.imdbRating,
      slug: it.slug,
    });
  }
  if (out.length && detailCalls > 0 && detailFails > 0 && out.every((e) => !e.description)) {
    throw new Error('Web scrape chi tiết lỗi hàng loạt');
  }
  return out;
}

// fetch.js tiêm hàm resolve TMDB (dùng cho hàng chỉ có tmdb id — hiếm trên web)
let tmdbResolver = null;
function setTmdbResolver(fn) { tmdbResolver = fn; }

module.exports = { fetchCatalog, setTmdbResolver, parseListPage, matchType };
