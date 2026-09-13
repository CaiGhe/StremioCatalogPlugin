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
const kkphimweb = require('./kkphimweb');

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
  episodes: (m) => (m && m.episodes) || [],
};

// fetch.js sẽ tiêm hàm resolve IMDb từ TMDB (dùng cho phim thiếu imdb.id
// nhưng có tmdb.id — cần TMDB_API_KEY). Tránh phụ thuộc vòng nên không require trực tiếp.
let tmdbResolver = null;
function setTmdbResolver(fn) { tmdbResolver = fn; }

// Cache chi tiết toàn process (dùng lại giữa các catalog trong 1 lần chạy)
const detailCache = new Map();
let detailCalls = 0;
let apiDetailFails = 0;
async function getDetail(slug, log) {
  if (detailCache.has(slug)) return detailCache.get(slug);
  if (detailCalls >= C.DETAIL_CALL_CAP) return null; // giới hạn số call chi tiết/catalog
  detailCalls++;
  try {
    const d = await httpGet(F.detailPath(slug));
    const movie = (d && d.movie) || null;
    // ⚠️ episodes nằm ở TOP-LEVEL của response (d.episodes), KHÔNG phải trong
    // d.movie (đã xác minh thực tế 09/2026 với phim 'mui-pho'). Ghép vào movie
    // để extractStreams() đọc một chỗ cho gọn.
    if (movie && Array.isArray(d.episodes)) movie.episodes = d.episodes;
    detailCache.set(slug, movie);
    return movie;
  } catch (e) {
    apiDetailFails++;
    log.warn(`KKPhim chi tiết lỗi ${slug}: ${e.message}`);
    detailCache.set(slug, null);
    return null;
  }
}

// Trích link phát (m3u8/mp4) từ movie.episodes[].server_data[].
// Dùng cho resource stream của Stremio — phim LẺ (movie) mới ghi file.
// Link tương đối '//' → thêm https:. Chỉ nhận URL public chứa .m3u8/.mp4.
function extractStreams(mv) {
  const out = [];
  // quality/lang của phim (vd '1080p' + 'Vietsub') → dòng thứ 2 của title
  const meta = [mv && mv.quality, mv && mv.lang].filter(Boolean).join(' ').trim();
  for (const ep of F.episodes(mv)) {
    const server = String((ep && ep.server_name) || 'KKPhim').trim() || 'KKPhim';
    for (const sd of ((ep && ep.server_data) || [])) {
      let url = String((sd && (sd.link_m3u8 || sd.link)) || '').trim();
      if (url.startsWith('//')) url = 'https:' + url;
      if (!/^https?:\/\//.test(url)) continue;
      if (!(/\.m3u8($|\?)/i.test(url) || /\.mp4($|\?)/i.test(url))) continue;
      const epName = String((sd && sd.name) || '').trim();
      const line2 = meta || epName || '';
      out.push({ title: line2 ? `${server}\n${line2}` : server, url });
    }
  }
  return out;
}

// Lấy 1 catalog qua API phimapi.com: gom list nhiều trang → lọc theo type → giữ item có IMDb
// (hoặc resolve được qua TMDB) → gọi chi tiết để lấy mô tả tiếng Việt.
async function fetchViaApi(srcDef, catalogType, log) {
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

  // 3) Gọi trang chi tiết để lấy mô tả tiếng Việt + rating + poster + LINK PHÁT
  for (const e of out) {
    if (e.description && e.streams) continue; // có đủ rồi thì khỏi gọi lại
    const mv = await getDetail(e.slug, log);
    if (!mv) continue;
    e.description = F.description(mv);
    e.streams = extractStreams(mv); // link m3u8 lấy KÈM — không tốn thêm request
    if (!e.releaseInfo && mv.year) e.releaseInfo = String(mv.year);
    if (!e.imdbRating && mv.imdb && mv.imdb.vote_average > 0) e.imdbRating = String(mv.imdb.vote_average);
    const p = pickPoster(C.KKPHIM_IMG, mv.poster_url, mv.thumb_url);
    if (p) e.poster = p;
  }
  // API bị chặn nửa chừng (list OK nhưng chi tiết lỗi hàng loạt → 0 mô tả)
  // → ném lỗi để wrapper bên dưới chuyển sang scrape web
  if (out.length && detailCalls > 0 && apiDetailFails > 0 && out.every((e) => !e.description)) {
    throw new Error('API chi tiết lỗi hàng loạt (mọi phim thiếu mô tả)');
  }
  return out;
}

// Điểm vào chính: ưu tiên API (nhanh, có sẵn mô tả HTML) — lỗi (403/429/5xx/mạng)
// thì TỰ ĐỘNG chuyển sang scrape web kkphim.com (domain khác, thường không bị chặn cùng lúc).
async function fetchCatalog(srcDef, catalogType, log) {
  try {
    return await fetchViaApi(srcDef, catalogType, log);
  } catch (e) {
    log.warn(`KKPhim API lỗi (${e.message}) — chuyển sang chế độ SCRAPE web kkphim.com…`);
    try {
      const out = await kkphimweb.fetchCatalog(srcDef, catalogType, log);
      if (out.length) {
        log.info(`Chế độ scrape web thành công: ${out.length} entry (kkphim.com).`);
        return out;
      }
      log.warn('Scrape web không lấy được entry nào — báo lỗi nguồn như cũ.');
    } catch (e2) {
      log.warn(`Scrape web cũng lỗi: ${e2.message}`);
    }
    throw e; // lỗi gốc — fetch.js sẽ bỏ qua nguồn này, catalog vẫn xuất từ nguồn còn lại
  }
}

module.exports = { fetchCatalog, setTmdbResolver, extractStreams };
