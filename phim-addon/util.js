// ============================================================
// util.js — hàm dùng chung: HTTP có rate-limit/retry, xử lý chữ, ghi file an toàn
// ============================================================
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const C = require('./config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Hàng đợi tuần toàn + delay giữa các request (lịch sự với API nguồn) ----
let chain = Promise.resolve();
function throttle(fn) {
  const run = chain.then(async () => {
    await sleep(C.DELAY_MS);
    return fn();
  });
  chain = run.then(() => undefined, () => undefined); // lỗi không được làm đứt hàng đợi
  return run;
}

// ---- GET kèm retry + timeout; lỗi ném ra kèm .status ----
async function httpGet(url) {
  let lastErr;
  for (let attempt = 0; attempt <= C.RETRIES; attempt++) {
    try {
      const res = await throttle(() =>
        axios.get(url, {
          timeout: C.TIMEOUT_MS,
          validateStatus: () => true, // tự xử lý mã lỗi
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; phim-addon-catalog/1.0)',
            Accept: 'application/json,text/plain,*/*',
          },
        })
      );
      if (res.status === 200) return res.data;
      const err = new Error(`HTTP ${res.status} — ${url}`);
      err.status = res.status;
      throw err;
    } catch (e) {
      lastErr = e;
      const st = e.status || (e.response && e.response.status);
      // lỗi 4xx (trừ 429) là lỗi client → không đáng retry
      if (st && st >= 400 && st < 500 && st !== 429) throw e;
      if (attempt < C.RETRIES) await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr;
}

// ---- Bỏ thẻ HTML + giải mã entity (mô tả KKPhim dạng HTML) ----
function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|’/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Trích IMDb ID dạng ttXXXXXXX từ chuỗi bất kỳ ----
function imdbFrom(v) {
  if (!v) return null;
  const m = String(v).match(/tt\d{7,10}/i);
  return m ? m[0] : null;
}

// ---- Chuẩn hoá tên phim để ghép nguồn (bỏ dấu, dấu câu, phần trong ngoặc) ----
function normTitle(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---- Chọn URL poster đầu tiên hợp lệ; đường tương đối → prefix CDN ----
function pickPoster(base, ...urls) {
  for (const u of urls) {
    if (!u) continue;
    const s = String(u).trim();
    if (!s) continue;
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('/')) return base + s;
    return base + '/' + s;
  }
  return '';
}

// ---- Ghi JSON an toàn: ghi file tạm rồi đổi tên (chạy lại không hỏng file) ----
function writeJsonSafe(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { sleep, httpGet, stripHtml, imdbFrom, normTitle, pickPoster, writeJsonSafe };
