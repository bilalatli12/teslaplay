/**
 * TeslaPlay v2 — Frontend with Canvas Drive-Bypass Mode
 * Connects to yt-dlp powered backend
 */
(function () {
    'use strict';

    /* ───── State ───── */
    const S = {
        view: 'home',
        cat: 'trending',
        video: null,
        favs: load('tp_fav', []),
        hist: load('tp_his', []),
        driveMode: load('tp_dm', false), // Keeps canvas active for bypass
        startTime: 0,                    // Audio sync start time in seconds
        videoDuration: 0,                // Total duration in seconds
    };

    /* ───── Helpers ───── */
    function $(s) { return document.querySelector(s); }
    function $$(s) { return document.querySelectorAll(s); }
    function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } }
    function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
    function isFav(id) { return S.favs.some(v => v.id === id); }

    function formatTime(secs) {
        if (isNaN(secs) || secs === Infinity || secs === null) return '0:00';
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function parseDuration(str) {
        if (!str) return 0;
        const parts = str.split(':').map(Number);
        if (parts.some(isNaN)) return 0;
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        }
        return parts[0] || 0;
    }

    function toast(msg, ok = true) {
        const t = document.createElement('div');
        t.className = 'toast ' + (ok ? 'tok' : 'terr');
        t.innerHTML = ok
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        t.innerHTML += `<span>${msg}</span>`;
        $('#toasts').appendChild(t);
        setTimeout(() => { t.classList.add('tout'); setTimeout(() => t.remove(), 300); }, 3000);
    }

    function vidId(url) {
        if (!url) return null;
        let m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) || url.match(/embed\/([a-zA-Z0-9_-]{11})/) || url.match(/^([a-zA-Z0-9_-]{11})$/);
        return m ? m[1] : null;
    }

    /* ───── DOM Refs ───── */
    const D = {
        searchIn: $('#search-input'), searchCl: $('#search-clear'), searchGo: $('#search-go'),
        heroIn: $('#hero-input'), heroGo: $('#hero-go'),
        qualSel: $('#quality-sel'), fsBtn: $('#fs-btn'), logo: $('#logo'),
        grid: $('#grid'), favGrid: $('#fav-grid'), histGrid: $('#hist-grid'), recGrid: $('#rec-grid'),
        secTitle: $('#sec-title'),
        playerWrap: $('#player-wrap'), vid: $('#vid'), cvs: $('#cvs'), vidLoad: $('#vid-loading'),
        vidTitle: $('#vid-title'), vidChannel: $('#vid-channel'), vidViews: $('#vid-views'),
        favBtn: $('#fav-btn'), closeBtn: $('#close-btn'), recArea: $('#rec-area'),
        homeSec: $('#home-sec'), favSec: $('#fav-sec'), histSec: $('#hist-sec'),
        sLoad: $('#s-load'), sEmpty: $('#s-empty'), sError: $('#s-error'), sErrorMsg: $('#s-error-msg'),
        favEmpty: $('#fav-empty'), histEmpty: $('#hist-empty'),
        toasts: $('#toasts'),
        
        // Custom Controls DOM
        videoFrame: $('#video-frame'),
        customControls: $('#custom-controls'),
        ctrlPlayCenter: $('#ctrl-play-center'),
        ctrlPlayBtn: $('#ctrl-play-btn'),
        ctrlTime: $('#ctrl-time'),
        ctrlProgContainer: $('#ctrl-progress-container'),
        ctrlProgBar: $('#ctrl-progress-bar'),
        ctrlProgCurrent: $('#ctrl-progress-current'),
        ctrlProgHandle: $('#ctrl-progress-handle'),
        ctrlMuteBtn: $('#ctrl-mute-btn'),
        driveBtn: $('#drive-btn'),
    };

    /* ───── Card Builder ───── */
    function card(v) {
        const d = document.createElement('div');
        d.className = 'card';
        const f = isFav(v.id);
        d.innerHTML = `
            <div class="card-thumb">
                <img src="${v.thumbnail || '/api/thumbnail/' + v.id}" alt="" loading="lazy" onerror="this.src='/api/thumbnail/${v.id}?q=default'">
                <div class="card-hover"><div class="card-play"><svg viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21"/></svg></div></div>
                ${v.duration ? `<span class="card-dur">${v.duration}</span>` : ''}
                <button class="card-fav ${f ? 'faved' : ''}" data-fid="${v.id}">
                    <svg viewBox="0 0 24 24" fill="${f ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${f ? '1' : '2'}"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                </button>
            </div>
            <div class="card-body">
                <h3 class="card-t">${v.title}</h3>
                <p class="card-ch">${v.channel || ''}</p>
                <p class="card-st">${v.views || ''}</p>
            </div>`;
        d.addEventListener('click', e => { if (!e.target.closest('.card-fav')) playVideo(v); });
        d.querySelector('.card-fav').addEventListener('click', e => { e.stopPropagation(); toggleFav(v); });
        return d;
    }

    function fillGrid(arr, container) {
        container.innerHTML = '';
        if (!arr || !arr.length) return false;
        arr.forEach(v => container.appendChild(card(v)));
        return true;
    }

    /* ───── Favorites ───── */
    function toggleFav(v) {
        const i = S.favs.findIndex(x => x.id === v.id);
        if (i > -1) { S.favs.splice(i, 1); toast('Favorilerden kaldırıldı'); }
        else { S.favs.unshift(v); toast('Favorilere eklendi ❤️'); }
        save('tp_fav', S.favs);
        // Update all matching fav buttons
        $$(`[data-fid="${v.id}"]`).forEach(b => {
            const on = isFav(v.id);
            b.classList.toggle('faved', on);
            b.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
            b.querySelector('svg').setAttribute('stroke-width', on ? '1' : '2');
        });
        syncPlayerFav();
        if (S.view === 'favorites') showFavs();
    }

    function syncPlayerFav() {
        if (!S.video) return;
        const on = isFav(S.video.id);
        D.favBtn.classList.toggle('faved', on);
        D.favBtn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
    }

    /* ───── History ───── */
    function addHist(v) {
        S.hist = S.hist.filter(x => x.id !== v.id);
        S.hist.unshift({ ...v, at: Date.now() });
        if (S.hist.length > 60) S.hist.length = 60;
        save('tp_his', S.hist);
    }

    /* ───── API ───── */
    async function apiSearch(q) {
        const r = await fetch('/api/search?q=' + encodeURIComponent(q));
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    }
    async function apiTrending(type) {
        const r = await fetch('/api/trending?type=' + encodeURIComponent(type));
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    }
    async function apiInfo(id) {
        const r = await fetch('/api/info/' + id);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    }

    /* ───── Canvas Drive-Bypass Mode Loop ───── */
    let canvasLoopActive = false;
    function renderCanvas() {
        if (!canvasLoopActive) return;
        
        if (S.driveMode && D.vid && !D.vid.paused && !D.vid.ended) {
            // Adjust canvas resolution dynamically based on video stream
            if (D.vid.videoWidth && D.cvs.width !== D.vid.videoWidth) {
                D.cvs.width = D.vid.videoWidth;
                D.cvs.height = D.vid.videoHeight;
            }
            const ctx = D.cvs.getContext('2d');
            ctx.drawImage(D.vid, 0, 0, D.cvs.width, D.cvs.height);
        }
        
        requestAnimationFrame(renderCanvas);
    }

    function startCanvasLoop() {
        if (canvasLoopActive) return;
        canvasLoopActive = true;
        renderCanvas();
    }

    function stopCanvasLoop() {
        canvasLoopActive = false;
    }

    function updateDriveModeUI() {
        D.driveBtn.classList.toggle('drive-on', S.driveMode);
        D.videoFrame.classList.toggle('canvas-active', S.driveMode);
        
        if (S.driveMode && S.video) {
            startCanvasLoop();
        } else {
            stopCanvasLoop();
        }
    }

    function toggleDriveMode() {
        S.driveMode = !S.driveMode;
        save('tp_dm', S.driveMode);
        updateDriveModeUI();
        toast(S.driveMode ? 'Sürüş Modu Aktif (Video Canvas Üzerinde Oynatılıyor)' : 'Normal Mod Aktif');
    }

    /* ───── Playback ───── */
    async function playVideo(v, startTime = 0) {
        S.video = v;
        S.startTime = startTime;

        // Establish total duration
        if (v.durationSeconds) {
            S.videoDuration = v.durationSeconds;
        } else if (v.duration) {
            S.videoDuration = parseDuration(v.duration);
        } else {
            S.videoDuration = 0;
        }

        D.playerWrap.style.display = '';
        D.homeSec.style.display = 'none';
        D.favSec.style.display = 'none';
        D.histSec.style.display = 'none';

        D.vidTitle.textContent = v.title;
        D.vidChannel.textContent = v.channel || '';
        D.vidViews.textContent = v.views || '';
        D.vidLoad.classList.remove('hidden');
        syncPlayerFav();

        // Scroll and add to history only on initial start, not on seeks
        if (startTime === 0) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            addHist(v);
        }

        const q = D.qualSel.value;
        const streamUrl = `/api/stream/${v.id}?q=${q}&t=${startTime}`;

        D.vid.src = streamUrl;
        D.vid.load();

        updateDriveModeUI();

        const hideLoad = () => D.vidLoad.classList.add('hidden');

        D.vid.oncanplay = () => {
            hideLoad();
            D.vid.play().catch(() => {});
        };

        D.vid.onerror = () => {
            hideLoad();
            toast('Video yüklenemedi — tekrar deneyin', false);
        };

        // Timeout safety
        setTimeout(() => { if (!D.vidLoad.classList.contains('hidden')) hideLoad(); }, 15000);

        try {
            const info = await apiInfo(v.id);
            if (info.title) D.vidTitle.textContent = info.title;
            if (info.channel) D.vidChannel.textContent = info.channel;
            if (info.views) D.vidViews.textContent = info.views;
            if (info.durationSeconds) S.videoDuration = info.durationSeconds;
        } catch {}
    }

    function closePlayer() {
        stopCanvasLoop();
        D.vid.pause();
        D.vid.removeAttribute('src');
        D.vid.load();
        D.playerWrap.style.display = 'none';
        S.video = null;
        showView(S.view);
    }

    /* ───── Custom Controls Events & Synchronization ───── */
    let controlsTimer;
    let dragging = false; // Tracks if user is dragging progress bar

    function showControlsOverlay() {
        D.customControls.classList.add('active');
        clearTimeout(controlsTimer);
        if (!D.vid.paused) {
            controlsTimer = setTimeout(() => {
                D.customControls.classList.remove('active');
            }, 3000);
        }
    }

    function syncControlsUI() {
        const isPaused = D.vid.paused;
        
        // Play/Pause Icons Sync
        $$('.play-icon').forEach(el => el.classList.toggle('hidden', !isPaused));
        $$('.pause-icon').forEach(el => el.classList.toggle('hidden', isPaused));
        D.ctrlPlayCenter.classList.toggle('hidden', !isPaused && !D.customControls.classList.contains('active'));

        // Time Progress Sync (Skip if actively dragging scrubber)
        if (!dragging) {
            const current = S.startTime + (D.vid.currentTime || 0);
            const total = S.videoDuration || D.vid.duration || 0;
            D.ctrlTime.textContent = `${formatTime(current)} / ${formatTime(total)}`;
            
            if (total > 0) {
                const pct = (current / total) * 100;
                D.ctrlProgCurrent.style.width = pct + '%';
                D.ctrlProgHandle.style.left = pct + '%';
            }
        }

        // Mute / Speaker Icon Sync
        const isMuted = D.vid.muted;
        $('.volume-on').classList.toggle('hidden', isMuted);
        $('.volume-off').classList.toggle('hidden', !isMuted);
    }

    function setupCustomControls() {
        // Toggle play/pause on click
        const playToggle = () => {
            if (D.vid.paused) {
                D.vid.play();
            } else {
                D.vid.pause();
            }
            showControlsOverlay();
        };

        D.ctrlPlayCenter.onclick = playToggle;
        D.ctrlPlayBtn.onclick = playToggle;

        // Toggle mute
        D.ctrlMuteBtn.onclick = () => {
            D.vid.muted = !D.vid.muted;
            syncControlsUI();
            showControlsOverlay();
        };

        // Click / Drag Scrubber
        let lastRatio = 0;
        const seek = (e) => {
            const rect = D.ctrlProgBar.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let ratio = (clientX - rect.left) / rect.width;
            ratio = Math.max(0, Math.min(1, ratio));
            lastRatio = ratio;
            
            D.ctrlProgCurrent.style.width = (ratio * 100) + '%';
            D.ctrlProgHandle.style.left = (ratio * 100) + '%';
            
            const total = S.videoDuration || D.vid.duration || 0;
            const current = ratio * total;
            D.ctrlTime.textContent = `${formatTime(current)} / ${formatTime(total)}`;
        };

        D.ctrlProgContainer.onmousedown = (e) => { dragging = true; seek(e); };
        D.ctrlProgContainer.ontouchstart = (e) => { dragging = true; seek(e); };

        window.addEventListener('mousemove', (e) => { if (dragging) seek(e); });
        window.addEventListener('touchmove', (e) => { if (dragging) seek(e); });
        
        const handleDragEnd = () => {
            if (!dragging) return;
            dragging = false;
            if (S.video) {
                const total = S.videoDuration || D.vid.duration || 0;
                const seekTime = Math.round(lastRatio * total);
                playVideo(S.video, seekTime);
            }
        };

        window.addEventListener('mouseup', handleDragEnd);
        window.addEventListener('touchend', handleDragEnd);

        // Video DOM events hook
        D.vid.addEventListener('play', syncControlsUI);
        D.vid.addEventListener('pause', syncControlsUI);
        D.vid.addEventListener('timeupdate', syncControlsUI);
        D.vid.addEventListener('volumechange', syncControlsUI);
        D.vid.addEventListener('durationchange', syncControlsUI);

        // Frame interactivity hook (Mouse moves & Taps show controls)
        D.videoFrame.addEventListener('mousemove', showControlsOverlay);
        D.videoFrame.addEventListener('touchstart', showControlsOverlay);
        D.videoFrame.addEventListener('click', (e) => {
            if (e.target === D.vid || e.target === D.cvs || e.target === D.customControls) {
                playToggle();
            }
        });
    }

    /* ───── Search ───── */
    async function doSearch(q) {
        q = (q || '').trim();
        if (!q) return;
        if (S.video) closePlayer(); // Auto close the video player so results are visible
        S.view = 'home';
        showView('home');
        D.secTitle.textContent = `"${q}" sonuçları`;
        D.grid.innerHTML = '';
        D.sLoad.style.display = '';
        D.sEmpty.style.display = 'none';
        D.sError.style.display = 'none';
        D.searchIn.value = q;
        D.searchCl.classList.remove('hidden');
        try {
            const data = await apiSearch(q);
            D.sLoad.style.display = 'none';
            if (!data.results || !data.results.length) { D.sEmpty.style.display = ''; return; }
            fillGrid(data.results, D.grid);
        } catch (e) {
            D.sLoad.style.display = 'none';
            D.sErrorMsg.textContent = e.message || 'Lütfen tekrar deneyin';
            D.sError.style.display = '';
        }
    }

    /* ───── Categories ───── */
    const CAT_LABELS = {
        trending: 'Trend Videolar 🔥', music: 'Müzik 🎵', gaming: 'Oyun 🎮',
        news: 'Haberler 📰', tesla: 'Tesla ⚡', technology: 'Teknoloji 💻', sports: 'Spor ⚽',
    };

    async function loadCat(c) {
        S.cat = c;
        $$('.chip').forEach(b => b.classList.toggle('on', b.dataset.c === c));
        D.secTitle.textContent = CAT_LABELS[c] || 'Videolar';
        D.grid.innerHTML = '';
        D.sLoad.style.display = '';
        D.sEmpty.style.display = 'none';
        D.sError.style.display = 'none';
        try {
            const data = await apiTrending(c);
            D.sLoad.style.display = 'none';
            if (!data.results || !data.results.length) { D.sEmpty.style.display = ''; return; }
            fillGrid(data.results, D.grid);
        } catch (e) {
            D.sLoad.style.display = 'none';
            D.sErrorMsg.textContent = e.message || 'Lütfen tekrar deneyin';
            D.sError.style.display = '';
        }
    }

    /* ───── Navigation ───── */
    function showView(v) {
        S.view = v;
        $$('.bnav-item').forEach(b => b.classList.toggle('on', b.dataset.v === v));
        D.homeSec.style.display = 'none';
        D.favSec.style.display = 'none';
        D.histSec.style.display = 'none';
        if (!S.video) D.playerWrap.style.display = 'none';
        if (v === 'home' || v === 'search') D.homeSec.style.display = '';
        if (v === 'favorites') showFavs();
        if (v === 'history') showHist();
        if (v === 'search') setTimeout(() => D.searchIn.focus(), 50);
    }

    function showFavs() {
        D.favSec.style.display = '';
        if (!S.favs.length) { D.favEmpty.style.display = ''; D.favGrid.innerHTML = ''; }
        else { D.favEmpty.style.display = 'none'; fillGrid(S.favs, D.favGrid); }
    }
    function showHist() {
        D.histSec.style.display = '';
        if (!S.hist.length) { D.histEmpty.style.display = ''; D.histGrid.innerHTML = ''; }
        else { D.histEmpty.style.display = 'none'; fillGrid(S.hist, D.histGrid); }
    }

    /* ───── Events Binding ───── */
    function bind() {
        D.searchGo.onclick = () => doSearch(D.searchIn.value);
        D.searchIn.onkeydown = e => { if (e.key === 'Enter') doSearch(D.searchIn.value); };
        D.searchIn.oninput = () => D.searchCl.classList.toggle('hidden', !D.searchIn.value);
        D.searchCl.onclick = () => { D.searchIn.value = ''; D.searchCl.classList.add('hidden'); D.searchIn.focus(); };
        D.heroGo.onclick = () => doSearch(D.heroIn.value);
        D.heroIn.onkeydown = e => { if (e.key === 'Enter') doSearch(D.heroIn.value); };
        
        $$('.chip').forEach(b => b.onclick = () => loadCat(b.dataset.c));
        D.closeBtn.onclick = closePlayer;
        D.favBtn.onclick = () => { if (S.video) toggleFav(S.video); };
        $$('.bnav-item').forEach(b => b.onclick = () => { if (S.video) closePlayer(); showView(b.dataset.v); });
        D.logo.onclick = () => { if (S.video) closePlayer(); showView('home'); loadCat('trending'); };
        D.fsBtn.onclick = () => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
            else document.exitFullscreen().catch(() => {});
        };
        
        // Quality selector change listener (Preserves time position)
        D.qualSel.onchange = () => {
            if (S.video) {
                const current = S.startTime + (D.vid.currentTime || 0);
                playVideo(S.video, Math.round(current));
            }
        };
        
        // Drive mode button trigger
        D.driveBtn.onclick = toggleDriveMode;

        document.onkeydown = e => {
            if (e.key === 'Escape' && S.video) closePlayer();
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); D.searchIn.focus(); }
        };
    }

    /* ───── Init ───── */
    function init() {
        bind();
        setupCustomControls();
        updateDriveModeUI();
        loadCat('trending');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
