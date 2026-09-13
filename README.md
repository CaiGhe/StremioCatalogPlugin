# Phim Theo Quốc Gia — Static Addon Catalog cho Stremio / Nuvio

Addon dạng **static** — chỉ gồm các file JSON tĩnh, host miễn phí trên **GitHub Pages**, không cần server. Cài bằng cách dán link manifest vào Stremio hoặc Nuvio.

- 16 danh mục phim theo quốc gia / thể loại, **poster + mô tả tiếng Việt**.
- Mỗi phim đều có **IMDb ID thật** (`ttXXXXXXX`) → metadata + stream từ addon nguồn khác (Torrentio, MediaFusion…) hoạt động ngay.
- **Phim lẻ phát được luôn**: link m3u8 Vietsub từ KKPhim được lấy kèm lúc fetch, probe lọc link chết, ghi thành file `stream/movie/{imdb}.json` — bấm vào phim là play, không cần addon nguồn (phim bộ vẫn cần addon nguồn khác).
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
TMDB   ─┘   (header trình duyệt, rate limit 350ms,
             retry 3 lần — 403/429 chờ dài hơn)      (ưu tiên bản có mô tả vi)  (Cinemeta)      │
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
8. **Tự fallback sang SCRAPE web**: API KKPhim bị chặn (403/429/lỗi mạng, kể cả lỗi nửa chừng) → tự động chuyển sang scrape web **kkphim.com** (domain khác với API, thường không bị chặn cùng lúc). Trang danh sách `kkphim.com/danh-sach/…` nhúng sẵn **IMDb ID + TMDB ID + loại phim** ngay trong bảng, nên scrape chỉ cần 3–4 trang list + vài chục trang chi tiết lấy mô tả tiếng Việt. Request đi qua **curl** (child_process) vì Cloudflare chặn TLS fingerprint của Node.js — curl có sẵn trên Linux/macOS/Windows 10+/GitHub Actions.
9. **Link phát lấy kèm + lọc link chết**: khi gọi trang chi tiết KKPhim (bước lấy mô tả), link m3u8/mp4 nằm sẵn trong `episodes[].server_data[]` → thu thập KÈM, không tốn thêm request. Trước khi ghi file, **mỗi link được probe 1 lần** (curl + UA trình duyệt + Referer) — KKPhim vẫn trả link của phim đã bị gỡ khỏi CDN của họ (~40% chết sẵn ở nguồn, đã đo thực tế), link chết bị loại, người dùng không bấm trúng link lỗi.

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
node fetch.js     # 10–15 phút đầu tiên: tải nguồn, dedupe, enrich, ghi catalog/*.json
node build.js     # sinh manifest.json từ các catalog có dữ liệu
node validate.js  # (nên chạy) soát lại output theo checklist, exit code 0 = PASS
```

`node validate.js` tự kiểm tra: mọi file JSON parse được, IMDb ID đúng dạng `tt…` và không trùng, mỗi catalog ≥10 item, poster là URL http(s), manifest khớp config + schema Stremio, và spot-check ngẫu nhiên 4 IMDb ID qua Cinemeta.

Các biến môi trường hữu ích (đều có trong `config.js`, không bắt buộc):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `TARGET_PER_CATALOG` | `50` | số item mục tiêu mỗi catalog (40–60) |
| `DELAY_MS` | `350` | delay giữa 2 request (rate limit) |
| `MAX_PAGES_PER_SOURCE` | `5` | số trang tối đa mỗi nguồn/catalog |
| `NGUONC_INDEX_PAGES` | `12` | số trang NguonC lấy mỗi quốc gia (bộ bù mô tả) |
| `SKIP_EXISTING` | `0` | `=1` → bỏ qua catalog đã có file (chạy tiếp khi bị gián đoạn) |
| `RETRIES` | `3` | số lần retry mỗi request khi lỗi mạng/403/429/5xx |
| `RETRY_403_BASE_MS` | `3000` | thời gian chờ cơ bản giữa các retry khi bị 403/429 (tăng dần 3s→6s→9s) |
| `STREAMS` | `1` | `=0` → tắt sinh file stream (chỉ còn catalog) |
| `STREAM_VERIFY` | `1` | `=0` → không probe link, ghi cả link chết (nhanh hơn ~vài phút) |
| `STREAM_MAX_PER_TITLE` | `4` | số link phát tối đa ghi cho mỗi phim |
| `HTTPS_PROXY` | — | đi qua proxy khi IP bị chặn cứng, vd `http://user:pass@host:port` |

