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

// ---- Headers giả lập trình duyệt thật (Chrome) ----
// QUAN TRỌNG: UA tự khai "phim-addon-catalog" kiểu bot sẽ bị WAF/Cloudflare
// chặn 403 ngay. Phải dùng UA + header của trình duyệt thật.
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  Connection: 'keep-alive',
};

// ---- Proxy tuỳ chọn qua biến môi trường (chạy khi IP bị chặn cứng) ----
//   HTTPS_PROXY=http://host:port  hoặc  http://user:pass@host:port node fetch.js
let _proxyWarned = false;
function proxyFromEnv() {
  const raw =
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const proxy = {
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
      protocol: u.protocol.replace(':', ''),
    };
    if (u.username) proxy.auth = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password || '') };
    return proxy;
  } catch (e) {
    if (!_proxyWarned) { _proxyWarned = true; console.warn(`[WARN] HTTPS_PROXY sai định dạng: ${raw}`); }
    return undefined;
  }
}

// ---- GET kèm retry + timeout; lỗi ném ra kèm .status ----
// 403/429 (bị nghi bot) sẽ được RETRY với thời gian chờ dài dần thay vì nổ ngay.
let _warned403 = false;
async function httpGet(url) {
  let referer;
  try { referer = new URL(url).origin + '/'; } catch (e) { /* URL lạ → bỏ referer */ }
  const headers = { ...BROWSER_HEADERS };
  if (referer) headers.Referer = referer; // giống trình duyệt thật hơn trong mắt WAF

  let lastErr;
  for (let attempt = 0; attempt <= C.RETRIES; attempt++) {
    try {
      const res = await throttle(() =>
        axios.get(url, { timeout: C.TIMEOUT_MS, validateStatus: () => true, headers, proxy: proxyFromEnv() })
      );
      if (res.status === 200) return res.data;
      const err = new Error(`HTTP ${res.status} — ${url}`);
      err.status = res.status;
      throw err;
    } catch (e) {
      lastErr = e;
      const st = e.status || (e.response && e.response.status);
      if (st === 403 || st === 429) {
        if (!_warned403) {
          _warned403 = true;
          console.warn('  [GỢI Ý 403] Nguồn đang nghi request là bot. Script đã tự dùng header trình duyệt + chờ rồi thử lại.');
          console.warn('             Nếu vẫn 403 nhiều lần: (1) đợi 15-30 phút rồi chạy lại (SKIP_EXISTING=1), (2) tăng DELAY_MS (vd DELAY_MS=800),');
          console.warn('             (3) đổi mạng/VPN, (4) đặt HTTPS_PROXY=http://host:port — chi tiết xem README mục "Lỗi HTTP 403".');
        }
        if (attempt < C.RETRIES) await sleep(C.RETRY_403_BASE_MS * (attempt + 1)); // 3s → 6s → 9s
        continue;
      }
      // lỗi 4xx khác là lỗi client → không đáng retry
      if (st && st >= 400 && st < 500) throw e;
      if (attempt < C.RETRIES) await sleep(C.RETRY_BACKOFF_MS * (attempt + 1));
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

// ---- Giải mã HTML entity (&amp; &quot; &#39; &#x1F600; …) khi scrape HTML ----
function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; } })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ---- Ghi JSON an toàn: ghi file tạm rồi đổi tên (chạy lại không hỏng file) ----
function writeJsonSafe(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

// httpGetText: tên gợi ý khi scrape HTML (bản chất cùng httpGet — trả chuỗi/JSON tuỳ Content-Type)
const httpGetText = httpGet;

// ---- GET qua curl (child_process) ----
// Vì sao: một số WAF (vd Cloudflare trước kkphim.com) chặn theo TLS fingerprint của
// Node.js — Node gửi headers trình duyệt thật vẫn bị 403 (đã test), còn curl thì qua.
// curl có sẵn trên Linux/macOS/GitHub Actions và Windows 10+ nên cách này chạy mọi nơi.
const { execFile } = require('child_process');

function curlOnce(url, referer) {
  return new Promise((resolve, reject) => {
    const args = ['-sS', '-L', '--max-time', String(Math.ceil(C.TIMEOUT_MS / 1000))];
    for (const [k, v] of Object.entries(BROWSER_HEADERS)) {
      if (k.toLowerCase() === 'connection') continue; // curl tự quản kết nối
      args.push('-H', `${k}: ${v}`);
    }
    if (referer) args.push('-H', `Referer: ${referer}`);
    args.push('-w', '\n__STATUS__:%{http_code}', url);
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      const m = typeof stdout === 'string' ? stdout.match(/\n__STATUS__:(\d{3})\s*$/) : null;
      if (!m) {
        const reason = err ? String(err.message).split('\n')[0] : 'không đọc được mã trạng thái';
        return reject(new Error(`curl thất bại: ${reason} (URL: ${url})`));
      }
      resolve({ status: Number(m[1]), body: stdout.slice(0, m.index) });
    });
  });
}

