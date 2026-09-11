# Phim Theo Quốc Gia — Static Addon Catalog cho Stremio / Nuvio

Addon **chỉ catalog (không stream)**, dạng **static** — chỉ gồm các file JSON tĩnh, host miễn phí trên **GitHub Pages**, không cần server. Cài bằng cách dán link manifest vào Stremio hoặc Nuvio.

- 16 danh mục phim theo quốc gia / thể loại, **poster + mô tả tiếng Việt**.
- Mỗi phim đều có **IMDb ID thật** (`ttXXXXXXX`) → metadata + stream từ addon nguồn khác (Torrentio, MediaFusion…) hoạt động ngay.
- Xây dựng từ dữ liệu mở của **KKPhim (phimapi.com)**, **NguonC (phim.nguonc.com)**, **TMDB** và **Cinemeta**.

---

## 1. Danh mục (16 catalogs)

| ID | Tên hiển thị | Nguồn chính |
|---|---|---|
| `viet-movie` | 🇻🇳 Phim Lẻ Việt Nam | KKPhim + NguonC |
| `viet-series` | 🇻🇳 Phim Bộ Việt Nam | KKPhim + NguonC |
| `korea-movie` | 🇰🇷 Phim Lẻ Hàn Quốc | KKPhim + NguonC |
| `korea-series` | 🇰🇷 Phim Bộ Hàn Quốc | KKPhim + NguonC |
| `china-movie` | 🇨🇳 Phim Lẻ Trung Quốc | KKPhim + NguonC |
| `china-series` | 🇨🇳 Phim Bộ Trung Quốc | KKPhim + NguonC |
| `west-movie` | 🎬 Phim Lẻ Âu Mỹ | KKPhim |
| `west-series` | 📺 Phim Bộ Âu Mỹ | KKPhim |
| `thai-movie` | 🇹🇭 Phim Lẻ Thái Lan | KKPhim + NguonC |
| `thai-series` | 🇹🇭 Phim Bộ Thái Lan | KKPhim + NguonC |
| `anime-movie` | ⛩️ Anime (Lẻ) | TMDB |
| `anime-series` | ⛩️ Anime (Bộ) | TMDB |
| `kids-movie` | 🧸 Hoạt Hình Trẻ Em (Lẻ) | TMDB + KKPhim (thể loại hoat-hinh) |
| `kids-series` | 🧸 Hoạt Hình Trẻ Em (Bộ) | TMDB |
| `docs-movie` | 📚 Phim Tài Liệu | TMDB |
| `docs-series` | 📚 Tài Liệu (Bộ) | TMDB |

Mỗi catalog giới hạn ~40–60 item để file JSON nhẹ. Catalog nào không có item sẽ **không được khai báo** trong manifest.

## 2. Cách hoạt động

```
KKPhim ─┐
NguonC ─┼─► fetch.js ─► gộp/dedupe theo IMDb ID ─► bù mô tả tiếng Việt ─► bù metadata + lọc ID chết
TMDB   ─┘   (rate limit 350ms, retry 2 lần)      (ưu tiên bản có mô tả vi)  (Cinemeta)      │
                                                                                                 ▼
                                                                          catalog/movie/{id}.json + catalog/series/{id}.json
                                                                                                 │
                                                                        build.js ─► manifest.json (chỉ khai báo catalog có item)
```

Quy tắc dữ liệu được áp dụng:

1. **Chỉ giữ phim có IMDb ID thật** (regex `tt\d{7,10}`) — không có ID thì bị loại, vì Stremio cần IMDb ID để ghép metadata và gọi stream từ addon khác.
2. **Dedupe theo IMDb ID**: trùng nhau thì giữ bản có mô tả + poster tốt hơn (ưu tiên mô tả tiếng Việt), các trường thiếu được bù chéo từ bản còn lại.
3. **Poster tiếng Việt ưu tiên**: TMDB hỏi poster ngôn ngữ `vi` trước (fallback `en` → poster gốc); KKPhim/NguonC mặc định là poster Việt.
4. **Mô tả tiếng Việt ưu tiên**: KKPhim (trang chi tiết) → NguonC (ghép theo tên gốc + năm) → TMDB `language=vi-VN` → fallback tiếng Anh → Cinemeta (tiếng Anh, chỉ khi thiếu).
5. **Xác thực IMDb ID**: Cinemeta trả 404 cho ID → coi là ID chết, loại phim (tuỳ chọn, xem `config.js`).
6. **Idempotent**: chạy lại `fetch.js` chỉ ghi đè file, không bao giờ tạo dữ liệu trùng.
7. **Nguồn chết không chặn pipeline**: nguồn nào lỗi sẽ log `[WARN]` và bị bỏ qua, catalog vẫn xuất từ nguồn còn lại.