> Bị **HTTP 403** khi chạy `fetch.js`? → xem ngay mục 4 bên dưới.

## 4. Lỗi HTTP 403 khi chạy fetch.js — nguyên nhân & cách xử lý

**Triệu chứng:** log xuất hiện `HTTP 403 — https://phimapi.com/...` (hoặc nguồn khác), catalog bị bỏ qua hoặc fetch chết hẳn.

**Nguyên nhân:** các API nguồn (đặc biệt KKPhim/phimapi.com) đặt WAF/Cloudflare chấm điểm request. Bị chặn khi:
- request **không giống trình duyệt** (User-Agent lạ — các bản script cũ gửi UA dạng bot nên bị chặn gần như chắc chắn);
- request **quá dày** so với người dùng bình thường;
- **IP bị flag sẵn**: IP nhà mạng dùng chung nhiều, IP VPN/datacenter, hoặc IP của bạn vừa bị trảm hạn tạm thời do chạy fetch trước đó.

**Đã xử lý sẵn trong code (bản này):**
1. Script gửi **đầy đủ header trình duyệt thật** (Chrome UA, Accept-Language, Sec-Fetch…, Referer trùng domain nguồn) — đây là nguyên nhân chính khiến các bản cũ bị 403.
2. **403/429 được retry tối đa 3 lần** với thời gian chờ dài dần (3s → 6s → 9s) thay vì chết ngay.
3. Một nguồn chặn cứng cũng chỉ khiến catalog đó bỏ nguồn này, **không làm chết toàn bộ fetch**.
4. **Chế độ scrape dự phòng qua kkphim.com**: API phimapi.com chặn → tự scrape web KKPhim (qua curl, tránh được chặn TLS của Node). Nguonc (phim.nguonc.com) là web cùng domain với API nên nếu domain này chặn thì nguồn NguonC bị bỏ — không ảnh hưởng catalogue vì NguonC chỉ là bộ bù mô tả.

**Nếu vẫn 403, xử lý theo thứ tự:**

```bash
# 1. Đợi 15–30 phút (hạn chặn theo IP thường tự mở), rồi chạy TIẾP chỗ dở:
SKIP_EXISTING=1 node fetch.js

# 2. Chậm hơn nữa để "giống người dùng":
DELAY_MS=800 SKIP_EXISTING=1 node fetch.js

# 3. Đổi đường mạng: tắt VPN (nếu đang bật), chuyển sang 4G, hoặc ngược lại bật VPN

# 4. Đi qua proxy (axios hỗ trợ http/https proxy):
HTTPS_PROXY=http://user:pass@host:port node fetch.js
```

Lưu ý:
- 403 thường chỉ là **tạm thời** — chờ rồi chạy lại với `SKIP_EXISTING=1` là cách ít tốn công nhất.
- Nếu một domain bị chặn vĩnh viễn, đổi `KKPHIM_BASE` / `NGUONC_BASE` trong `config.js` sang domain API mới của nguồn đó.
- Khi fetch chết giữa chừng do 403, chạy lại với `SKIP_EXISTING=1` sẽ bỏ qua các catalog đã xong, chỉ fetch phần còn thiếu.
- **Chế độ scrape kkphim.com cần có `curl`** trong máy (mặc định có sẵn trên Linux/macOS/Windows 10+ và GitHub Actions — không cần cài thêm).
- Web kkphim.com không có trang /danh-sach/tai-lieu → catalog **Tài liệu** vẫn cần TMDB key hoặc API khi hết bị chặn.

Kết quả chạy xong:

