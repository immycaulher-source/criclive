// Zero-dependency server (needs Node 18+). Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path');

// --- load .env (no dotenv needed) ---
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  });
} catch {}

const KEY = (process.env.RAPIDAPI_KEY || '').trim();
const HOST = (process.env.RAPIDAPI_HOST || 'cricket-live-line1.p.rapidapi.com').trim();
const PORT = +process.env.PORT || 3000;
const FILTER = (process.env.SERIES_FILTER || '').toLowerCase();
const T = { live: +process.env.LIVE_MS || 15000, list: +process.env.LIST_MS || 600000, news: +process.env.NEWS_MS || 900000 };
const API_ON = String(process.env.USE_CRICBUZZ || '').trim().toLowerCase() === 'true';
console.log(API_ON ? 'Cricbuzz API: ON' : 'Cricbuzz API: OFF (set USE_CRICBUZZ=true in .env to enable)');
if (API_ON && !KEY) console.warn('WARNING: RAPIDAPI_KEY missing in .env');

// --- Cricbuzz fetch with cache, in-flight de-duplication, stale-on-error ---
const cache = new Map(), inflight = new Map();
function cb(p, ttl) {
  if (!API_ON) return Promise.resolve({}); // API disabled: no outgoing Cricbuzz calls
  const c = cache.get(p);
  if (c && Date.now() - c.t < ttl) return Promise.resolve(c.d);
  if (inflight.has(p)) return inflight.get(p);
  const f = fetch('https://' + HOST + p, { headers: { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST } })
    .then(async r => {
      if (!r.ok) throw new Error('API ' + r.status);
      const d = await r.json();
      cache.set(p, { t: Date.now(), d });
      return d;
    })
    .catch(e => { if (c) return c.d; throw e; })
    .finally(() => inflight.delete(p));
  inflight.set(p, f);
  return f;
}

// --- shape the API data into something simple for the page ---
const score = s => s ? Object.keys(s).filter(k => /^inngs/.test(k)).sort().map(k => {
  const i = s[k];
  return i.runs + (i.wickets != null && i.wickets < 10 ? '/' + i.wickets : '') + (i.overs ? ' (' + i.overs + ')' : '');
}).join(' & ') : '';

function matches(d) {
  const out = [];
  (d.typeMatches || []).forEach(t => (t.seriesMatches || []).forEach(s => {
    const w = s.seriesAdWrapper; if (!w) return;
    (w.matches || []).forEach(m => {
      const i = m.matchInfo, ms = m.matchScore || {};
      if (FILTER && !String(i.seriesName || '').toLowerCase().includes(FILTER)) return;
      out.push({
        id: i.matchId, seriesId: i.seriesId, series: i.seriesName, desc: i.matchDesc, format: i.matchFormat,
        status: i.status, state: i.state, start: +i.startDate,
        venue: [i.venueInfo && i.venueInfo.ground, i.venueInfo && i.venueInfo.city].filter(Boolean).join(', '),
        t1: { name: i.team1.teamName, short: i.team1.teamSName, score: score(ms.team1Score) },
        t2: { name: i.team2.teamName, short: i.team2.teamSName, score: score(ms.team2Score) }
      });
    });
  }));
  return out;
}

const getLive = async () => matches(await cb('/matches/v1/live', T.live));
const getUpcoming = async () => matches(await cb('/matches/v1/upcoming', T.list));
const getRecent = async () => matches(await cb('/matches/v1/recent', T.list));
const getNews = async () => ((await cb('/news/v1/index', T.news)).storyList || [])
  .filter(x => x.story).map(x => ({ id: x.story.id, title: x.story.hline, intro: x.story.intro, image: x.story.imageId, time: x.story.pubTime }));