> **Ghi chú đã kiểm chứng thực tế (09/2025):** NguonC hiện **không trả `imdb_id`** (đã thử 10 phim chi tiết) nên không thể làm nguồn chính — nó được dùng làm **bộ bù mô tả tiếng Việt** ghép theo tên gốc + năm. KKPhim list **không kèm mô tả** nên script gọi thêm trang chi tiết `/phim/{slug}`; đồng thời `imdb.vote_average` của KKPhim chính là điểm IMDb thật (đối chiếu Ký Sinh Trùng = 8.5 ✓). Với phim KKPhim thiếu `imdb.id` nhưng có `tmdb.id` (rất phổ biến với phim Trung Quốc), script dùng TMDB API để resolve ra IMDb ID.

## 3. Cài đặt & chạy

Yêu cầu: **Node.js ≥ 16** (khuyến nghị 18/20+).

```bash
npm install
```

**(Tuỳ chọn nhưng khuyến nghị)** thêm TMDB API key để có 6 catalog Anime / Hoạt hình (Bộ) / Tài liệu — đăng ký miễn phí tại [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api), rồi dán key vào `config.js`:

```js
TMDB_API_KEY: process.env.TMDB_API_KEY || 'DÁN_KEY_VÀO_ĐÂY',
```

hoặc dùng biến môi trường: `TMDB_API_KEY=xxx node fetch.js`. Không có key → script vẫn chạy với KKPhim + NguonC (Anime/Tài liệu/Hoạt hình Bộ sẽ trống và bị bỏ khỏi manifest, log sẽ cảnh báo).

```bash
node fetch.js   # 10–15 phút đầu tiên: tải nguồn, dedupe, enrich, ghi catalog/*.json
node build.js   # sinh manifest.json từ các catalog có dữ liệu
```

Các biến môi trường hữu ích (đều có trong `config.js`, không bắt buộc):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `TARGET_PER_CATALOG` | `50` | số item mục tiêu mỗi catalog (40–60) |
| `DELAY_MS` | `350` | delay giữa 2 request (rate limit) |
| `MAX_PAGES_PER_SOURCE` | `5` | số trang tối đa mỗi nguồn/catalog |
| `NGUONC_INDEX_PAGES` | `12` | số trang NguonC lấy mỗi quốc gia (bộ bù mô tả) |
| `SKIP_EXISTING` | `0` | `=1` → bỏ qua catalog đã có file (chạy tiếp khi bị gián đoạn) |

Kết quả chạy xong:

```
phim-addon/
├── manifest.json          # file dán vào Stremio/Nuvio
├── catalog/
│   ├── movie/viet-movie.json      # { "metas": [ { id: "tt…", type, name, poster, description, releaseInfo, imdbRating }, … ] }
│   ├── movie/korea-movie.json
│   ├── series/viet-series.json
│   └── … (16 file theo 16 catalog)
├── config.js              # cấu hình trung tâm: key TMDB, 16 catalog, URL nguồn, field-map
├── sources/               # kkphim.js, nguonc.js, tmdb.js, cinemeta.js (mỗi file có FIELD MAP riêng ở đầu)
├── fetch.js               # điều phối tổng
├── build.js               # sinh manifest + tự kiểm tra schema tối thiểu
└── .github/workflows/update.yml   # (tuỳ chọn) cập nhật catalog tự động hằng ngày
```

## 4. Deploy GitHub Pages

1. Tạo repository **public** trên GitHub (ví dụ tên `phim-addon`).
2. Push toàn bộ thư mục này lên repo (không cần đẩy `node_modules` — đã có `.gitignore`):

   ```bash
   git init
   git add .
   git commit -m "Phim Theo Quốc Gia addon"
   git branch -M main
   git remote add origin https://github.com/<user>/phim-addon.git
   git push -u origin main
   ```

