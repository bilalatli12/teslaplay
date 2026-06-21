/**
 * TeslaPlay Server v3
 * 
 * Multi-source YouTube proxy with fallback chain:
 *   1. yt-dlp (nightly) with optimized extractor args
 *   2. Invidious public API instances (auto-rotating)
 * 
 * Features:
 *   /api/search?q=query     — Search YouTube
 *   /api/info/:id           — Get video info + stream URLs
 *   /api/stream/:id         — Proxy video stream (multi-source)
 *   /api/thumbnail/:id      — Proxy thumbnail
 *   /api/trending           — Trending videos
 *   /api/debug              — Diagnostics
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { execFile, spawn, execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================
// yt-dlp binary management
// ============================
const BIN_DIR = path.join(__dirname, 'bin');
const isWindows = process.platform === 'win32';
const YTDLP_PATH = isWindows ? path.join(BIN_DIR, 'yt-dlp.exe') : path.join(BIN_DIR, 'yt-dlp');

// Use NIGHTLY builds for latest YouTube fixes
const YTDLP_URL = isWindows
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

const YTDLP_NIGHTLY_URL = isWindows
    ? 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp';

async function ensureYtDlp() {
    if (fs.existsSync(YTDLP_PATH)) {
        console.log('✅ yt-dlp binary found');
        if (!isWindows) {
            try { fs.chmodSync(YTDLP_PATH, '755'); } catch (e) {}
        }
        return;
    }

    console.log('📥 Downloading yt-dlp nightly binary...');
    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

    // Try nightly first, fallback to stable
    try {
        await downloadFile(YTDLP_NIGHTLY_URL, YTDLP_PATH);
        console.log('✅ yt-dlp nightly downloaded');
    } catch (err) {
        console.log('⚠️ Nightly failed, trying stable...');
        await downloadFile(YTDLP_URL, YTDLP_PATH);
        console.log('✅ yt-dlp stable downloaded');
    }

    if (!isWindows) {
        try { fs.chmodSync(YTDLP_PATH, '755'); } catch (e) {}
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        function download(url) {
            https.get(url, { headers: { 'User-Agent': 'TeslaPlay/3.0' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    download(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                    return;
                }
                const total = parseInt(res.headers['content-length'] || '0');
                let downloaded = 0;
                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (total > 0) {
                        const pct = Math.round(downloaded / total * 100);
                        process.stdout.write(`\r   Progress: ${pct}% (${(downloaded/1024/1024).toFixed(1)}MB)`);
                    }
                });
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log('');
                    resolve();
                });
            }).on('error', reject);
        }
        download(url);
    });
}

// Run yt-dlp command
function runYtDlp(args, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const proc = execFile(YTDLP_PATH, args, {
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
        }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr || err.message));
                return;
            }
            resolve(stdout);
        });
    });
}

// ============================
// Piped API Instance Pool
// ============================
let pipedInstances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.r4fo.com',
    'https://api.piped.projectsegfau.lt',
    'https://pipedapi.leptons.xyz',
    'https://pipedapi.in.projectsegfau.lt',
];

const pipedHealth = new Map();
let lastPipedRefresh = 0;

async function refreshPipedInstances() {
    if (Date.now() - lastPipedRefresh < 30 * 60 * 1000) return;
    lastPipedRefresh = Date.now();
    
    try {
        // Try to fetch instances from kavin.rocks
        const data = await fetchJSON('https://piped-instances.kavin.rocks/', 8000);
        if (Array.isArray(data)) {
            const apis = data
                .filter(inst => inst.api_url && !inst.cdn)
                .map(inst => inst.api_url.replace(/\/$/, ''))
                .slice(0, 10);
            if (apis.length > 0) {
                pipedInstances = apis;
                console.log(`🔄 Refreshed Piped instances: ${apis.length} found`);
            }
        }
    } catch (e) {
        console.log('⚠️ Could not refresh Piped instances:', e.message);
    }
}

function getHealthyPipedInstances() {
    return [...pipedInstances].sort((a, b) => {
        const ha = pipedHealth.get(a) || { success: 0, fail: 0 };
        const hb = pipedHealth.get(b) || { success: 0, fail: 0 };
        return (hb.success - hb.fail * 2) - (ha.success - ha.fail * 2);
    });
}

function markPiped(url, success) {
    const h = pipedHealth.get(url) || { success: 0, fail: 0 };
    if (success) h.success++;
    else h.fail++;
    if (h.fail > 10) { h.fail = Math.floor(h.fail / 2); h.success = Math.floor(h.success / 2); }
    pipedHealth.set(url, h);
}

// ============================
// Invidious Instance Pool
// ============================
let invidiousInstances = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://iv.datura.network',
    'https://invidious.protokolla.fi',
    'https://invidious.privacyredirect.com',
    'https://invidious.einfachzocken.eu',
    'https://iv.nbohr.de',
    'https://invidious.jing.rocks',
];

// Track which instances are working
const instanceHealth = new Map();
let lastInstanceRefresh = 0;

async function refreshInvidiousInstances() {
    // Refresh every 30 minutes
    if (Date.now() - lastInstanceRefresh < 30 * 60 * 1000) return;
    lastInstanceRefresh = Date.now();

    try {
        const data = await fetchJSON('https://api.invidious.io/instances.json', 8000);
        if (Array.isArray(data)) {
            const working = data
                .filter(([_, info]) => info && info.type === 'https' && info.api !== false)
                .filter(([_, info]) => info.monitor && info.monitor.down === false)
                .map(([_, info]) => info.uri)
                .slice(0, 15);

            if (working.length > 0) {
                invidiousInstances = working;
                console.log(`🔄 Refreshed Invidious instances: ${working.length} found`);
            }
        }
    } catch (e) {
        console.log('⚠️ Could not refresh Invidious instances:', e.message);
    }
}

function getHealthyInstances() {
    // Sort instances by health score
    return [...invidiousInstances].sort((a, b) => {
        const ha = instanceHealth.get(a) || { success: 0, fail: 0 };
        const hb = instanceHealth.get(b) || { success: 0, fail: 0 };
        const scoreA = ha.success - ha.fail * 2;
        const scoreB = hb.success - hb.fail * 2;
        return scoreB - scoreA;
    });
}

function markInstance(url, success) {
    const h = instanceHealth.get(url) || { success: 0, fail: 0 };
    if (success) h.success++;
    else h.fail++;
    // Decay old failures
    if (h.fail > 10) { h.fail = Math.floor(h.fail / 2); h.success = Math.floor(h.success / 2); }
    instanceHealth.set(url, h);
}

// ============================
// HTTP Fetch helpers
// ============================
function fetchJSON(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
        const mod = url.startsWith('https') ? https : http;

        mod.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: timeoutMs,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                clearTimeout(timer);
                fetchJSON(res.headers.location, timeoutMs).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                clearTimeout(timer);
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                clearTimeout(timer);
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON')); }
            });
        }).on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

function proxyStream(url, res, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Stream timeout')), timeoutMs);
        const mod = url.startsWith('https') ? https : http;

        mod.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
            },
            timeout: timeoutMs,
        }, (proxyRes) => {
            clearTimeout(timer);
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                proxyStream(proxyRes.headers.location, res, timeoutMs).then(resolve).catch(reject);
                return;
            }
            if (proxyRes.statusCode !== 200) {
                reject(new Error(`HTTP ${proxyRes.statusCode}`));
                return;
            }

            res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'video/mp4');
            if (proxyRes.headers['content-length']) {
                res.setHeader('Content-Length', proxyRes.headers['content-length']);
            }
            res.setHeader('Accept-Ranges', 'none');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Access-Control-Allow-Origin', '*');

            proxyRes.pipe(res);
            proxyRes.on('end', resolve);
            proxyRes.on('error', reject);
        }).on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

// ============================
// Cache (in-memory, simple)
// ============================
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 min

function cacheGet(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() - item.time > CACHE_TTL) { cache.delete(key); return null; }
    return item.data;
}

function cacheSet(key, data) {
    cache.set(key, { data, time: Date.now() });
    if (cache.size > 200) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
}

// ============================
// yt-dlp extractor args (optimized for 2025/2026)
// ============================
const YTDLP_BASE_ARGS = [
    '--no-warnings',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=default,-android_sdkless',
];

// Check if cookies file exists
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');
function getCookieArgs() {
    if (fs.existsSync(COOKIES_PATH)) {
        return ['--cookies', COOKIES_PATH];
    }
    return [];
}

// ============================
// API: Search
// ============================
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const cacheKey = `search:${query}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Try yt-dlp first
    try {
        const output = await runYtDlp([
            `ytsearch15:${query}`,
            '--dump-json',
            '--flat-playlist',
            '--skip-download',
            ...YTDLP_BASE_ARGS,
            ...getCookieArgs(),
        ], 25000);

        const results = parseYtDlpResults(output);
        if (results.length > 0) {
            const data = { results, source: 'yt-dlp' };
            cacheSet(cacheKey, data);
            return res.json(data);
        }
    } catch (err) {
        console.error('Search yt-dlp error:', err.message);
    }

    // Fallback: Invidious
    try {
        const results = await invidiousSearch(query);
        if (results.length > 0) {
            const data = { results, source: 'invidious' };
            cacheSet(cacheKey, data);
            return res.json(data);
        }
    } catch (err) {
        console.error('Search invidious error:', err.message);
    }

    res.status(500).json({ error: 'Search failed', results: [] });
});

// ============================
// API: Video Info
// ============================
app.get('/api/info/:id', async (req, res) => {
    const videoId = req.params.id;
    const cacheKey = `info:${videoId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Try yt-dlp first
    try {
        const output = await runYtDlp([
            `https://www.youtube.com/watch?v=${videoId}`,
            '--dump-json',
            '--skip-download',
            ...YTDLP_BASE_ARGS,
            ...getCookieArgs(),
        ], 25000);

        const info = JSON.parse(output);
        const data = formatVideoInfo(info);
        cacheSet(cacheKey, data);
        return res.json(data);
    } catch (err) {
        console.error('Info yt-dlp error:', err.message);
    }

    // Fallback: Invidious
    try {
        const data = await invidiousVideoInfo(videoId);
        if (data) {
            cacheSet(cacheKey, data);
            return res.json(data);
        }
    } catch (err) {
        console.error('Info invidious error:', err.message);
    }

    res.status(500).json({ error: 'Could not fetch video info' });
});

// ============================
// API: Stream Video (Multi-Source Fallback)
// ============================
app.get('/api/stream/:id', async (req, res) => {
    const videoId = req.params.id;
    const quality = req.query.q || 'medium';
    const startTime = req.query.t ? parseInt(req.query.t) : 0;

    console.log(`🎬 Stream request: ${videoId} (${quality}) t=${startTime}s`);

    // Abort handler
    let aborted = false;
    req.on('close', () => { aborted = true; });

    // ─── Strategy 1: yt-dlp direct stdout pipe ───
    if (!aborted) {
        try {
            const success = await streamViaYtDlp(videoId, quality, startTime, res, req);
            if (success) return;
        } catch (err) {
            console.log(`  yt-dlp stream failed: ${err.message}`);
        }
    }

    // ─── Strategy 2: Piped proxy stream ───
    if (!aborted && !res.headersSent) {
        try {
            const success = await streamViaPiped(videoId, quality, res);
            if (success) return;
        } catch (err) {
            console.log(`  Piped stream failed: ${err.message}`);
        }
    }

    // ─── Strategy 3: Invidious proxy stream ───
    if (!aborted && !res.headersSent) {
        try {
            const success = await streamViaInvidious(videoId, quality, res);
            if (success) return;
        } catch (err) {
            console.log(`  Invidious stream failed: ${err.message}`);
        }
    }

    // ─── Strategy 4: yt-dlp get URL → server proxies it ───
    if (!aborted && !res.headersSent) {
        try {
            const success = await streamViaYtDlpUrl(videoId, quality, res);
            if (success) return;
        } catch (err) {
            console.log(`  yt-dlp URL proxy failed: ${err.message}`);
        }
    }

    // All strategies failed
    if (!res.headersSent) {
        res.status(502).json({ error: 'Video stream unavailable. Tüm kaynaklar denendi.' });
    }
});

// Strategy 1: yt-dlp stdout pipe
function streamViaYtDlp(videoId, quality, startTime, res, req) {
    return new Promise((resolve, reject) => {
        let format;
        switch (quality) {
            case 'low':
                format = 'worst[ext=mp4]/worst';
                break;
            case 'high':
                format = 'best[height<=720][ext=mp4]/best[height<=720]/best[ext=mp4]/best';
                break;
            default:
                format = 'best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best';
        }

        const args = [
            `https://www.youtube.com/watch?v=${videoId}`,
            '-f', format,
            '-o', '-',
            ...YTDLP_BASE_ARGS,
            ...getCookieArgs(),
        ];

        if (startTime > 0) {
            args.push('--download-sections', `*${startTime}-`);
        }

        const proc = spawn(YTDLP_PATH, args, { windowsHide: true });
        let headerSent = false;
        let dataReceived = false;
        let stderrData = '';

        // Timeout: if no data in 12s, consider it failed
        const dataTimeout = setTimeout(() => {
            if (!dataReceived) {
                proc.kill('SIGTERM');
                reject(new Error('No data received within 12s'));
            }
        }, 12000);

        proc.stdout.on('data', (chunk) => {
            dataReceived = true;
            clearTimeout(dataTimeout);
            if (!headerSent) {
                headerSent = true;
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Accept-Ranges', 'none');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Access-Control-Allow-Origin', '*');
            }
            res.write(chunk);
        });

        proc.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        proc.on('error', (err) => {
            clearTimeout(dataTimeout);
            reject(err);
        });

        proc.on('close', (code) => {
            clearTimeout(dataTimeout);
            if (dataReceived) {
                res.end();
                resolve(true);
            } else {
                reject(new Error(`yt-dlp exit code ${code}: ${stderrData.substring(0, 300)}`));
            }
        });

        req.on('close', () => {
            clearTimeout(dataTimeout);
            proc.kill('SIGTERM');
        });
    });
}

// Strategy 2: Piped video proxy
async function streamViaPiped(videoId, quality, res) {
    await refreshPipedInstances();
    const instances = getHealthyPipedInstances();

    for (const instance of instances.slice(0, 4)) {
        try {
            console.log(`  Trying Piped: ${instance}`);
            const data = await fetchJSON(`${instance}/streams/${videoId}`, 12000);

            if (!data || (!data.videoStreams && !data.audioStreams)) {
                throw new Error('No streams in response');
            }

            // Find a suitable video+audio stream or video-only stream
            let streamUrl = null;

            if (data.videoStreams && data.videoStreams.length > 0) {
                // Filter for streams with audio (videoOnly === false)
                let candidates = data.videoStreams.filter(s => !s.videoOnly && s.url);
                
                // Sort by quality preference
                if (quality === 'low') {
                    candidates.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
                } else if (quality === 'high') {
                    candidates.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                } else {
                    // medium: prefer 360p-480p range
                    candidates.sort((a, b) => {
                        const aQ = parseInt(a.quality) || 0;
                        const bQ = parseInt(b.quality) || 0;
                        return Math.abs(aQ - 480) - Math.abs(bQ - 480);
                    });
                }

                if (candidates.length > 0) {
                    streamUrl = candidates[0].url;
                } else {
                    // No combined streams, try any video stream
                    const anyVideo = data.videoStreams.find(s => s.url);
                    if (anyVideo) streamUrl = anyVideo.url;
                }
            }

            if (!streamUrl) {
                throw new Error('No suitable stream found');
            }

            console.log(`  Piped stream URL found, proxying...`);
            await proxyStream(streamUrl, res, 30000);
            markPiped(instance, true);
            return true;
        } catch (err) {
            markPiped(instance, false);
            console.log(`  Piped ${instance} failed: ${err.message}`);
        }
    }
    return false;
}

// Strategy 3: Invidious video proxy
async function streamViaInvidious(videoId, quality, res) {
    await refreshInvidiousInstances();
    const instances = getHealthyInstances();

    let itag;
    switch (quality) {
        case 'low': itag = '18'; break; // 360p mp4
        case 'high': itag = '22'; break; // 720p mp4
        default: itag = '18'; break; // 360p mp4 (most reliable)
    }

    for (const instance of instances.slice(0, 5)) {
        try {
            // Invidious proxy URL format
            const streamUrl = `${instance}/latest_version?id=${videoId}&itag=${itag}&local=true`;
            console.log(`  Trying Invidious: ${instance}`);

            await proxyStream(streamUrl, res, 15000);
            markInstance(instance, true);
            return true;
        } catch (err) {
            markInstance(instance, false);
            console.log(`  Instance ${instance} failed: ${err.message}`);
        }
    }
    return false;
}

// Strategy 3: yt-dlp get URL, then server proxies it
async function streamViaYtDlpUrl(videoId, quality, res) {
    let format;
    switch (quality) {
        case 'low': format = 'worst[ext=mp4]/worst'; break;
        case 'high': format = 'best[height<=720][ext=mp4]/best[height<=720]/best[ext=mp4]/best'; break;
        default: format = 'best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best'; break;
    }

    try {
        const output = await runYtDlp([
            `https://www.youtube.com/watch?v=${videoId}`,
            '-f', format,
            '--get-url',
            ...YTDLP_BASE_ARGS,
            ...getCookieArgs(),
        ], 20000);

        const url = output.trim().split('\n')[0];
        if (!url || !url.startsWith('http')) {
            throw new Error('Invalid URL returned');
        }

        console.log(`  Proxying URL from yt-dlp`);
        await proxyStream(url, res, 30000);
        return true;
    } catch (err) {
        throw err;
    }
}

// ============================
// Invidious API helpers
// ============================
async function invidiousSearch(query) {
    await refreshInvidiousInstances();
    const instances = getHealthyInstances();

    for (const instance of instances.slice(0, 4)) {
        try {
            const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`;
            const data = await fetchJSON(url, 12000);

            if (Array.isArray(data) && data.length > 0) {
                markInstance(instance, true);
                return data
                    .filter(item => item.type === 'video' && item.videoId)
                    .slice(0, 15)
                    .map(item => ({
                        id: item.videoId,
                        title: item.title || 'Untitled',
                        channel: item.author || '',
                        views: formatViews(item.viewCount),
                        duration: formatDuration(item.lengthSeconds),
                        durationSeconds: item.lengthSeconds || 0,
                        thumbnail: `/api/thumbnail/${item.videoId}`,
                        description: (item.description || '').substring(0, 200),
                    }));
            }
        } catch (err) {
            markInstance(instance, false);
        }
    }
    return [];
}

async function invidiousVideoInfo(videoId) {
    await refreshInvidiousInstances();
    const instances = getHealthyInstances();

    for (const instance of instances.slice(0, 4)) {
        try {
            const url = `${instance}/api/v1/videos/${videoId}`;
            const info = await fetchJSON(url, 12000);

            if (info && info.videoId) {
                markInstance(instance, true);
                return {
                    id: info.videoId,
                    title: info.title || 'Untitled',
                    channel: info.author || '',
                    views: formatViews(info.viewCount),
                    likes: info.likeCount,
                    duration: formatDuration(info.lengthSeconds),
                    durationSeconds: info.lengthSeconds || 0,
                    description: (info.description || '').substring(0, 500),
                    uploadDate: info.publishedText || '',
                    thumbnail: `/api/thumbnail/${info.videoId}`,
                };
            }
        } catch (err) {
            markInstance(instance, false);
        }
    }
    return null;
}

// ============================
// API: Thumbnail Proxy
// ============================
app.get('/api/thumbnail/:id', (req, res) => {
    const videoId = req.params.id;
    const q = req.query.q || 'mqdefault';
    const url = `https://img.youtube.com/vi/${videoId}/${q}.jpg`;

    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (proxyRes) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            https.get(proxyRes.headers.location, (r) => {
                res.writeHead(r.statusCode, {
                    'Content-Type': r.headers['content-type'] || 'image/jpeg',
                    'Cache-Control': 'public, max-age=86400',
                });
                r.pipe(res);
            }).on('error', () => res.status(502).end());
            return;
        }
        res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'image/jpeg',
            'Cache-Control': 'public, max-age=86400',
        });
        proxyRes.pipe(res);
    }).on('error', () => res.status(502).end());
});

// ============================
// API: Trending (curated search)
// ============================
app.get('/api/trending', async (req, res) => {
    const type = req.query.type || 'trending';
    const searchQueries = {
        trending: 'türkiye trend 2025',
        music: 'en çok dinlenen şarkılar 2025 müzik',
        gaming: 'gaming highlights 2025 best moments',
        news: 'son dakika haberleri bugün',
        tesla: 'tesla model y review 2025',
        technology: 'best tech 2025 review',
        sports: 'futbol golleri 2025 highlights',
    };

    const query = searchQueries[type] || searchQueries.trending;
    const cacheKey = `trending:${type}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Try yt-dlp first
    try {
        const output = await runYtDlp([
            `ytsearch20:${query}`,
            '--dump-json',
            '--flat-playlist',
            '--skip-download',
            ...YTDLP_BASE_ARGS,
            ...getCookieArgs(),
        ], 25000);

        const results = parseYtDlpResults(output);
        if (results.length > 0) {
            const data = { results, source: 'yt-dlp' };
            cacheSet(cacheKey, data);
            return res.json(data);
        }
    } catch (err) {
        console.error('Trending yt-dlp error:', err.message);
    }

    // Fallback: Invidious search
    try {
        const results = await invidiousSearch(query);
        if (results.length > 0) {
            const data = { results, source: 'invidious' };
            cacheSet(cacheKey, data);
            return res.json(data);
        }
    } catch (err) {
        console.error('Trending invidious error:', err.message);
    }

    res.status(500).json({ error: 'Trending failed', results: [] });
});

// ============================
// Helpers
// ============================
function parseYtDlpResults(output) {
    return output.trim().split('\n')
        .filter(line => line.trim())
        .map(line => {
            try { return JSON.parse(line); } catch { return null; }
        })
        .filter(item => item && item.id)
        .map(item => ({
            id: item.id,
            title: item.title || 'Untitled',
            channel: item.channel || item.uploader || '',
            views: formatViews(item.view_count),
            duration: formatDuration(item.duration),
            durationSeconds: item.duration || 0,
            thumbnail: `/api/thumbnail/${item.id}`,
            description: (item.description || '').substring(0, 200),
        }));
}

function formatVideoInfo(info) {
    return {
        id: info.id,
        title: info.title || 'Untitled',
        channel: info.channel || info.uploader || '',
        views: formatViews(info.view_count),
        likes: info.like_count,
        duration: formatDuration(info.duration),
        durationSeconds: info.duration || 0,
        description: (info.description || '').substring(0, 500),
        uploadDate: info.upload_date || '',
        thumbnail: `/api/thumbnail/${info.id}`,
    };
}

function formatViews(count) {
    if (!count && count !== 0) return '';
    if (count >= 1e9) return (count / 1e9).toFixed(1) + 'B görüntülenme';
    if (count >= 1e6) return (count / 1e6).toFixed(1) + 'M görüntülenme';
    if (count >= 1e3) return (count / 1e3).toFixed(1) + 'K görüntülenme';
    return count + ' görüntülenme';
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================
// API: Debug & Diagnostics
// ============================
app.get('/api/debug', async (req, res) => {
    const diagnostics = {
        platform: process.platform,
        nodeVersion: process.version,
        binDirExists: fs.existsSync(BIN_DIR),
        ytdlpExists: fs.existsSync(YTDLP_PATH),
        cookiesExists: fs.existsSync(COOKIES_PATH),
        invidiousInstances: invidiousInstances.length,
        cacheSize: cache.size,
    };
    
    // Check python
    try {
        diagnostics.pythonVersion = execSync('python3 --version || python --version', { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
    } catch (e) {
        diagnostics.pythonError = 'Not found';
    }
    
    // Check ffmpeg
    try {
        diagnostics.ffmpegVersion = execSync('ffmpeg -version', { encoding: 'utf8', windowsHide: true, timeout: 5000 }).split('\n')[0].trim();
    } catch (e) {
        diagnostics.ffmpegError = 'Not found';
    }
    
    // Check yt-dlp version
    try {
        if (fs.existsSync(YTDLP_PATH)) {
            if (!isWindows) {
                try { fs.chmodSync(YTDLP_PATH, '755'); } catch {}
            }
            const { execFileSync } = require('child_process');
            diagnostics.ytdlpVersion = execFileSync(YTDLP_PATH, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
        }
    } catch (e) {
        diagnostics.ytdlpError = e.message;
    }

    // Instance health
    diagnostics.instanceHealth = {};
    for (const [url, health] of instanceHealth) {
        diagnostics.instanceHealth[url] = health;
    }
    
    res.json(diagnostics);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// Fallback route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================
// Start
// ============================
async function start() {
    try {
        await ensureYtDlp();
    } catch (err) {
        console.error('❌ Failed to download yt-dlp:', err.message);
        console.log('⚠️  Server will start with Invidious fallback only.');
    }

    // Pre-refresh instances
    refreshPipedInstances().catch(() => {});
    refreshInvidiousInstances().catch(() => {});

    app.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('╔═══════════════════════════════════════════╗');
        console.log('║          ⚡ TeslaPlay Server v3 ⚡        ║');
        console.log('╠═══════════════════════════════════════════╣');
        console.log(`║  🌐  http://localhost:${PORT}               ║`);
        console.log('║  📡  Multi-source fallback active         ║');
        console.log('║  🔄  yt-dlp → Invidious → URL Proxy       ║');
        console.log('╚═══════════════════════════════════════════╝');
        console.log('');
    });
}

start();
