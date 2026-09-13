// ============================================================
// validate.js — KIỂM TRA ĐẦU RA theo checklist (chạy: node validate.js)
//  1) Mọi file catalog JSON parse được, cấu trúc đúng
//  2) Mỗi catalog có ≥10 phim, IMDb ID đúng dạng ttXXXXXXX, không trùng
//  3) Poster là URL http(s), mô tả có tỉ lệ cao
//  4) Manifest khớp với file catalog thực tế + schema tối thiểu Stremio
//  5) Spot-check ngẫu nhiên 4 IMDb ID qua Cinemeta (ID còn sống)
//  6) File stream/movie/*.json (nếu có): JSON parse, URL phát hợp lệ
// Exit code 0 = PASS, 1 = FAIL (tiện cho CI).
// ============================================================
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;
let errors = 0, warnings = 0;
const err = (m) => { errors++; console.log('  [LỖI] ' + m); };
const warn = (m) => { warnings++; console.log('  [CẢNH BÁO] ' + m); };

function getJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('quá nhiều redirect'));
    https.get(url, { headers: { 'User-Agent': 'phim-addon-validate' }, timeout: 15000 }, (res) => {
      // Theo redirect (Cinemeta có thể trả 307)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(getJson(next, redirectCount + 1));
      }
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode === 200) { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }
        else { const e = new Error('HTTP ' + res.statusCode); e.status = res.statusCode; reject(e); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

(async () => {
  console.log('=== 1) Soát toàn bộ file catalog ===');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const counts = {};
  let total = 0, withDesc = 0, withRating = 0, withPoster = 0;

  for (const cat of manifest.catalogs) {
    const file = path.join(ROOT, 'catalog', cat.type, `${cat.id}.json`);
    if (!fs.existsSync(file)) { err(`Thiếu file: ${file}`); continue; }
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { err(`JSON hỏng (trailing comma/syntax): ${file} — ${e.message}`); continue; }
    const metas = data.metas;
    if (!Array.isArray(metas)) { err(`Thiếu mảng metas: ${file}`); continue; }
    counts[cat.id] = metas.length;
    total += metas.length;
    if (metas.length < 10) warn(`Catalog ${cat.id} chỉ có ${metas.length} item (<10)`);

    const seen = new Set();
    for (const m of metas) {
      if (!/^tt\d{7,10}$/.test(m.id)) err(`IMDb ID sai dạng: ${m.id} (${cat.id})`);
      if (seen.has(m.id)) err(`IMDb ID trùng trong catalog: ${m.id} (${cat.id})`);
      seen.add(m.id);
      if (m.type !== cat.type) err(`Sai type: ${m.id} — ${m.type} != ${cat.type}`);
      if (!m.name) err(`Thiếu name: ${m.id}`);
      if (m.poster && /^https?:\/\//.test(m.poster)) withPoster++; else warn(`Poster thiếu/không phải URL: ${m.id} (${cat.id})`);
      if (m.description && m.description.length > 20) withDesc++;
      if (m.imdbRating) withRating++;
    }
  }
  console.log(`  Tổng: ${total} items | poster=${withPoster} (${((withPoster / total) * 100).toFixed(1)}%) | mô tả=${withDesc} (${((withDesc / total) * 100).toFixed(1)}%) | imdbRating=${withRating} (${((withRating / total) * 100).toFixed(1)}%)`);

  console.log('\n=== 2) Số item từng catalog (yêu cầu ≥10) ===');
  for (const [id, n] of Object.entries(counts)) console.log(`  ${id.padEnd(14)} ${n} items ${n >= 10 ? '✔' : '✘ (<10!)'}`);

  console.log('\n=== 3) Manifest khớp config & schema Stremio ===');
  const cfg = require(path.join(ROOT, 'config.js'));
  console.log(`  Config khai báo: ${cfg.CATALOGS.length} | Manifest có: ${manifest.catalogs.length}`);
  if (cfg.CATALOGS.length !== manifest.catalogs.length) warn('Số catalog manifest != config (có catalog trống là bình thường)');
  if (manifest.resources.length !== 1 && manifest.resources.length !== 2) err('resources phải là ["catalog"] hoặc ["catalog", "stream"]');
  if (!manifest.resources.includes('catalog')) err('resources phải chứa "catalog"');
  if (manifest.resources.includes('stream')) {
    // Nếu khai báo stream thì phải có ít nhất 1 file stream/movie/*.json
    const sdir = path.join(ROOT, 'stream', 'movie');
    const n = fs.existsSync(sdir) ? fs.readdirSync(sdir).filter((f) => f.endsWith('.json')).length : 0;
    if (n === 0) err('Khai báo resource "stream" nhưng không có file stream/movie/*.json');
    else console.log(`  Resource stream: OK — ${n} file stream/movie/*.json`);
  }
  if (!Array.isArray(manifest.idPrefixes) || !manifest.idPrefixes.includes('tt')) err('idPrefixes phải chứa "tt"');
  if (!/^([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+$/.test(manifest.id)) err('id manifest không đúng định dạng domain-like');
  // Catalog trong manifest phải trỏ tới file có thật và ngược lại
  for (const c of manifest.catalogs) {
    const f = path.join(ROOT, 'catalog', c.type, `${c.id}.json`);
    if (!fs.existsSync(f)) err(`Manifest khai báo catalog không có file: ${c.id}`);
  }

  console.log('\n=== 4) Kiểm tra file stream/movie/*.json (link phát KKPhim) ===');
  const sdir = path.join(ROOT, 'stream', 'movie');
  if (!fs.existsSync(sdir) || !fs.readdirSync(sdir).some((f) => f.endsWith('.json'))) {
    console.log('  Không có file stream (chạy fetch.js để sinh, hoặc STREAMS=0 để tắt)');
  } else {
    let sErr = 0, sLinks = 0;
    const catalogIds = new Set();
    for (const cat of manifest.catalogs) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', cat.type, `${cat.id}.json`), 'utf8'));
        d.metas.forEach((m) => catalogIds.add(m.id));
      } catch (e) { /* đã báo ở bước 1 */ }
    }
    for (const f of fs.readdirSync(sdir)) {
      if (!f.endsWith('.json')) continue;
      const imdb = f.replace(/\.json$/, '');
      try {
        const d = JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8'));
        if (!Array.isArray(d.streams)) throw new Error('thiếu mảng streams');
        if (d.streams.length === 0) throw new Error('streams rỗng');
        for (const s of d.streams) {
          if (!/^https?:\/\//.test(s.url || '')) throw new Error(`URL lạ: ${s.url}`);
          if (!s.title) throw new Error('thiếu title');
          sLinks++;
        }
        if (!catalogIds.has(imdb)) warn(`File stream ${f} không thuộc catalog nào (sẽ không ai bấm tới — vô hại)`);
      } catch (e) { sErr++; err(`Stream file lỗi ${f}: ${e.message}`); }
    }
    console.log(`  ${fs.readdirSync(sdir).filter((f) => f.endsWith('.json')).length} file, ${sLinks} link phát, ${sErr} file lỗi`);
  }

  console.log('\n=== 5) Spot-check 4 IMDb ID ngẫu nhiên qua Cinemeta ===');
  const allMetas = [];
  for (const cat of manifest.catalogs) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', cat.type, `${cat.id}.json`), 'utf8'));
    data.metas.forEach((m) => allMetas.push(m));
  }
  const picks = [];
  while (picks.length < 4 && allMetas.length) picks.push(allMetas.splice(Math.floor(Math.random() * allMetas.length), 1)[0]);
  for (const m of picks) {
    try {
      const d = await getJson(`https://v3-cinemeta.strem.io/meta/${m.type}/${m.id}.json`);
      console.log(`  ✔ ${m.id} (${m.name}) → Cinemeta: "${(d.meta && d.meta.name) || '?'}" — IMDb ${d.meta && d.meta.imdbRating}`);
    } catch (e) {
      err(`${m.id} KHÔNG có trên Cinemeta (${e.message})`);
    }
  }

  console.log('\n================= KẾT QUẢ =================');
  console.log(errors === 0 ? `✔ PASS — 0 lỗi, ${warnings} cảnh báo. File catalog + manifest hợp lệ.` : `✘ FAIL — ${errors} lỗi, ${warnings} cảnh báo.`);
  process.exit(errors === 0 ? 0 : 1);
})();