3. Trên GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/(root)` → Save.**
4. Chờ 1–2 phút, manifest sẽ ở địa chỉ:

   ```
   https://<user>.github.io/phim-addon/manifest.json
   ```

> GitHub Pages tự gắn header CORS `access-control-allow-origin: *` nên Stremio/Nuvio đọc được manifest và catalog trực tiếp. Netlify/Vercel/Cloudflare Pages cũng dùng được y hệt.

## 5. Cài vào Stremio / Nuvio

**Stremio (desktop/mobile):** mở tab **Addons → Community addons**, dán URL manifest vào ô tìm kiếm → Enter → chọn addon → **Install**.

**Nuvio:** **Settings → Addons (hoặc Stremio Addons)** → dán URL manifest → Add.

**Quan trọng — addon này chỉ cung cấp danh sách:** để **xem được phim**, hãy cài thêm một addon nguồn stream như **Torrentio** (`https://torrentio.strem.fun/manifest.json`) hoặc **MediaFusion**, vì manifest này khai báo đúng `resources: ["catalog"]` và `idPrefixes: ["tt"]` nên catalog sẽ tự ghép stream từ các addon nguồn đó.

## 6. Cập nhật catalog tự động (tuỳ chọn)

File `.github/workflows/update.yml` có sẵn: mỗi ngày 02:00 UTC sẽ chạy lại `fetch.js` + `build.js` rồi commit catalog mới lên repo — GitHub Pages tự phục vụ bản mới. Bật bằng cách:

1. **Settings → Actions → General → Workflow permissions → Read and write permissions.**
2. (Nếu dùng TMDB) **Settings → Secrets and variables → Actions** → thêm secret `TMDB_API_KEY`.
3. Tab **Actions** → chọn workflow "Cap nhat catalog" → **Enable** (có thể bấm **Run workflow** để chạy thử ngay).

## 7. Tuỳ biến & xử lý sự cố

- **Thêm/bớt catalog**: sửa mảng `CATALOGS` trong `config.js` (đúng format khai báo), chạy lại `node fetch.js && node build.js`.
- **Nguồn đổi API / đổi tên trường**: mọi URL nguồn nằm trong `config.js` (`KKPHIM_BASE`, `NGUONC_BASE`, `TMDB_BASE`…); tên trường dữ liệu nằm trong khối `FIELD MAP (F)` đầu mỗi file trong `sources/` — chỉ cần sửa đúng chỗ đó.
- **Nguồn chết**: fetch.js chỉ log `[WARN] Nguồn … chết/lỗi — bỏ qua` và tiếp tục với nguồn còn lại; catalog trống hoàn toàn sẽ không xuất hiện trong manifest.
- **Phim thiếu IMDb ID bị loại là chủ ý** (quy tắc bắt buộc để stream hoạt động). Nếu muốn nới lỏng, sửa trong `sources/` phần `if (!imdbId) continue;`.
- **Chạy nhanh thử nghiệm**: `TARGET_PER_CATALOG=20 DELAY_MS=200 node fetch.js`.
- **File catalog hỏng giữa chừng**: không xảy ra (ghi file tạm rồi rename), nhưng nếu có thì xoá file đó và chạy lại `SKIP_EXISTING=1 node fetch.js`.

## 8. Định dạng dữ liệu đầu ra

`catalog/{movie|series}/{id}.json`:

```json
{
  "metas": [
    {
      "id": "tt6751668",
      "type": "movie",
      "name": "Ký Sinh Trùng",
      "poster": "https://image.tmdb.org/t/p/w500/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg",
      "description": "Mô tả tiếng Việt…",
      "releaseInfo": "2019",
      "imdbRating": "8.5"
    }
  ]
}
```

`manifest.json` được sinh tự động:

```json
{
  "id": "community.phim-quoc-gia",
  "version": "1.0.0",
  "name": "Phim Theo Quốc Gia",
  "description": "Phim lẻ & bộ Việt, Hàn, Trung, Âu Mỹ, Thái + Anime, Hoạt hình, Tài liệu. Mô tả tiếng Việt. Cần cài addon nguồn (Torrentio/MediaFusion) để xem.",
  "resources": ["catalog"],
  "types": ["movie", "series"],
  "idPrefixes": ["tt"],
  "catalogs": [
    { "type": "movie", "id": "viet-movie", "name": "🇻🇳 Phim Lẻ Việt Nam" }
  ],
  "behaviorHints": { "configurable": false }
}
```
