// ============================================================
// sources/kkphim.js — Nguồn KKPhim (phimapi.com)
// ĐÃ XÁC MINH response thực tế (09/2025):
//  - List : GET /v1/api/danh-sach/{phim-le|phim-bo}?country={slug}&page={n}
//           data.items[] có: name, origin_name, slug, year,
//           type('single'|'series'), poster_url (tương đối HOẶC tuyệt đối),
//           imdb:{id, vote_average, vote_count}, tmdb:{id, type}.
//           List KHÔNG có mô tả → bắt buộc gọi trang chi tiết.
//           Lưu ý: 'hoathinh' KHÔNG phải danh-sach (404) — Hoạt Hình là
//           THỂ LOẠI, lọc bằng query ?category=hoat-hinh.
//  - Chi tiết: GET /phim/{slug} → movie.content (mô tả tiếng Việt, HTML),
//           movie.imdb.vote_average = điểm IMDb thật
//           (đối chiếu: Ký Sinh Trùng tt6751668 = 8.5 ✓).
// ============================================================
const C = require('../config');
const { httpGet, stripHtml, imdbFrom, pickPoster } = require('../util');

// ---- FIELD MAP: nếu KKPhim đổi tên trường, chỉ cần sửa ở đây ----
const F = {
  listPath: (category, country, page, genre) => {
    let url = `${C.KKPHIM_BASE}/v1/api/danh-sach/${category}?page=${page}`;
    if (country) url += `&country=${country}`;
    if (genre) url += `&category=${genre}`; // lọc thể loại (vd: hoat-hinh)
    return url;
  },
  detailPath: (slug) => `${C.KKPHIM_BASE}/phim/${slug}`,
  items: (d) => (d && d.data && d.data.items) || (d && d.items) || [],
  name: (it) => it.name,
  originalName: (it) => it.origin_name,
  slug: (it) => it.slug,
  year: (it) => (it.year ? String(it.year) : ''),
  type: (it) => (it.type === 'single' ? 'movie' : it.type === 'series' ? 'series' : null),
  poster: (it) => pickPoster(C.KKPHIM_IMG, it.poster_url, it.thumb_url),
  imdbId: (it) => imdbFrom(it.imdb && it.imdb.id) || imdbFrom(it.imdb_id),
  imdbRating: (it) => {
    const im = it.imdb || {};
    return im.vote_average > 0 ? String(im.vote_average) : null;
  },
  tmdbId: (it) => (it.tmdb && it.tmdb.id) || null,
  tmdbType: (it) => (it.tmdb && it.tmdb.type) || null,
  description: (m) => stripHtml(m && m.content),
};

// fetch.js sẽ tiêm hàm resolve IMDb từ TMDB (dùng cho phim thiếu imdb.id
// nhưng có tmdb.id — cần TMDB_API_KEY). Tránh phụ thuộc vòng nên không require trực tiếp.
let tmdbResolver = null;
function setTmdbResolver(fn) { tmdbResolver = fn; }

// Cache chi tiết toàn process (dùng lại giữa các catalog trong 1 lần chạy)
const detailCache = new Map();
let detailCalls = 0;
async function getDetail(slug, log) {
  if (detailCache.has(slug)) return detailCache.get(slug);
  if (detailCalls >= C.DETAIL_CALL_CAP) return null; // giới hạn số call chi tiết/catalog
  detailCalls++;
  try {
    const d = await httpGet(F.detailPath(slug));
    const movie = (d && d.movie) || null;
    detailCache.set(slug, movie);
    return movie;
  } catch (e) {
    log.warn(`KKPhim chi tiết lỗi ${slug}: ${e.message}`);
    detailCache.set(slug, null);
    return null;
  }
}

// Lấy 1 catalog: gom list nhiều trang → lọc theo type → giữ item có IMDb
// (hoặc resolve được qua TMDB) → gọi chi tiết để lấy mô tả tiếng Việt.
async function fetchCatalog(srcDef, catalogType, log) {
  detailCalls = 0; // reset giới hạn cho từng catalog
  const pending = [];
  const seen = new Set();

  // 1) Gom ứng viên từ các trang list
  for (let page = 1; page <= C.MAX_PAGES_PER_SOURCE; page++) {
    const data = await httpGet(F.listPath(srcDef.category, srcDef.country, page, srcDef.genre));
    const items = F.items(data);
    if (!items.length) break;
    for (const it of items) {
      const t = F.type(it);
      if (t !== catalogType) continue; // catalog movie chỉ lấy 'single'…
      const slug = F.slug(it);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      pending.push(it);
    }
    const useful = pending.filter((it) => F.imdbId(it) || (tmdbResolver && F.tmdbId(it))).length;
    if (useful >= Math.ceil(C.TARGET_PER_CATALOG * 1.4)) break; // đã đủ dư địa
  }

  // 2) Lọc: phải có IMDb ID (trực tiếp hoặc resolve qua tmdb_id)
  const out = [];
  for (const it of pending) {
    if (out.length >= Math.ceil(C.TARGET_PER_CATALOG * 1.3)) break; // dư 30% cho bước lọc sau
    const slug = F.slug(it);
    if (!slug) continue;
    let imdbId = F.imdbId(it);
    if (!imdbId && tmdbResolver && F.tmdbId(it)) {
      const kind = F.tmdbType(it) === 'tv' || catalogType === 'series' ? 'tv' : 'movie';
      imdbId = await tmdbResolver(String(F.tmdbId(it)), kind, log);
      if (imdbId) log.info(`  KKPhim resolve tmdb_id=${F.tmdbId(it)} → ${imdbId} (${F.name(it)})`);
    }
    if (!imdbId) continue; // quy tắc bắt buộc: không có IMDb ID → LOẠI
    out.push({
      source: 'kkphim',
      type: catalogType,
      imdbId,
      name: String(F.name(it) || '').trim(),
      originalName: String(F.originalName(it) || '').trim(),
      poster: F.poster(it),
      description: '',
      releaseInfo: F.year(it),
      imdbRating: F.imdbRating(it),
      slug,
    });
  }

  // 3) Gọi trang chi tiết để lấy mô tả tiếng Việt + rating + poster tốt hơn
  for (const e of out) {
    if (e.description) continue;
    const mv = await getDetail(e.slug, log);
    if (!mv) continue;
    e.description = F.description(mv);
    if (!e.releaseInfo && mv.year) e.releaseInfo = String(mv.year);
    if (!e.imdbRating && mv.imdb && mv.imdb.vote_average > 0) e.imdbRating = String(mv.imdb.vote_average);
    const p = pickPoster(C.KKPHIM_IMG, mv.poster_url, mv.thumb_url);
    if (p) e.poster = p;
  }
  return out;
}

module.exports = { fetchCatalog, setTmdbResolver };
