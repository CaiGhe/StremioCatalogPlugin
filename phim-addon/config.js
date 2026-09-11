// ============================================================
// config.js — CẤU HÌNH TRUNG TÂM của addon
// URL nguồn, slug danh mục, số lượng item… đều tập trung ở đây.
// Nếu nguồn đổi API/đổi tên trường: sửa file này + phần FIELD MAP
// đầu mỗi file trong sources/.
// ============================================================

module.exports = {
  // ---------- Thông tin addon (xuất ra manifest.json) ----------
  ADDON_ID: 'community.phim-quoc-gia',
  ADDON_VERSION: '1.0.0',
  ADDON_NAME: 'Phim Theo Quốc Gia',
  ADDON_DESCRIPTION:
    'Phim lẻ & bộ Việt, Hàn, Trung, Âu Mỹ, Thái + Anime, Hoạt hình, Tài liệu. Mô tả tiếng Việt. Cần cài addon nguồn (Torrentio/MediaFusion) để xem.',

  // ---------- TMDB (tuỳ chọn nhưng nên có) ----------
  // Đăng ký key miễn phí: https://www.themoviedb.org/settings/api
  // Cách 1: dán key vào dòng dưới. Cách 2: TMDB_API_KEY=xxx node fetch.js
  // KHÔNG có key → addon vẫn chạy với KKPhim + NguonC, các catalog thuộc
  // TMDB (Anime, Hoạt hình (Bộ), Tài liệu) sẽ trống và bị bỏ khỏi manifest.
  // CÓ key   → ngoài 6 catalog TMDB, còn resolve phim KKPhim thiếu IMDb ID
  //            qua tmdb_id (giúp catalog Trung Quốc đủ phim hơn).
  TMDB_API_KEY: process.env.TMDB_API_KEY || '08e5c851a86686d0e53554133c91c1f5',
  TMDB_BASE: 'https://api.themoviedb.org/3',
  TMDB_IMG: 'https://image.tmdb.org/t/p/w500',
  TMDB_LANGUAGE: 'vi-VN',           // ngôn ngữ mô tả
  TMDB_VI_POSTER: true,             // ưu tiên poster tiếng Việt (kèm trong request chi tiết)
  TMDB_EN_OVERVIEW_FALLBACK: true,  // mô tả vi rỗng → lấy mô tả tiếng Anh
  TMDB_MAX_PAGES: Number(process.env.TMDB_MAX_PAGES) || 4, // mỗi catalog TMDB lấy tối đa 4 trang (20 phim/trang)

  // ---------- Giới hạn & tốc độ ----------
  // (mọi giá trị đều có thể override bằng biến môi trường khi chạy,
  //  ví dụ: TARGET_PER_CATALOG=40 DELAY_MS=250 node fetch.js)
  TARGET_PER_CATALOG: Number(process.env.TARGET_PER_CATALOG) || 50, // mục tiêu 40–60 item/catalog
  MIN_PER_CATALOG: 10,      // dưới mốc này sẽ cảnh báo
  MAX_PAGES_PER_SOURCE: Number(process.env.MAX_PAGES_PER_SOURCE) || 5, // số trang tối đa mỗi nguồn/catalog
  DETAIL_CALL_CAP: Number(process.env.DETAIL_CALL_CAP) || 120, // giới hạn gọi API chi tiết (KKPhim) mỗi catalog
  DELAY_MS: Number(process.env.DELAY_MS) || 350, // delay giữa 2 request (rate limit)
  RETRIES: Number(process.env.RETRIES) || 3, // số lần retry khi lỗi (403/429/5xx/mạng)
  RETRY_BACKOFF_MS: Number(process.env.RETRY_BACKOFF_MS) || 800, // chờ giữa các retry thường
  RETRY_403_BASE_MS: Number(process.env.RETRY_403_BASE_MS) || 3000, // chờ dài hơn khi bị 403/429 (nghi bot)
  TIMEOUT_MS: 15000,
  // BỊ CHẶN 403? Chạy kèm proxy: HTTPS_PROXY=http://user:pass@host:port node fetch.js

  // ---------- NguonC (bộ bù mô tả/poster tiếng Việt) ----------
  // ĐÃ XÁC MINH (09/2025): NguonC KHÔNG trả imdb_id (0/10 phim thử) →
  // không thể làm nguồn chính theo quy tắc "phải có IMDb ID".
  // → Vai trò: bù mô tả tiếng Việt/poster cho phim đã có IMDb ID từ
  //   KKPhim, ghép theo tên gốc + năm phát hành (xem sources/nguonc.js).
  NGUONC_INDEX_PAGES: Number(process.env.NGUONC_INDEX_PAGES) || 12, // số trang list mỗi quốc gia (10 phim/trang)

  // ---------- Cinemeta (metadata dự phòng của Stremio) ----------
  CINEMETA_BASE: 'https://v3-cinemeta.strem.io/meta',
  CINEMETA_ENRICH: true,       // bù mô tả/poster/năm/imdbRating còn thiếu + xác thực ID sống
  CINEMETA_DROP_DEAD_ID: true, // IMDb ID mà Cinemeta trả 404 → coi là chết, loại phim

  // ---------- Lọc IMDb ----------
  IMDB_ID_RE: /^tt\d{7,10}$/,

  // ---------- URL nguồn (đổi ở đây nếu nguồn chuyển domain) ----------
  KKPHIM_BASE: 'https://phimapi.com',
  KKPHIM_IMG: 'https://phimimg.com', // CDN ảnh cho poster tương đối (đã test 200 OK)
  NGUONC_BASE: 'https://phim.nguonc.com',

  // ---------- 16 danh mục ----------
  // sources = mảng nguồn theo thứ tự ưu tiên; nguồn nào lỗi → tự bỏ qua,
  // catalog vẫn xuất từ nguồn còn lại.
  //  - kkphim: { source:'kkphim', category:'phim-le'|'phim-bo', country:'<slug>', genre?:'<slug>' }
  //  - nguonc: { source:'nguonc', country:'<slug>' }  → bộ bù metadata tiếng Việt
  //  - tmdb  : { source:'tmdb', kind:'movie'|'tv', with_genres:16|99, with_original_language:'ja'|'en' }
  CATALOGS: [
    { id: 'viet-movie', type: 'movie', name: '🇻🇳 Phim Lẻ Việt Nam', sources: [
      { source: 'kkphim', category: 'phim-le', country: 'viet-nam' },
      { source: 'nguonc', country: 'viet-nam' },
    ] },
    { id: 'viet-series', type: 'series', name: '🇻🇳 Phim Bộ Việt Nam', sources: [
      { source: 'kkphim', category: 'phim-bo', country: 'viet-nam' },
      { source: 'nguonc', country: 'viet-nam' },
    ] },
    { id: 'korea-movie', type: 'movie', name: '🇰🇷 Phim Lẻ Hàn Quốc', sources: [
      { source: 'kkphim', category: 'phim-le', country: 'han-quoc' },
      { source: 'nguonc', country: 'han-quoc' },
    ] },
    { id: 'korea-series', type: 'series', name: '🇰🇷 Phim Bộ Hàn Quốc', sources: [
      { source: 'kkphim', category: 'phim-bo', country: 'han-quoc' },
      { source: 'nguonc', country: 'han-quoc' },
    ] },
    { id: 'china-movie', type: 'movie', name: '🇨🇳 Phim Lẻ Trung Quốc', sources: [
      { source: 'kkphim', category: 'phim-le', country: 'trung-quoc' },
      { source: 'nguonc', country: 'trung-quoc' },
    ] },
    { id: 'china-series', type: 'series', name: '🇨🇳 Phim Bộ Trung Quốc', sources: [
      { source: 'kkphim', category: 'phim-bo', country: 'trung-quoc' },
      { source: 'nguonc', country: 'trung-quoc' },
    ] },
    { id: 'west-movie', type: 'movie', name: '🎬 Phim Lẻ Âu Mỹ', sources: [
      { source: 'kkphim', category: 'phim-le', country: 'au-my' },
    ] },
    { id: 'west-series', type: 'series', name: '📺 Phim Bộ Âu Mỹ', sources: [
      { source: 'kkphim', category: 'phim-bo', country: 'au-my' },
    ] },
    { id: 'thai-movie', type: 'movie', name: '🇹🇭 Phim Lẻ Thái Lan', sources: [
      { source: 'kkphim', category: 'phim-le', country: 'thai-lan' },
      { source: 'nguonc', country: 'thai-lan' },
    ] },
    { id: 'thai-series', type: 'series', name: '🇹🇭 Phim Bộ Thái Lan', sources: [
      { source: 'kkphim', category: 'phim-bo', country: 'thai-lan' },
      { source: 'nguonc', country: 'thai-lan' },
    ] },
    { id: 'anime-movie', type: 'movie', name: '⛩️ Anime (Lẻ)', sources: [
      { source: 'tmdb', kind: 'movie', with_genres: 16, with_original_language: 'ja' },
    ] },
    { id: 'anime-series', type: 'series', name: '⛩️ Anime (Bộ)', sources: [
      { source: 'tmdb', kind: 'tv', with_genres: 16, with_original_language: 'ja' },
    ] },
    { id: 'kids-movie', type: 'movie', name: '🧸 Hoạt Hình Trẻ Em (Lẻ)', sources: [
      { source: 'tmdb', kind: 'movie', with_genres: 16, with_original_language: 'en' },
      { source: 'kkphim', category: 'phim-le', genre: 'hoat-hinh' }, // không lọc quốc gia, chỉ lấy phim lẻ hoạt hình
    ] },
    { id: 'kids-series', type: 'series', name: '🧸 Hoạt Hình Trẻ Em (Bộ)', sources: [
      { source: 'tmdb', kind: 'tv', with_genres: 16, with_original_language: 'en' },
    ] },
    { id: 'docs-movie', type: 'movie', name: '📚 Phim Tài Liệu', sources: [
      { source: 'tmdb', kind: 'movie', with_genres: 99, with_original_language: 'en' },
    ] },
    { id: 'docs-series', type: 'series', name: '📚 Tài Liệu (Bộ)', sources: [
      { source: 'tmdb', kind: 'tv', with_genres: 99, with_original_language: 'en' },
    ] },
  ],
};