```
phim-addon/
├── manifest.json          # file dán vào Stremio/Nuvio
├── catalog/
│   ├── movie/viet-movie.json      # { "metas": [ { id: "tt…", type, name, poster, description, releaseInfo, imdbRating }, … ] }
│   ├── movie/korea-movie.json
│   ├── series/viet-series.json
│   └── … (16 file theo 16 catalog)
├── stream/
│   └── movie/tt6751668.json       # { "streams": [ { title, url, behaviorHints } … ] } — link phát phim lẻ
├── config.js              # cấu hình trung tâm: key TMDB, 16 catalog, URL nguồn, field-map
├── sources/               # kkphim.js, kkphimweb.js (scraper dự phòng), nguonc.js, tmdb.js, cinemeta.js
├── fetch.js               # điều phối tổng
├── build.js               # sinh manifest + tự kiểm tra schema tối thiểu
├── validate.js            # kiểm tra đầu ra theo checklist (node validate.js)
└── .github/workflows/update.yml   # (tuỳ chọn) cập nhật catalog tự động hằng ngày
```

## 5. Deploy GitHub Pages

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

3. Trên GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/(root)` → Save.** (File `.nojekyll` sẵn có giúp GitHub phục vụ nguyên trạng các file JSON, không qua Jekyll.)
4. Chờ 1–2 phút, manifest sẽ ở địa chỉ:

   ```
   https://<user>.github.io/phim-addon/manifest.json
   ```

> GitHub Pages tự gắn header CORS `access-control-allow-origin: *` nên Stremio/Nuvio đọc được manifest và catalog trực tiếp. Netlify/Vercel/Cloudflare Pages cũng dùng được y hệt.

## 6. Cài vào Stremio / Nuvio

**Stremio (desktop/mobile):** mở tab **Addons → Community addons**, dán URL manifest vào ô tìm kiếm → Enter → chọn addon → **Install**.

**Nuvio:** **Settings → Addons (hoặc Stremio Addons)** → dán URL manifest → Add.

**Xem phim:**
- **Phim lẻ** (8 catalog movie): bấm vào phim → chọn server **KKPhim** (Vietsub/thuyết minh) → phát thẳng. Link được probe lúc fetch nên những gì hiển thị đều phát được tại thời điểm cập nhật; link hỏng sau đó (hiếm) → dùng addon nguồn khác.
- **Phim bộ** (8 catalog series): addon này không có link từng tập (xem mục 7) → cần cài thêm addon nguồn như **Torrentio** (`https://torrentio.strem.fun/manifest.json`) hoặc **MediaFusion** — manifest khai báo `idPrefixes: ["tt"]` nên catalog tự ghép stream từ addon đó.

## 7. Nguồn phát (stream) — chi tiết & giới hạn

Cơ chế: `fetch.js` thu link m3u8/mp4 từ `episodes[].server_data[]` của trang chi tiết KKPhim (lấy kèm lúc lấy mô tả — 0 request thêm) → probe từng link → ghi `stream/movie/{imdbId}.json` theo đúng format `/stream/{type}/{id}.json` của Stremio. `build.js` thấy có file stream thì tự khai báo `resources: ["catalog", "stream"]`.

Mỗi stream kèm `behaviorHints.proxyHeaders.request` (Chrome UA + `Referer: https://kkphim.com/`) — **bắt buộc**, vì CDN của KKPhim trả 404 nếu request không giống trình duyệt (đã probe thực tế: thiếu header → 404, đủ header → 200). Stremio/Nuvio đọc header này và tự đính kèm khi phát.

Giới hạn đã biết (cố ý, để giữ addon static):
- **Chỉ phim lẻ có link phát.** Phim bộ bị bỏ — Stremio hỏi stream theo từng tập (`…/stream/series/tt…:1:1.json`), filename chứa dấu `:` không tạo được trên Windows/git local. Muốn có, cần server động (Cloudflare Worker free tier là lựa chọn phù hợp nhất).
- **Chỉ các catalog nguồn KKPhim** (Việt/Hàn/Trung/Âu Mỹ/Thái + một phần Hoạt hình) có link; catalog thuần TMDB (Anime/Tài liệu) không có — bấm vào sẽ rơi xuống addon nguồn khác (nếu cài).
- **Link có thể hỏng theo thời gian** (CDN gỡ phim) → workflow cập nhật hằng ngày (mục 8) probe lại toàn bộ và loại link chết. Tần suất hỏng thực tế: link sống thường tồn tại nhiều tuần; link chết chủ yếu là chết sẵn ở nguồn (đã lọc).
- Mỗi phim tối đa `STREAM_MAX_PER_TITLE` (mặc định 4) link — nhiều server VK/Vidcloud khác nhau của cùng phim.

