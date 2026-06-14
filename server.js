/**
 * TeslaPlay Server v2
 * 
 * Uses yt-dlp binary for reliable YouTube video extraction.
 * Downloads yt-dlp automatically on first run.
 * 
 * Features:
 *   /api/search?q=query     — Search YouTube via yt-dlp
 *   /api/info/:id           — Get video info + stream URLs
 *   /api/stream/:id         — Proxy video stream
 *   /api/thumbnail/:id      — Proxy thumbnail
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

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
const YTDLP_URL = isWindows
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

async function ensureYtDlp() {
    if (fs.existsSync(YTDLP_PATH)) {
        console.log('✅ yt-dlp binary found');
        if (!isWindows) {
            try { fs.chmodSync(YTDLP_PATH, '755'); } catch (e) {}
        }
        return;
    }

    console.log('📥 Downloading yt-dlp binary...');
    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(YTDLP_PATH);
        function download(url) {
            https.get(url, { headers: { 'User-Agent': 'TeslaPlay/1.0' } }, (res) => {
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
                    console.log('\n✅ yt-dlp downloaded successfully');
                    if (!isWindows) {
                        try { fs.chmodSync(YTDLP_PATH, '755'); } catch (e) {}
                    }
                    resolve();
                });
            }).on('error', reject);
        }
        download(YTDLP_URL);
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
    // Limit cache size
    if (cache.size > 200) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
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

    try {
        // Use yt-dlp to search YouTube
        const output = await runYtDlp([
            `ytsearch15:${query}`,
            '--dump-json',
            '--flat-playlist',
            '--no-warnings',
            '--no-check-certificates',
            '--skip-download',
            '--impersonate', 'chrome',
            '--extractor-args', 'youtube:player-client=web,tv',
        ], 20000);

        const results = output.trim().split('\n')
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

        const data = { results };
        cacheSet(cacheKey, data);
        res.json(data);
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ error: 'Search failed', message: err.message });
    }
});

// ============================
// API: Video Info
// ============================
app.get('/api/info/:id', async (req, res) => {
    const videoId = req.params.id;
    const cacheKey = `info:${videoId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const output = await runYtDlp([
            `https://www.youtube.com/watch?v=${videoId}`,
            '--dump-json',
            '--no-warnings',
            '--no-check-certificates',
            '--skip-download',
            '--impersonate', 'chrome',
            '--extractor-args', 'youtube:player-client=web,tv',
        ], 25000);

        const info = JSON.parse(output);

        const data = {
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

        cacheSet(cacheKey, data);
        res.json(data);
    } catch (err) {
        console.error('Info error:', err.message);
        res.status(500).json({ error: 'Could not fetch video info' });
    }
});

// ============================
// API: Stream Video (proxy via yt-dlp stdout)
// ============================
app.get('/api/stream/:id', (req, res) => {
    const videoId = req.params.id;
    const quality = req.query.q || 'medium';
    const startTime = req.query.t ? parseInt(req.query.t) : 0;

    // Select format based on quality
    let format;
    switch (quality) {
        case 'low':
            format = 'worst[ext=mp4]/worst';
            break;
        case 'high':
            format = 'best[height<=720][ext=mp4]/best[height<=720]/best[ext=mp4]/best';
            break;
        default: // medium
            format = 'best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best';
    }

    const args = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '-f', format,
        '--no-warnings',
        '--no-check-certificates',
        '-o', '-', // Output to stdout
        '--impersonate', 'chrome',
        '--extractor-args', 'youtube:player-client=web,tv',
    ];

    if (startTime > 0) {
        args.push('--download-sections', `*${startTime}-`);
    }

    console.log(`🎬 Streaming: ${videoId} (${quality}) starting at ${startTime}s`);

    const proc = spawn(YTDLP_PATH, args, { windowsHide: true });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'none');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');

    proc.stdout.pipe(res);

    proc.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('WARNING') && !msg.includes('Downloading')) {
            console.error('yt-dlp stderr:', msg);
        }
    });

    proc.on('error', (err) => {
        console.error('Stream spawn error:', err.message);
        if (!res.headersSent) res.status(500).end();
    });

    proc.on('close', (code) => {
        if (code !== 0 && !res.headersSent) {
            res.status(500).end();
        }
    });

    // Clean up on client disconnect
    req.on('close', () => {
        proc.kill('SIGTERM');
    });
});

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

    try {
        const output = await runYtDlp([
            `ytsearch20:${query}`,
            '--dump-json',
            '--flat-playlist',
            '--no-warnings',
            '--no-check-certificates',
            '--skip-download',
            '--impersonate', 'chrome',
            '--extractor-args', 'youtube:player-client=web,tv',
        ], 25000);

        const results = output.trim().split('\n')
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

        const data = { results };
        cacheSet(cacheKey, data);
        res.json(data);
    } catch (err) {
        console.error('Trending error:', err.message);
        res.status(500).json({ error: 'Trending failed', results: [] });
    }
});

// ============================
// Helpers
// ============================
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
    const isWindows = process.platform === 'win32';
    const diagnostics = {
        platform: process.platform,
        binDirExists: fs.existsSync(BIN_DIR),
        ytdlpExists: fs.existsSync(YTDLP_PATH),
    };
    
    // Check if python is installed
    try {
        const { execSync } = require('child_process');
        diagnostics.pythonVersion = execSync('python3 --version || python --version', { encoding: 'utf8', windowsHide: true }).trim();
    } catch (e) {
        diagnostics.pythonError = e.message;
    }
    
    // Check if ffmpeg is installed
    try {
        const { execSync } = require('child_process');
        diagnostics.ffmpegVersion = execSync('ffmpeg -version', { encoding: 'utf8', windowsHide: true }).split('\n')[0].trim();
    } catch (e) {
        diagnostics.ffmpegError = e.message;
    }
    
    // Try running yt-dlp --version
    try {
        const { execFileSync } = require('child_process');
        if (fs.existsSync(YTDLP_PATH)) {
            if (!isWindows) {
                try { fs.chmodSync(YTDLP_PATH, '755'); } catch {}
            }
            diagnostics.ytdlpVersion = execFileSync(YTDLP_PATH, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
        } else {
            diagnostics.ytdlpVersion = 'Executable not found';
        }
    } catch (e) {
        diagnostics.ytdlpError = e.message;
        diagnostics.ytdlpStderr = e.stderr ? e.stderr.toString() : '';
    }
    
    res.json(diagnostics);
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
        console.log('⚠️  Server will start but video features may not work.');
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('╔═══════════════════════════════════════════╗');
        console.log('║          ⚡ TeslaPlay Server ⚡           ║');
        console.log('╠═══════════════════════════════════════════╣');
        console.log(`║  🌐  http://localhost:${PORT}               ║`);
        console.log('║                                           ║');
        console.log('║  Tesla tarayıcısından:                    ║');
        console.log('║  http://<bilgisayar-ip>:3000              ║');
        console.log('╚═══════════════════════════════════════════╝');
        console.log('');
    });
}

start();
