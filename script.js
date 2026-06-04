/**
 * TeslaPlay — YouTube Player for Tesla Model Y
 * Full-featured YouTube browsing and playback experience
 */

(function () {
    'use strict';

    // ============================
    // Configuration
    // ============================
    const CONFIG = {
        // Using Invidious API instances as proxy for YouTube search (no API key needed)
        INVIDIOUS_INSTANCES: [
            'https://vid.puffyan.us',
            'https://invidious.snopyta.org',
            'https://invidious.kavin.rocks',
            'https://y.com.sb',
            'https://invidious.nerdvpn.de'
        ],
        RESULTS_PER_PAGE: 12,
        STORAGE_KEY_FAVORITES: 'teslaplay_favorites',
        STORAGE_KEY_HISTORY: 'teslaplay_history',
        STORAGE_KEY_THEME: 'teslaplay_theme',
    };

    // ============================
    // State
    // ============================
    const state = {
        currentView: 'home',
        currentCategory: 'trending',
        isListView: false,
        currentVideoId: null,
        player: null,
        favorites: JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY_FAVORITES) || '[]'),
        history: JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY_HISTORY) || '[]'),
        searchQuery: '',
        isLoading: false,
    };

    // ============================
    // Curated Video Collections (Fallback / Default Content)
    // ============================
    const CURATED_VIDEOS = {
        trending: [
            { id: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', channel: 'Rick Astley', views: '1.5B views', duration: '3:33', thumbnail: '' },
            { id: 'kJQP7kiw5Fk', title: 'Luis Fonsi - Despacito ft. Daddy Yankee', channel: 'Luis Fonsi', views: '8.2B views', duration: '4:42', thumbnail: '' },
            { id: '9bZkp7q19f0', title: 'PSY - GANGNAM STYLE', channel: 'officialpsy', views: '4.9B views', duration: '4:13', thumbnail: '' },
            { id: 'JGwWNGJdvx8', title: 'Ed Sheeran - Shape of You', channel: 'Ed Sheeran', views: '6.1B views', duration: '4:24', thumbnail: '' },
            { id: 'RgKAFK5djSk', title: 'Wiz Khalifa - See You Again ft. Charlie Puth', channel: 'Wiz Khalifa', views: '5.8B views', duration: '3:58', thumbnail: '' },
            { id: '09R8_2nJtjg', title: 'Maroon 5 - Sugar', channel: 'Maroon 5', views: '3.7B views', duration: '5:01', thumbnail: '' },
            { id: 'fJ9rUzIMcZQ', title: 'Queen – Bohemian Rhapsody', channel: 'Queen Official', views: '1.7B views', duration: '5:55', thumbnail: '' },
            { id: 'hT_nvWreIhg', title: 'OneRepublic - Counting Stars', channel: 'OneRepublic', views: '3.8B views', duration: '4:44', thumbnail: '' },
        ],
        music: [
            { id: 'YQHsXMglC9A', title: 'Adele - Hello', channel: 'Adele', views: '3.1B views', duration: '6:07', thumbnail: '' },
            { id: '60ItHLz5WEA', title: 'Alan Walker - Faded', channel: 'Alan Walker', views: '3.5B views', duration: '3:33', thumbnail: '' },
            { id: 'PT2_F-1esPk', title: 'The Chainsmokers - Something Just Like This', channel: 'The Chainsmokers', views: '2.1B views', duration: '4:07', thumbnail: '' },
            { id: 'SlPhMPnQ58k', title: 'Maroon 5 - Payphone ft. Wiz Khalifa', channel: 'Maroon 5', views: '1.3B views', duration: '3:54', thumbnail: '' },
            { id: 'bo_efYhYU2A', title: 'Sia - Unstoppable', channel: 'Sia', views: '900M views', duration: '3:38', thumbnail: '' },
            { id: 'e-ORhEE9VVg', title: 'Taylor Swift - Blank Space', channel: 'Taylor Swift', views: '3.2B views', duration: '4:33', thumbnail: '' },
            { id: 'lp-EO5I60KA', title: 'Eminem - Lose Yourself', channel: 'Eminem', views: '1.4B views', duration: '5:26', thumbnail: '' },
            { id: 'IcrbM1l_BoI', title: 'Calvin Harris - Summer', channel: 'Calvin Harris', views: '1.1B views', duration: '3:43', thumbnail: '' },
        ],
        tesla: [
            { id: 'XB2g7-HgE_g', title: 'Tesla Model Y - Full Review 2024', channel: 'MKBHD', views: '15M views', duration: '18:22', thumbnail: '' },
            { id: '5OjrHJaYbe0', title: 'Tesla Autopilot - How Does It Work?', channel: 'TechLinked', views: '3.2M views', duration: '12:45', thumbnail: '' },
            { id: 'tFB0wVuE6ho', title: 'Tesla Factory Tour - How Teslas Are Made', channel: 'Wired', views: '8.1M views', duration: '14:33', thumbnail: '' },
            { id: 'SA1Bz08i0uo', title: 'I Drove A Tesla For 30 Days - Here\'s What Happened', channel: 'MrBeast', views: '25M views', duration: '16:40', thumbnail: '' },
            { id: 'M_wZpSEvOkc', title: 'Tesla vs Every Electric Car - Range Test', channel: 'Carwow', views: '12M views', duration: '22:15', thumbnail: '' },
            { id: '3KvsDMp4_IA', title: 'Tesla Model Y Road Trip - Tips & Tricks', channel: 'Tesla Raj', views: '2.1M views', duration: '19:30', thumbnail: '' },
            { id: 'csVpa25iqH0', title: 'Elon Musk Interview - Future of Tesla', channel: 'Lex Fridman', views: '18M views', duration: '45:00', thumbnail: '' },
            { id: 'w0lBBRiPjKU', title: 'Tesla FSD Beta - Latest Update Review', channel: 'Dirty Tesla', views: '1.8M views', duration: '15:20', thumbnail: '' },
        ],
        technology: [
            { id: 'MnrJzXM7a6o', title: 'How Does The Internet Work?', channel: 'Kurzgesagt', views: '22M views', duration: '11:02', thumbnail: '' },
            { id: 'WMwh4EvV8Xg', title: 'Apple Vision Pro - 6 Months Later', channel: 'MKBHD', views: '9.5M views', duration: '14:20', thumbnail: '' },
            { id: 'jNQXAC9IVRw', title: 'Me at the zoo', channel: 'jawed', views: '300M views', duration: '0:19', thumbnail: '' },
            { id: 'aircAruvnKk', title: 'How AI Will Change Everything', channel: 'Veritasium', views: '15M views', duration: '20:45', thumbnail: '' },
            { id: 'YI3tsmFsrOg', title: 'Inside a Google Data Center', channel: 'Google', views: '7.8M views', duration: '5:20', thumbnail: '' },
            { id: 'IHZwWFHWa-w', title: 'The History of the Computer', channel: 'CrashCourse', views: '12M views', duration: '11:36', thumbnail: '' },
            { id: 'mhBcwq_WMYM', title: 'Why Foldable Phones are the Future', channel: 'Linus Tech Tips', views: '5.4M views', duration: '16:00', thumbnail: '' },
            { id: 'J---aiyznGQ', title: 'Quantum Computing Explained', channel: 'IBM', views: '8.2M views', duration: '7:34', thumbnail: '' },
        ],
        gaming: [
            { id: 'PYRa4_aVGAM', title: 'GTA 6 - Official Trailer', channel: 'Rockstar Games', views: '200M views', duration: '1:31', thumbnail: '' },
            { id: 'dLVKTzDHvAA', title: 'Minecraft But I Build A House Every 10 Minutes', channel: 'MrBeast Gaming', views: '45M views', duration: '22:30', thumbnail: '' },
            { id: 'hHte5NRahPg', title: 'The Best Games of 2024', channel: 'IGN', views: '8M views', duration: '18:00', thumbnail: '' },
            { id: 'T7eihBAGrWE', title: 'Speed Running Super Mario - World Record', channel: 'Summoning Salt', views: '6.2M views', duration: '35:40', thumbnail: '' },
            { id: 'LYJFtaD2WZA', title: 'I Played The World\'s Hardest Game', channel: 'Markiplier', views: '32M views', duration: '25:10', thumbnail: '' },
            { id: 'XKxCDAVuRVo', title: 'Fortnite Season 15 - What\'s New', channel: 'SypherPK', views: '4.3M views', duration: '14:22', thumbnail: '' },
            { id: '4u1_fRN7bsc', title: 'Building a PC for $500 - Worth It?', channel: 'JayzTwoCents', views: '3.1M views', duration: '20:00', thumbnail: '' },
            { id: '0L_iOnLNt9M', title: 'League of Legends - Pro Play Highlights', channel: 'LoL Esports', views: '2.5M views', duration: '12:45', thumbnail: '' },
        ],
        news: [
            { id: '7Pq-S557XQU', title: 'World News Update - Today\'s Headlines', channel: 'BBC News', views: '2.1M views', duration: '15:00', thumbnail: '' },
            { id: 'owGykVbfgUE', title: 'Technology News Roundup', channel: 'The Verge', views: '1.8M views', duration: '12:30', thumbnail: '' },
            { id: '3OyrX11cMkE', title: 'SpaceX Latest Launch - Full Coverage', channel: 'SpaceX', views: '5.4M views', duration: '45:00', thumbnail: '' },
            { id: 'X0VYCfSgXpA', title: 'Climate Change - What We Can Do', channel: 'Vox', views: '9.2M views', duration: '18:20', thumbnail: '' },
        ],
        sports: [
            { id: 'B4DmEHtlKlk', title: 'Champions League Highlights 2024', channel: 'UEFA', views: '15M views', duration: '10:30', thumbnail: '' },
            { id: 'tCXGJQYZ9JA', title: 'NBA Top 10 Plays of the Year', channel: 'NBA', views: '22M views', duration: '8:45', thumbnail: '' },
            { id: 'PZX0OMt4TpA', title: 'F1 Monaco Grand Prix - Best Moments', channel: 'Formula 1', views: '8.7M views', duration: '14:00', thumbnail: '' },
            { id: 'e3Nl_TCQXuw', title: 'Cristiano Ronaldo - Greatest Goals', channel: 'Football Daily', views: '35M views', duration: '20:15', thumbnail: '' },
        ],
        comedy: [
            { id: '7WH1Bsdzh7A', title: 'Try Not To Laugh Challenge', channel: 'Markiplier', views: '45M views', duration: '18:30', thumbnail: '' },
            { id: 'rksarl3ZkMY', title: 'Stand-Up Comedy Special 2024', channel: 'Netflix Comedy', views: '12M views', duration: '55:00', thumbnail: '' },
            { id: '6iOXbPaYmPc', title: 'Funny Cat Videos Compilation', channel: 'Cat Lovers', views: '85M views', duration: '12:00', thumbnail: '' },
            { id: 'HBQ2mjkvYjE', title: 'Best Pranks of 2024', channel: 'Just For Laughs', views: '18M views', duration: '22:40', thumbnail: '' },
        ],
        travel: [
            { id: 'iL-gVknSLeo', title: 'World\'s Most Beautiful Places - 4K', channel: 'Scenic Relaxation', views: '45M views', duration: '30:00', thumbnail: '' },
            { id: 'bIjWiEY9wHs', title: 'Tokyo Travel Guide - Top 10 Things To Do', channel: 'Lost LeBlanc', views: '8.5M views', duration: '18:00', thumbnail: '' },
            { id: 'EFJ7kDva7tc', title: 'Road Trip Across Turkey', channel: 'Kara & Nate', views: '5.2M views', duration: '25:00', thumbnail: '' },
            { id: 'SXB2AHKqfhk', title: 'Iceland 4K - Amazing Nature Drone', channel: 'Nature 4K', views: '32M views', duration: '60:00', thumbnail: '' },
        ],
    };

    // ============================
    // DOM Elements
    // ============================
    const DOM = {
        searchInput: document.getElementById('search-input'),
        searchClear: document.getElementById('search-clear'),
        searchBtn: document.getElementById('search-btn'),
        heroSearchInput: document.getElementById('hero-search-input'),
        heroSearchBtn: document.getElementById('hero-search-btn'),
        videoGrid: document.getElementById('video-grid'),
        favoritesGrid: document.getElementById('favorites-grid'),
        loadingIndicator: document.getElementById('loading-indicator'),
        noResults: document.getElementById('no-results'),
        sectionTitle: document.getElementById('section-title'),
        playerSection: document.getElementById('player-section'),
        playerTitle: document.getElementById('player-title'),
        playerChannel: document.getElementById('player-channel'),
        playerViews: document.getElementById('player-views'),
        playerDescription: document.getElementById('player-description'),
        playerClose: document.getElementById('player-close'),
        heroSection: document.getElementById('hero-section'),
        categoriesSection: document.getElementById('categories-section'),
        videosSection: document.getElementById('videos-section'),
        urlSection: document.getElementById('url-section'),
        favoritesSection: document.getElementById('favorites-section'),
        urlInput: document.getElementById('url-input'),
        urlPlayBtn: document.getElementById('url-play-btn'),
        gridViewBtn: document.getElementById('grid-view-btn'),
        listViewBtn: document.getElementById('list-view-btn'),
        fullscreenBtn: document.getElementById('fullscreen-btn'),
        themeToggle: document.getElementById('theme-toggle'),
        logoBtn: document.getElementById('logo-btn'),
        toastContainer: document.getElementById('toast-container'),
    };

    // ============================
    // Utility Functions
    // ============================
    function getThumbnail(videoId) {
        return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    }

    function getHQThumbnail(videoId) {
        return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    }

    function extractVideoId(url) {
        if (!url) return null;
        // Try standard watch URL
        let match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];
        // Try short URL
        match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];
        // Try embed URL
        match = url.match(/embed\/([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];
        // Try if it's just an ID
        match = url.match(/^([a-zA-Z0-9_-]{11})$/);
        if (match) return match[1];
        return null;
    }

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const iconSvg = type === 'success'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        toast.innerHTML = `${iconSvg}<span>${message}</span>`;
        DOM.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('leaving');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function saveFavorites() {
        localStorage.setItem(CONFIG.STORAGE_KEY_FAVORITES, JSON.stringify(state.favorites));
    }

    function saveHistory() {
        localStorage.setItem(CONFIG.STORAGE_KEY_HISTORY, JSON.stringify(state.history));
    }

    function isFavorite(videoId) {
        return state.favorites.some(v => v.id === videoId);
    }

    function toggleFavorite(video, event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        const idx = state.favorites.findIndex(v => v.id === video.id);
        if (idx > -1) {
            state.favorites.splice(idx, 1);
            showToast('Favorilerden kaldırıldı');
        } else {
            state.favorites.unshift(video);
            showToast('Favorilere eklendi ❤️');
        }
        saveFavorites();
        // Update UI
        document.querySelectorAll(`.favorite-btn[data-id="${video.id}"]`).forEach(btn => {
            btn.classList.toggle('favorited', isFavorite(video.id));
            btn.innerHTML = isFavorite(video.id)
                ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
        });
        // Re-render favorites if on favorites page
        if (state.currentView === 'favorites') {
            renderFavorites();
        }
    }

    function addToHistory(video) {
        // Remove existing if present
        state.history = state.history.filter(v => v.id !== video.id);
        // Add to beginning
        state.history.unshift({ ...video, watchedAt: Date.now() });
        // Limit history
        if (state.history.length > 50) state.history = state.history.slice(0, 50);
        saveHistory();
    }

    // ============================
    // Video Card Rendering
    // ============================
    function createVideoCard(video) {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.setAttribute('data-id', video.id);

        const thumb = video.thumbnail || getThumbnail(video.id);
        const fav = isFavorite(video.id);

        card.innerHTML = `
            <div class="thumbnail-wrapper">
                <img class="thumbnail" src="${thumb}" alt="${video.title}" loading="lazy" 
                     onerror="this.src='https://img.youtube.com/vi/${video.id}/default.jpg'">
                <div class="play-overlay">
                    <div class="play-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                    </div>
                </div>
                ${video.duration ? `<span class="duration-badge">${video.duration}</span>` : ''}
                <button class="favorite-btn ${fav ? 'favorited' : ''}" data-id="${video.id}" aria-label="Favorilere ekle">
                    <svg viewBox="0 0 24 24" fill="${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${fav ? '1' : '2'}">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                </button>
            </div>
            <div class="card-info">
                <h3 class="card-title">${video.title}</h3>
                <p class="card-channel">${video.channel || 'YouTube'}</p>
                <p class="card-stats">${video.views || ''}</p>
            </div>
        `;

        // Play video on click
        card.addEventListener('click', () => playVideo(video));

        // Favorite button
        const favBtn = card.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => toggleFavorite(video, e));

        return card;
    }

    function renderVideoGrid(videos, container = DOM.videoGrid) {
        container.innerHTML = '';
        DOM.noResults.style.display = 'none';

        if (!videos || videos.length === 0) {
            DOM.noResults.style.display = 'flex';
            return;
        }

        videos.forEach(video => {
            container.appendChild(createVideoCard(video));
        });
    }

    // ============================
    // Category / Default Content
    // ============================
    function loadCategory(category) {
        state.currentCategory = category;

        // Update active chip
        document.querySelectorAll('.category-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.category === category);
        });

        const categoryNames = {
            trending: 'Öne Çıkanlar 🔥',
            music: 'Müzik 🎵',
            tesla: 'Tesla 🚗',
            technology: 'Teknoloji 💻',
            gaming: 'Oyun 🎮',
            news: 'Haberler 📰',
            sports: 'Spor ⚽',
            comedy: 'Komedi 😂',
            travel: 'Seyahat ✈️',
        };

        DOM.sectionTitle.textContent = categoryNames[category] || 'Videolar';

        const videos = CURATED_VIDEOS[category] || CURATED_VIDEOS.trending;
        // Add thumbnails
        const videosWithThumbs = videos.map(v => ({
            ...v,
            thumbnail: getThumbnail(v.id),
        }));

        renderVideoGrid(videosWithThumbs);
    }

    // ============================
    // Search Functionality
    // ============================
    async function searchYouTube(query) {
        if (!query.trim()) return;

        state.searchQuery = query.trim();
        state.isLoading = true;

        DOM.sectionTitle.textContent = `"${state.searchQuery}" için sonuçlar`;
        DOM.videoGrid.innerHTML = '';
        DOM.loadingIndicator.style.display = 'flex';
        DOM.noResults.style.display = 'none';

        // Hide hero if visible
        DOM.heroSection.style.display = 'none';

        // Try Invidious API for search
        let results = null;

        for (const instance of CONFIG.INVIDIOUS_INSTANCES) {
            try {
                const response = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort=relevance`, {
                    signal: AbortSignal.timeout(5000)
                });
                if (response.ok) {
                    const data = await response.json();
                    results = data.filter(item => item.type === 'video').map(item => ({
                        id: item.videoId,
                        title: item.title,
                        channel: item.author,
                        views: item.viewCountText || formatViews(item.viewCount),
                        duration: formatDuration(item.lengthSeconds),
                        thumbnail: item.videoThumbnails?.[4]?.url || getThumbnail(item.videoId),
                        description: item.description || '',
                    }));
                    break;
                }
            } catch (e) {
                // Try next instance
                continue;
            }
        }

        // Fallback: search through curated videos if API fails
        if (!results || results.length === 0) {
            const lowerQuery = query.toLowerCase();
            results = [];
            Object.values(CURATED_VIDEOS).forEach(videos => {
                videos.forEach(v => {
                    if (v.title.toLowerCase().includes(lowerQuery) ||
                        v.channel.toLowerCase().includes(lowerQuery)) {
                        if (!results.find(r => r.id === v.id)) {
                            results.push({ ...v, thumbnail: getThumbnail(v.id) });
                        }
                    }
                });
            });
        }

        state.isLoading = false;
        DOM.loadingIndicator.style.display = 'none';

        renderVideoGrid(results);
    }

    function formatViews(count) {
        if (!count) return '';
        if (count >= 1e9) return (count / 1e9).toFixed(1) + 'B views';
        if (count >= 1e6) return (count / 1e6).toFixed(1) + 'M views';
        if (count >= 1e3) return (count / 1e3).toFixed(1) + 'K views';
        return count + ' views';
    }

    function formatDuration(seconds) {
        if (!seconds) return '';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // ============================
    // Video Playback
    // ============================
    function playVideo(video) {
        state.currentVideoId = video.id;

        // Update player info
        DOM.playerTitle.textContent = video.title;
        DOM.playerChannel.textContent = video.channel || 'YouTube';
        DOM.playerViews.textContent = video.views || '';
        DOM.playerDescription.textContent = video.description || '';

        // Show player
        DOM.playerSection.style.display = 'block';

        // Create iframe directly (more compatible with Tesla browser)
        const container = document.getElementById('player-container');
        container.innerHTML = `
            <iframe 
                src="https://www.youtube.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowfullscreen
                style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;">
            </iframe>
        `;

        // Scroll to player
        DOM.playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Add to history
        addToHistory(video);
    }

    function closePlayer() {
        DOM.playerSection.style.display = 'none';
        const container = document.getElementById('player-container');
        container.innerHTML = '<div id="youtube-player"></div>';
        state.currentVideoId = null;
    }

    // ============================
    // Favorites & History
    // ============================
    function renderFavorites() {
        if (state.favorites.length === 0) {
            DOM.favoritesGrid.innerHTML = `
                <div class="no-results" style="display:flex; grid-column: 1/-1;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                    <h3>Henüz favori yok</h3>
                    <p>Beğendiğiniz videoları kalp simgesine tıklayarak ekleyin</p>
                </div>
            `;
            return;
        }

        const vids = state.favorites.map(v => ({ ...v, thumbnail: v.thumbnail || getThumbnail(v.id) }));
        renderVideoGrid(vids, DOM.favoritesGrid);
    }

    function renderHistory() {
        const historySection = document.getElementById('favorites-section');
        const historyGrid = document.getElementById('favorites-grid');

        if (state.history.length === 0) {
            historyGrid.innerHTML = `
                <div class="no-results" style="display:flex; grid-column: 1/-1;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <h3>Geçmiş boş</h3>
                    <p>İzlediğiniz videolar burada görünecek</p>
                </div>
            `;
            return;
        }

        const vids = state.history.map(v => ({ ...v, thumbnail: v.thumbnail || getThumbnail(v.id) }));
        renderVideoGrid(vids, historyGrid);
    }

    // ============================
    // Navigation
    // ============================
    function navigateTo(view) {
        state.currentView = view;

        // Update nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.nav === view);
        });

        // Show/hide sections
        const sections = {
            home: () => {
                DOM.heroSection.style.display = '';
                DOM.categoriesSection.style.display = '';
                DOM.videosSection.style.display = '';
                DOM.urlSection.style.display = '';
                DOM.favoritesSection.style.display = 'none';
                loadCategory(state.currentCategory);
            },
            search: () => {
                DOM.heroSection.style.display = 'none';
                DOM.categoriesSection.style.display = 'none';
                DOM.videosSection.style.display = '';
                DOM.urlSection.style.display = 'none';
                DOM.favoritesSection.style.display = 'none';
                DOM.searchInput.focus();
                DOM.sectionTitle.textContent = 'Arama Sonuçları';
            },
            favorites: () => {
                DOM.heroSection.style.display = 'none';
                DOM.categoriesSection.style.display = 'none';
                DOM.videosSection.style.display = 'none';
                DOM.urlSection.style.display = 'none';
                DOM.favoritesSection.style.display = '';
                document.querySelector('.favorites-section .section-title').innerHTML = `
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" style="width:22px;height:22px;color:var(--accent-primary);">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                    Favorilerim
                `;
                renderFavorites();
            },
            history: () => {
                DOM.heroSection.style.display = 'none';
                DOM.categoriesSection.style.display = 'none';
                DOM.videosSection.style.display = 'none';
                DOM.urlSection.style.display = 'none';
                DOM.favoritesSection.style.display = '';
                document.querySelector('.favorites-section .section-title').innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:22px;height:22px;color:var(--accent-primary);">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    İzleme Geçmişi
                `;
                renderHistory();
            },
        };

        if (sections[view]) sections[view]();
    }

    // ============================
    // Event Listeners
    // ============================
    function initEventListeners() {
        // Search (header)
        DOM.searchBtn.addEventListener('click', () => {
            searchYouTube(DOM.searchInput.value);
        });

        DOM.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchYouTube(DOM.searchInput.value);
        });

        DOM.searchInput.addEventListener('input', () => {
            DOM.searchClear.classList.toggle('visible', DOM.searchInput.value.length > 0);
        });

        DOM.searchClear.addEventListener('click', () => {
            DOM.searchInput.value = '';
            DOM.searchClear.classList.remove('visible');
            DOM.searchInput.focus();
        });

        // Hero search
        DOM.heroSearchBtn.addEventListener('click', () => {
            const query = DOM.heroSearchInput.value;
            if (query.trim()) {
                DOM.searchInput.value = query;
                searchYouTube(query);
            }
        });

        DOM.heroSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = DOM.heroSearchInput.value;
                if (query.trim()) {
                    DOM.searchInput.value = query;
                    searchYouTube(query);
                }
            }
        });

        // Categories
        document.querySelectorAll('.category-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                loadCategory(chip.dataset.category);
            });
        });

        // Player close
        DOM.playerClose.addEventListener('click', closePlayer);

        // URL Play
        DOM.urlPlayBtn.addEventListener('click', () => {
            const url = DOM.urlInput.value.trim();
            const videoId = extractVideoId(url);
            if (videoId) {
                playVideo({
                    id: videoId,
                    title: 'YouTube Video',
                    channel: '',
                    views: '',
                    thumbnail: getThumbnail(videoId),
                });
                DOM.urlInput.value = '';
            } else {
                showToast('Geçerli bir YouTube linki yapıştırın', 'error');
            }
        });

        DOM.urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') DOM.urlPlayBtn.click();
        });

        // View toggles
        DOM.gridViewBtn.addEventListener('click', () => {
            state.isListView = false;
            DOM.gridViewBtn.classList.add('active');
            DOM.listViewBtn.classList.remove('active');
            document.querySelectorAll('.video-grid').forEach(g => g.classList.remove('list-view'));
        });

        DOM.listViewBtn.addEventListener('click', () => {
            state.isListView = true;
            DOM.listViewBtn.classList.add('active');
            DOM.gridViewBtn.classList.remove('active');
            document.querySelectorAll('.video-grid').forEach(g => g.classList.add('list-view'));
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                navigateTo(item.dataset.nav);
            });
        });

        // Logo click => go home
        DOM.logoBtn.addEventListener('click', () => {
            navigateTo('home');
        });

        // Fullscreen
        DOM.fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => { });
            } else {
                document.exitFullscreen().catch(() => { });
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (state.currentVideoId) closePlayer();
            }
            // Ctrl+K for search focus
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                DOM.searchInput.focus();
            }
        });
    }

    // ============================
    // Initialize
    // ============================
    function init() {
        initEventListeners();
        loadCategory('trending');
    }

    // Start the app
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