## 8. Cập nhật catalog tự động (tuỳ chọn)

File `.github/workflows/update.yml` có sẵn: mỗi ngày 02:00 UTC sẽ chạy lại `fetch.js` + `build.js` rồi commit catalog mới lên repo — GitHub Pages tự phục vụ bản mới. Bật bằng cách:

1. **Settings → Actions → General → Workflow permissions → Read and write permissions.**
2. (Nếu dùng TMDB) **Settings → Secrets and variables → Actions** → thêm secret `TMDB_API_KEY`.
3. Tab **Actions** → chọn workflow "Cap nhat catalog" → **Enable** (có thể bấm **Run workflow** để chạy thử ngay).

## 9. Tuỳ biến & xử lý sự cố

- **Thêm/bớt catalog**: sửa mảng `CATALOGS` trong `config.js` (đúng format khai báo), chạy lại `node fetch.js && node build.js`.
- **Nguồn đổi API / đổi tên trường**: mọi URL nguồn nằm trong `config.js` (`KKPHIM_BASE`, `NGUONC_BASE`, `TMDB_BASE`…); tên trường dữ liệu nằm trong khối `FIELD MAP (F)` đầu mỗi file trong `sources/` — chỉ cần sửa đúng chỗ đó.
- **Nguồn chết**: fetch.js chỉ log `[WARN] Nguồn … chết/lỗi — bỏ qua` và tiếp tục với nguồn còn lại; catalog trống hoàn toàn sẽ không xuất hiện trong manifest.
- **Phim thiếu IMDb ID bị loại là chủ ý** (quy tắc bắt buộc để stream hoạt động). Nếu muốn nới lỏng, sửa trong `sources/` phần `if (!imdbId) continue;`.
- **Chạy nhanh thử nghiệm**: `TARGET_PER_CATALOG=20 DELAY_MS=200 node fetch.js`.
- **File catalog hỏng giữa chừng**: không xảy ra (ghi file tạm rồi rename), nhưng nếu có thì xoá file đó và chạy lại `SKIP_EXISTING=1 node fetch.js`.

## 10. Định dạng dữ liệu đầu ra

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

`manifest.json` được sinh tự động (mỗi lần `node build.js` version tự +1 để Stremio/Nuvio nhận bản dữ liệu mới):

```json
{
  "id": "community.phim-quoc-gia",
  "version": "1.0.0",
  "name": "Phim Theo Quốc Gia",
  "description": "Phim lẻ & bộ Việt, Hàn, Trung, Âu Mỹ, Thái + Anime, Hoạt hình, Tài liệu. Mô tả tiếng Việt. Phim lẻ phát thẳng link Vietsub KKPhim; phim bộ cần addon nguồn khác (Torrentio/MediaFusion).",
  "resources": ["catalog", "stream"],
  "types": ["movie", "series"],
  "idPrefixes": ["tt"],
  "catalogs": [
    { "type": "movie", "id": "viet-movie", "name": "🇻🇳 Phim Lẻ Việt Nam" }
  ],
  "behaviorHints": { "configurable": false }
}
```

`stream/movie/{imdbId}.json` (chỉ sinh cho phim lẻ có link sống sau probe):

```json
{
  "streams": [
    {
      "title": "Vietsub #1\n1080p Vietsub\nKKPhim",
      "url": "https://…/index.m3u8",
      "behaviorHints": {
        "notWebReady": true,
        "proxyHeaders": { "request": { "User-Agent": "…Chrome…", "Referer": "https://kkphim.com/" } }
      }
    }
  ]
}
```