// curlProbe — kiểm tra URL PHÁT còn sống không (HTTP 200/206 = sống).
// Vì sao cần: KKPhim API vẫn trả link m3u8 của phim đã bị gỡ khỏi CDN của họ
// (probe thực tế: ~40% link chết sẵn ở nguồn) → probe trước khi ghi stream file,
// chỉ giữ link thật sự phát được. Chỉ gửi UA + Referer (đúng combo đã test 200;
// thêm Sec-Fetch/Accept ngược lại gây 404).
function curlProbe(url, referer, timeoutSec = 8) {
  return new Promise((resolve) => {
    const os = require('os');
    const tmp = path.join(os.tmpdir(), `phim-addon-probe-${process.pid}-${Date.now()}`);
    const args = ['-sS', '-o', tmp, '--max-time', String(timeoutSec), '-w', '%{http_code}'];
    args.push('-H', `User-Agent: ${BROWSER_HEADERS['User-Agent']}`);
    if (referer) args.push('-H', `Referer: ${referer}`);
    args.push(url);
    execFile('curl', args, { windowsHide: true, timeout: (timeoutSec + 2) * 1000 }, (err, stdout) => {
      try { fs.rmSync(tmp, { force: true }); } catch (e) { /* bỏ qua */ }
      const code = parseInt(String(stdout).trim(), 10);
      resolve(code === 200 || code === 206);
    });
  });
}

// curlGet — như httpGet nhưng đi qua curl; trả object (nếu body là JSON) hoặc chuỗi HTML
async function curlGet(url) {
  let referer;
  try { referer = new URL(url).origin + '/'; } catch (e) { /* bỏ qua */ }
  let lastErr;
  for (let attempt = 0; attempt <= C.RETRIES; attempt++) {
    try {
      const { status, body } = await throttle(() => curlOnce(url, referer));
      if (status === 200) {
        const t = body.trim();
        if (t.startsWith('{') || t.startsWith('[')) {
          try { return JSON.parse(t); } catch (e) { /* không phải JSON → trả HTML */ }
        }
        return body;
      }
      const err = new Error(`HTTP ${status} — ${url}`);
      err.status = status;
      throw err;
    } catch (e) {
      lastErr = e;
      const st = e.status;
      if (st === 403 || st === 429) {
        if (!_warned403) {
          _warned403 = true;
          console.warn('  [GỢI Ý 403] Nguồn đang nghi request là bot. Script đã tự dùng header trình duyệt + chờ rồi thử lại.');
          console.warn('             Nếu vẫn 403 nhiều lần: (1) đợi 15-30 phút rồi chạy lại (SKIP_EXISTING=1), (2) tăng DELAY_MS (vd DELAY_MS=800),');
          console.warn('             (3) đổi mạng/VPN, (4) đặt HTTPS_PROXY=http://host:port — chi tiết xem README mục "Lỗi HTTP 403".');
        }
        if (attempt < C.RETRIES) await sleep(C.RETRY_403_BASE_MS * (attempt + 1));
        continue;
      }
      if (st && st >= 400 && st < 500) throw e;
      if (attempt < C.RETRIES) await sleep(C.RETRY_BACKOFF_MS * (attempt + 1));
    }
  }
  throw lastErr;
}

module.exports = { sleep, httpGet, httpGetText, curlGet, curlProbe, stripHtml, decodeEntities, imdbFrom, normTitle, pickPoster, writeJsonSafe, BROWSER_HEADERS };