// --- RSS articles (no API key needed) ---
const FEEDS = [
  { name: 'Sky Sports', url: 'https://www.skysports.com/rss/12040', cricketOnly: true },
  { name: 'Hamro Khelkud', url: 'https://rss.app/feeds/GYvOU6J43NSwUMzV.xml', cricketOnly: false },
  { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news', cricketOnly: true }
];
const RSS_MS = +process.env.RSS_MS || 600000;
const unCdata = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const tag = (x, n) => { const m = x.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>', 'i')); return m ? decode(unCdata(m[1]).trim()) : ''; };
const attr = (x, n, a) => { const m = x.match(new RegExp('<' + n + '\\b[^>]*?' + a + '=["\']([^"\']+)["\']', 'i')); return m ? decode(m[1]) : ''; };
function parseRss(xml, src) {
  const base = Date.parse(tag(xml, 'lastBuildDate')) || Date.now();
  return (xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []).map((it, i) => {
    const desc = tag(it, 'description');
    const img = attr(it, 'media:thumbnail', 'url') || attr(it, 'media:content', 'url') || attr(it, 'enclosure', 'url') || (desc.match(/<img[^>]+src=["']([^"']+)/i) || [])[1] || '';
    return {
      source: src.name, title: tag(it, 'title'), link: tag(it, 'link'),
      intro: desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 140),
      image: /^https?:/.test(img) ? img : '', time: Date.parse(tag(it, 'pubDate')) || (base - i * 3600000)
    };
  }).filter(a => a.title && a.link && (!src.cricketOnly || /cricket|\bt20i?\b|\bodi\b|wicket|batter|batsman|bowler|innings|test match|\bipl\b|\bnpl\b|\bbbl\b|\bpsl\b|the hundred|ashes|county championship/i.test(a.title + ' ' + a.intro + ' ' + a.link)));
}
let rssCache = { t: 0, d: [] };
async function getRss() {
  if (Date.now() - rssCache.t < RSS_MS) return rssCache.d;
  const rs = await Promise.allSettled(FEEDS.map(async f => {
    const r = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 CRIC-live-score' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(f.name + ' ' + r.status);
    return parseRss(await r.text(), f);
  }));
  rs.forEach(r => r.status === 'rejected' && console.error('RSS:', r.reason.message));
  const d = [].concat.apply([], rs.filter(r => r.status === 'fulfilled').map(r => r.value)).sort((a, b) => b.time - a.time).slice(0, 30);
  if (d.length) rssCache = { t: Date.now(), d };
  return rssCache.d;
}

// --- live push (Server-Sent Events). Only polls Cricbuzz while someone is watching. ---
const clients = new Set(); let last = '';
const send = (res, ev, data) => res.write('event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n');
setInterval(async () => {
  if (!clients.size) return;
  try {
    const data = await getLive(), s = JSON.stringify(data);
    if (s !== last) { last = s; clients.forEach(c => send(c, 'live', data)); }
  } catch (e) { console.error(e.message); }
}, T.live);
setInterval(() => clients.forEach(c => c.write(': ping\n\n')), 25000);

// --- http ---
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' };
const imgs = new Map();
const json = (res, code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };

// --- SEO helpers: gzip, robots.txt, sitemap.xml, absolute site URL injected into index.html ---
const zlib = require('zlib');
// Folder layout: pages/ = HTML pages, public/images/ = images, public/ads.txt = AdSense file
const PAGES = path.join(__dirname, 'pages'), IMAGES = path.join(__dirname, 'public', 'images');
const adsTxt = () => { try { return fs.readFileSync(path.join(__dirname, 'public', 'ads.txt'), 'utf8'); } catch { return 'google.com, pub-4118893256323280, DIRECT, f08c47fec0942fa0\n'; } };
const siteUrl = () => (process.env.SITE_URL || ('http://localhost:' + PORT)).trim().replace(/\/+$/, '');
function sendText(req, res, type, body, cache) {
  const h = { 'Content-Type': type, 'Cache-Control': cache || 'no-cache', Vary: 'Accept-Encoding' };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { h['Content-Encoding'] = 'gzip'; res.writeHead(200, h); return res.end(zlib.gzipSync(body)); }
  res.writeHead(200, h); res.end(body);
}

http.createServer(async (req, res) => {
  const u = req.url.split('?')[0]; let m;
  try {
    if (u === '/points-table' || u === '/points-table.html') {
      let h; try { h = fs.readFileSync(path.join(PAGES, 'points-table.html'), 'utf8'); } catch { return json(res, 404, { error: 'page not found' }); }
      return sendText(req, res, 'text/html; charset=utf-8', h.replace(/\{\{SITE_URL\}\}/g, siteUrl()), 'no-cache');
    }
    if (u === '/fixtures' || u === '/fixtures.html') {
      let h; try { h = fs.readFileSync(path.join(PAGES, 'fixtures.html'), 'utf8'); } catch { return json(res, 404, { error: 'page not found' }); }
      return sendText(req, res, 'text/html; charset=utf-8', h.replace(/\{\{SITE_URL\}\}/g, siteUrl()), 'no-cache');
    }
    if (u === '/tickets' || u === '/tickets.html') {
      let h; try { h = fs.readFileSync(path.join(PAGES, 'tickets.html'), 'utf8'); } catch { return json(res, 404, { error: 'page not found' }); }
      return sendText(req, res, 'text/html; charset=utf-8', h.replace(/\{\{SITE_URL\}\}/g, siteUrl()), 'no-cache');
    }
    if (u === '/live-streams' || u === '/live-streams.html') {
      let h; try { h = fs.readFileSync(path.join(PAGES, 'live-streams.html'), 'utf8'); } catch { return json(res, 404, { error: 'page not found' }); }
      return sendText(req, res, 'text/html; charset=utf-8', h.replace(/\{\{SITE_URL\}\}/g, siteUrl()), 'no-cache');
    }
    if (u === '/') {
      let h; try { h = fs.readFileSync(path.join(PAGES, 'index.html'), 'utf8'); } catch { return json(res, 404, { error: 'index.html not found' }); }
      return sendText(req, res, 'text/html; charset=utf-8', h.replace(/\{\{SITE_URL\}\}/g, siteUrl()), 'no-cache');
    }
    if (u === '/ads.txt') return sendText(req, res, 'text/plain; charset=utf-8', adsTxt(), 'public, max-age=86400');
    if (u === '/robots.txt') return sendText(req, res, 'text/plain; charset=utf-8', 'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ' + siteUrl() + '/sitemap.xml\n', 'public, max-age=86400');
    if (u === '/sitemap.xml') return sendText(req, res, 'application/xml; charset=utf-8', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + siteUrl() + '/</loc><lastmod>' + new Date().toISOString().slice(0, 10) + '</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url><url><loc>' + siteUrl() + '/live-streams</loc><lastmod>' + new Date().toISOString().slice(0, 10) + '</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url><url><loc>' + siteUrl() + '/tickets</loc><lastmod>' + new Date().toISOString().slice(0, 10) + '</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url><url><loc>' + siteUrl() + '/fixtures</loc><lastmod>' + new Date().toISOString().slice(0, 10) + '</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url><url><loc>' + siteUrl() + '/points-table</loc><lastmod>' + new Date().toISOString().slice(0, 10) + '</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url></urlset>\n', 'public, max-age=3600');
    if (u === '/api/live') return json(res, 200, await getLive());
    if (u === '/api/upcoming') return json(res, 200, await getUpcoming());
    if (u === '/api/recent') return json(res, 200, await getRecent());
    if (u === '/api/news') return json(res, 200, await getNews());
    if (u === '/api/rss') return json(res, 200, await getRss());
    if (u === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      clients.add(res); req.on('close', () => clients.delete(res));
      try { const d = await getLive(); last = JSON.stringify(d); send(res, 'live', d); } catch (e) { send(res, 'fail', { error: e.message }); }
      return;
    }
    if ((m = u.match(/^\/api\/scorecard\/(\d+)$/))) return json(res, 200, await cb('/mcenter/v1/' + m[1] + '/scard', T.live));
    if ((m = u.match(/^\/api\/commentary\/(\d+)$/))) return json(res, 200, await cb('/mcenter/v1/' + m[1] + '/comm', T.live));
    if ((m = u.match(/^\/api\/points\/(\d+)$/))) return json(res, 200, await cb('/stats/v1/series/' + m[1] + '/points-table', T.list));
    if ((m = u.match(/^\/api\/img\/(\d+)$/))) {
      if (!API_ON) return json(res, 404, { error: 'API disabled' });
      let b = imgs.get(m[1]);
      if (!b) {
        const r = await fetch('https://' + HOST + '/img/v1/i1/c' + m[1] + '/i.jpg?p=de&d=high', { headers: { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST } });
        if (!r.ok) return json(res, 404, { error: 'no image' });
        b = Buffer.from(await r.arrayBuffer()); imgs.set(m[1], b);
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }); return res.end(b);
    }
    // only image files inside public/images are served (so .env and source files are never exposed)
    if ((m = u.match(/^\/([\w.\- ]+)\.(jpg|jpeg|png|webp|svg|ico)$/i))) {
      const f = path.join(IMAGES, m[1] + '.' + m[2]);
      if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': MIME[m[2].toLowerCase()], 'Cache-Control': 'public, max-age=604800' }); return fs.createReadStream(f).pipe(res); }
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) { console.error(u, e.message); if (!res.headersSent) json(res, 502, { error: e.message }); }
}).listen(PORT, () => console.log('CRIC running at http://localhost:' + PORT));
