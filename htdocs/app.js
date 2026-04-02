/* ============================================
   ABHRO'S VAULT — APP LOGIC
   TMDB + VidKing + VidSrc + 2Embed
   ============================================ */

'use strict';

// ─── Config ─────────────────────────────────
// NOTE: Replace TMDB_KEY with your own key from https://www.themoviedb.org/settings/api
const TMDB_KEY  = '4e44d9029b1270a757cddc766a1bcb63';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_W500  = 'https://image.tmdb.org/t/p/w500';
const IMG_ORI   = 'https://image.tmdb.org/t/p/original';

// ---- Anime ---------------------------------
async function fetchMalId(title) {
  try {
    const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=1`);
    const data = await res.json();

    if (data.data && data.data.length > 0) {
      return data.data[0].mal_id;
    }
  } catch (e) {
    console.error("MAL fetch failed", e);
  }
  return null;
}

async function detectAnime(item) {
  // TMDB genre id 16 = Animation or check Japanese original language
  if ((item.genre_ids && item.genre_ids.includes(16)) || item.original_language === 'ja') {
    animeMode = true;
    malId = await fetchMalId(item.title || item.name);

    if (malId || animeMode) {
      document.getElementById('animeControls')?.classList.remove('hidden');
    }
  } else {
    animeMode = false;
    malId = null;
    // Hide controls if it's a standard movie/show
    document.getElementById('animeControls')?.classList.add('hidden');
  }
}

// ─── State ──────────────────────────────────
let currentItem   = null;
let currentSource = 'videasy';
let currentSeason = 1;
let currentEp     = 1;
let searchTimer   = null;
let searchType    = 'multi';
let animeMode = false;
let malId = null;
let animeType = 'sub';
let siteConfig = null;

// ─── Storage Helpers ────────────────────────
function getWatchlist() { return JSON.parse(localStorage.getItem('vault_watchlist') || '[]'); }
function setWatchlist(l) { localStorage.setItem('vault_watchlist', JSON.stringify(l)); }
function getHistory()   { return JSON.parse(localStorage.getItem('vault_history')   || '[]'); }
function setHistory(l)  { localStorage.setItem('vault_history',   JSON.stringify(l)); }

function inWatchlist(id) { return getWatchlist().some(x => x.id === id); }
function addToWatchlist(item) {
  const wl = getWatchlist();
  if (!inWatchlist(item.id)) { wl.push(item); setWatchlist(wl); }
}
function removeFromWatchlist(id) { setWatchlist(getWatchlist().filter(x => x.id !== id)); }
function toggleWatchlist(item) {
  if (inWatchlist(item.id)) { removeFromWatchlist(item.id); return false; }
  else { addToWatchlist(item); return true; }
}

function addToHistory(item) {
  let hist = getHistory().filter(x => x.id !== item.id);
  hist.push({ ...item, watchedAt: Date.now() });
  if (hist.length > 200) hist = hist.slice(-200);
  setHistory(hist);
}

// ─── Toast ──────────────────────────────────
function showToast(msg, icon = 'check-circle') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<i data-lucide="${icon}"></i> ${msg}`;
  container.appendChild(t);
  lucide.createIcons({ nodes: [t] });
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)';
    t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, 2800);
}

// ─── Notify Awesome Clone ────────────────────
function showNotifyAwesome(title, msg, icon = 'bell', duration = 5000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const t = document.createElement('div');
  t.className = 'notify-awesome-toast';
  t.innerHTML = `
    <div class="notify-icon"><i data-lucide="${icon}"></i></div>
    <div class="notify-content">
      ${title ? `<h4>${title}</h4>` : ''}
      <p>${msg}</p>
    </div>
    <button class="notify-close" style="background:none; border:none; color:#fff; cursor:pointer; position:absolute; top:10px; right:10px;"><i data-lucide="x" style="width:14px; height:14px;"></i></button>
  `;
  
  container.appendChild(t);
  lucide.createIcons({ nodes: [t] });
  
  const removeToast = () => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(50px)';
    t.style.transition = 'all 0.3s ease';
    setTimeout(() => t.remove(), 300);
  };

  t.querySelector('.notify-close').onclick = removeToast;

  if (duration > 0) {
    setTimeout(() => {
      if (t.parentElement) removeToast();
    }, duration);
  }
}

// ─── Fetch Helpers ───────────────────────────
async function tmdb(path, params = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', TMDB_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  return res.json();
}

// ─── Build Embed URLs ─────────────────────────
// ─── Sources (ARRAY SYSTEM) ─────────────────────────
const SOURCES = [
  {
    id: 'videasy',
    movie: (id) => `https://player.videasy.net/movie/${id}`,
    tv: (id, s, e) => `https://player.videasy.net/tv/${id}/${s}/${e}`
  },
  {
    id: 'vidlink',
    movie: (id) => `https://vidlink.pro/movie/${id}${animeMode ? `?type=${animeType}` : ''}`,
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}${animeMode ? `?type=${animeType}` : ''}`
  },
  {
    id: 'vidking',
    movie: (id) => `https://www.vidking.net/embed/movie/${id}`,
    tv: (id, s, e) => `https://www.vidking.net/embed/tv/${id}/${s}/${e}`
  },
  {
    id: 'vidsrc',
    movie: (id) => `https://vidsrc.me/embed/movie?tmdb=${id}`,
    tv: (id, s, e) => `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}`
  },
  {
    id: 'embed',
    movie: (id) => `https://www.2embed.cc/embed/${id}`,
    tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`
  },
  {
    id: 'vidrock',
    movie: (id) => `https://vidrock.cc/embed/movie?tmdb=${id}`,
    tv: (id, s, e) => `https://vidrock.cc/embed/tv?tmdb=${id}&season=${s}&episode=${e}`
  },
  {
    id: '111movies',
    movie: (id) => `https://111movies.com/movie/${id}`,
    tv: (id, s, e) => `https://111movies.com/tv/${id}/${s}/${e}`
  },
  {
    id: 'vidzee',
    movie: (id) => `https://vidzee.wtf/movie/${id}`,
    tv: (id, s, e) => `https://vidzee.wtf/tv/${id}/${s}/${e}`
  },
  {
    id: 'vidsrc2',
    movie: (id) => `https://vidsrc.to/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`
  },
  {
    id: 'vidsrc3',
    movie: (id) => `https://vidsrc.cc/v2/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}`
  },
  {
    id: 'vidnest',
    movie: (id) => `https://vidnest.su/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidnest.su/embed/tv/${id}/${s}/${e}`
  },
  {
    id: 'rivestream',
    movie: (id) => `https://rivestream.org/embed?type=movie&id=${id}`,
    tv: (id, s, e) => `https://rivestream.org/embed?type=tv&id=${id}&season=${s}&episode=${e}`
  },
  {
    id: 'vidsrcxyz',
    movie: (id) => `https://vidsrc.xyz/embed/movie?tmdb=${id}`,
    tv: (id, s, e) => `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${s}&episode=${e}`
  },
  {
    id: 'vidsrcicu',
    movie: (id) => `https://vidsrc.icu/embed/movie/${id}`,
    tv: (id, s, e) => `https://vidsrc.icu/embed/tv/${id}/${s}/${e}`
  }
];

function buildEmbedUrl(item, srcId, season = 1, ep = 1) {
  const source = SOURCES.find(s => s.id === srcId) || SOURCES[0];
  const id = item.id;
  const type = item.media_type;

  if (type === 'tv') {
    return source.tv(id, season, ep);
  } else {
    return source.movie(id);
  }
}

// ─── Card Builder ─────────────────────────────
function buildCard(item) {
  const title   = item.title || item.name || 'Unknown';
  const year    = (item.release_date || item.first_air_date || '').slice(0, 4);
  const rating  = item.vote_average ? item.vote_average.toFixed(1) : '';
  const poster  = item.poster_path ? `${IMG_W500}${item.poster_path}` : '';
  const type    = item.media_type || 'movie';

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    ${poster
      ? `<img class="card-poster" src="${poster}" alt="${title}" loading="lazy">`
      : `<div class="card-poster-placeholder">
           <i data-lucide="film"></i>
           <span>${type === 'tv' ? 'TV' : 'Film'}</span>
         </div>`}
    <div class="card-overlay">
      <div class="card-play">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
    </div>
    <div class="card-info">
      <div class="card-title">${title}</div>
      <div class="card-meta">
        ${rating ? `<span class="card-rating"><i data-lucide="star" style="width:10px;height:10px;fill:currentColor;"></i>${rating}</span>` : ''}
        ${year ? `<span>${year}</span>` : ''}
        <span>${type === 'tv' ? 'TV' : 'Movie'}</span>
      </div>
    </div>`;

  card.addEventListener('click', () => openDetail(item));
  return card;
}

// ─── Row Renderer ─────────────────────────────
function renderRow(rowId, items) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.innerHTML = '';
  items.forEach(item => row.appendChild(buildCard(item)));
  lucide.createIcons({ nodes: [row] });
}

// ─── Hero ─────────────────────────────────────
async function loadHero() {
  try {
    let featured;
    
    // Check if you set a custom Hero Movie/TV Override in config.json
    if (siteConfig && siteConfig.heroOverride && String(siteConfig.heroOverride).trim() !== '') {
      const type = siteConfig.heroType === 'tv' ? 'tv' : 'movie';
      featured = await tmdb(`/${type}/${siteConfig.heroOverride}`);
      if (featured) featured.media_type = type; 
    } else {
      // Fallback to daily trending
      const data = await tmdb('/trending/movie/day');
      const movies = data.results || [];
      featured = movies[Math.floor(Math.random() * Math.min(5, movies.length))];
      if (featured) featured.media_type = 'movie';
    }

    if (!featured) return;

    const backdrop = document.getElementById('heroBackdrop');
    const logo     = document.getElementById('heroLogo');
    const title    = document.getElementById('heroTitle');
    const meta     = document.getElementById('heroMeta');
    const overview = document.getElementById('heroOverview');

    if (backdrop && featured.backdrop_path) {
      backdrop.style.backgroundImage = `url(${IMG_ORI}${featured.backdrop_path})`;
    }
    
    if (title) title.textContent = featured.title || featured.name;
    if (overview) overview.textContent = featured.overview;

    try {
      // Fetch logos using dynamic media_type
      const images = await tmdb(`/${featured.media_type}/${featured.id}/images`);
      const logos = images.logos || [];
      const enLogo = logos.find(l => l.iso_639_1 === 'en') || logos[0];
      
      if (enLogo && logo) {
        logo.src = `${IMG_W500}${enLogo.file_path}`;
        logo.style.display = 'block';
        if (title) title.style.display = 'none';
      } else {
        if (logo) logo.style.display = 'none';
        if (title) title.style.display = 'block';
      }
    } catch (err) {
      if (logo) logo.style.display = 'none';
      if (title) title.style.display = 'block';
    }

    if (meta) {
      // TV shows use first_air_date instead of release_date
      const year   = (featured.release_date || featured.first_air_date || '').slice(0, 4);
      const rating = featured.vote_average ? featured.vote_average.toFixed(1) : '';
      const displayType = featured.media_type === 'tv' ? 'TV Show' : 'Movie';
      
      meta.innerHTML = `
        ${rating ? `<span class="rating"><i data-lucide="star" style="fill:currentColor;width:13px;height:13px;"></i>${rating}</span><div class="hero-dot"></div>` : ''}
        ${year ? `<span>${year}</span><div class="hero-dot"></div>` : ''}
        <span>${displayType}</span>`;
    }

    const playBtn = document.getElementById('heroPlayBtn');
    const infoBtn = document.getElementById('heroInfoBtn');
    
    // Pass the featured object directly since it now has the correct media_type
    if (playBtn) playBtn.onclick = () => openPlayer(featured);
    if (infoBtn) infoBtn.onclick = () => openDetail(featured);

    lucide.createIcons({ nodes: [meta, playBtn, infoBtn].filter(Boolean) });
  } catch (e) { console.error('Hero load failed', e); }
}


// ─── Fetch Rows ────────────────────────────────
async function loadRows() {
  const rows = [
    { id: 'row-trending-all',    fn: () => tmdb('/trending/all/day') },
    { id: 'row-trending-movies', fn: () => tmdb('/trending/movie/week') },
    { id: 'row-popular-tv',      fn: () => tmdb('/tv/popular') },
    { id: 'row-top-rated',       fn: () => tmdb('/movie/top_rated') },
    { id: 'row-anime',           fn: () => tmdb('/discover/tv', { with_genres: '16', with_keywords: '210024', sort_by: 'popularity.desc' }) },
    { id: 'row-now-playing',     fn: () => tmdb('/movie/now_playing') },
  ];

  const typeMap = {
    'row-trending-all':    'auto',
    'row-trending-movies': 'movie',
    'row-popular-tv':      'tv',
    'row-top-rated':       'movie',
    'row-anime':           'tv',
    'row-now-playing':     'movie',
  };

  for (const { id, fn } of rows) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.innerHTML = Array(8).fill(0).map(() =>
      `<div class="card"><div class="skeleton" style="aspect-ratio:2/3;border-radius:10px;width:150px;"></div></div>`
    ).join('');

    try {
      const data = await fn();
      const items = (data.results || []).slice(0, 20).map(i => ({
        ...i,
        media_type: i.media_type || typeMap[id] || 'movie'
      }));
      renderRow(id, items);
    } catch(e) {
      el.innerHTML = `<div class="empty-state"><i data-lucide="wifi-off"></i><p>Failed to load</p></div>`;
      lucide.createIcons({ nodes: [el] });
    }
  }
}

// ─── Genre Filter ─────────────────────────────
function initGenreFilter() {
  const bar = document.getElementById('genreBar');
  if (!bar) return;
  bar.querySelectorAll('.genre-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      bar.querySelectorAll('.genre-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const genre = btn.dataset.genre;
      if (genre === 'all') { loadRows(); return; }

      const moviesRow = document.getElementById('row-trending-movies');
      const tvRow     = document.getElementById('row-popular-tv');
      if (!moviesRow || !tvRow) return;

      moviesRow.innerHTML = Array(8).fill(0).map(() =>
        `<div class="card"><div class="skeleton" style="aspect-ratio:2/3;border-radius:10px;width:150px;"></div></div>`).join('');
      tvRow.innerHTML = moviesRow.innerHTML;

      const [movies, tv] = await Promise.all([
        tmdb('/discover/movie', { with_genres: genre, sort_by: 'popularity.desc' }),
        tmdb('/discover/tv',    { with_genres: genre, sort_by: 'popularity.desc' }),
      ]);
      renderRow('row-trending-movies', (movies.results || []).map(i => ({ ...i, media_type: 'movie' })));
      renderRow('row-popular-tv',      (tv.results    || []).map(i => ({ ...i, media_type: 'tv'    })));
    });
  });
}

// ─── Trending Section ─────────────────────────
async function loadTrending(period = 'day') {
  const row = document.getElementById('row-trending-all');
  if (!row) return;
  
  // Show loading skeletons
  row.innerHTML = Array(8).fill(0).map(() =>
    `<div class="card"><div class="skeleton" style="aspect-ratio:2/3;border-radius:10px;width:150px;"></div></div>`
  ).join('');

  try {
    const data = await tmdb(`/trending/all/${period}`);
    const items = (data.results || []).slice(0, 20).map(i => ({
      ...i,
      media_type: i.media_type || 'movie'
    }));
    renderRow('row-trending-all', items);
  } catch(e) {
    row.innerHTML = `<div class="empty-state"><i data-lucide="wifi-off"></i><p>Failed to load</p></div>`;
    lucide.createIcons({ nodes: [row] });
  }
}

function initTrending() {
  // Initialize icons in trending section header
  const trendingSection = document.getElementById('trendingSection');
  if (trendingSection) {
    lucide.createIcons({ nodes: [trendingSection] });
  }

  // Tab switching
  const tabs = document.querySelectorAll('.trending-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const period = tab.dataset.period;
      loadTrending(period);
    });
  });

  // Navbar trending button - scroll to section or navigate to index
  const navTrendingBtn = document.getElementById('navTrendingBtn');
  if (navTrendingBtn) {
    navTrendingBtn.addEventListener('click', () => {
      const section = document.getElementById('trendingSection');
      if (section) {
        // Section exists on this page, scroll to it
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // Section doesn't exist, navigate to index.html
        window.location.href = 'index.html#trendingSection';
      }
    });
  }

  // Hamburger trending link - scroll to section and close menu
  const hamburgerTrendingLink = document.getElementById('hamburgerTrendingLink');
  if (hamburgerTrendingLink) {
    hamburgerTrendingLink.addEventListener('click', (e) => {
      e.preventDefault();
      const hamburgerMenu = document.getElementById('hamburgerMenu');
      const hamburgerOverlay = document.getElementById('hamburgerOverlay');
      
      hamburgerMenu?.classList.remove('open');
      hamburgerOverlay?.classList.remove('open');
      document.body.style.overflow = '';
      
      setTimeout(() => {
        const section = document.getElementById('trendingSection');
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 300);
    });
  }
}

// ─── Search ───────────────────────────────────
function initSearch() {
  const openBtn   = document.getElementById('searchOpenBtn');
  const closeBtn  = document.getElementById('searchCloseBtn');
  const overlay   = document.getElementById('searchOverlay');
  const input     = document.getElementById('searchInput');
  const results   = document.getElementById('searchResults');
  const filters   = document.getElementById('searchFilters');

  if (!openBtn || !overlay) return;

  openBtn.onclick  = () => { overlay.classList.add('open'); setTimeout(() => input?.focus(), 100); };
  closeBtn.onclick = () => { overlay.classList.remove('open'); if (input) input.value = ''; if (results) results.innerHTML = ''; };

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeBtn.onclick();
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openBtn.onclick(); }
  });

  filters?.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      filters.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      searchType = chip.dataset.type;
      if (input?.value.trim()) doSearch(input.value.trim());
    });
  });

  input?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(() => doSearch(q), 380);
  });
}

async function doSearch(query) {
  const results = document.getElementById('searchResults');
  if (!results) return;
  results.innerHTML = Array(6).fill(0).map(() =>
    `<div class="card"><div class="skeleton" style="aspect-ratio:2/3;border-radius:10px;width:130px;"></div></div>`).join('');

  try {
    const data = await tmdb(`/search/${searchType}`, { query, include_adult: false });
    const items = (data.results || []).slice(0, 12).map(i => ({
      ...i,
      media_type: i.media_type || (searchType === 'movie' ? 'movie' : searchType === 'tv' ? 'tv' : i.media_type || 'movie')
    }));

    results.innerHTML = '';
    if (!items.length) {
      results.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:40px 0;"><i data-lucide="search-x"></i><p>No results for "${query}"</p></div>`;
      lucide.createIcons({ nodes: [results] });
      return;
    }

    items.forEach(item => {
      const card = buildCard(item);
      card.style.width = '130px';
      card.addEventListener('click', () => {
        document.getElementById('searchOverlay')?.classList.remove('open');
        openDetail(item);
      });
      results.appendChild(card);
    });
    lucide.createIcons({ nodes: [results] });
  } catch(e) {
    results.innerHTML = `<p style="color:var(--text-muted);font-size:0.78rem;padding:12px;">Search failed. Try again.</p>`;
  }
}

// ─── Detail Modal ─────────────────────────────
async function openDetail(item) {
  currentItem = item;
  await detectAnime(currentItem);
  const overlay    = document.getElementById('detailOverlay');
  const backdrop   = document.getElementById('detailBackdrop');
  const poster     = document.getElementById('detailPoster');
  const titleEl    = document.getElementById('detailTitle');
  const metaEl     = document.getElementById('detailMeta');
  const overviewEl = document.getElementById('detailOverview');
  const actionsEl  = document.getElementById('detailActions');

  if (!overlay) return;

  const title   = item.title || item.name || 'Unknown';
  const year    = (item.release_date || item.first_air_date || '').slice(0, 4);
  const rating  = item.vote_average ? item.vote_average.toFixed(1) : '';
  const type    = item.media_type || 'movie';

  if (backdrop)   backdrop.src = item.backdrop_path ? `${IMG_ORI}${item.backdrop_path}` : '';
  if (poster)     poster.src   = item.poster_path   ? `${IMG_W500}${item.poster_path}`  : '';
  if (titleEl)    titleEl.textContent = title;
  if (overviewEl) overviewEl.textContent = item.overview || 'No description available.';

  if (metaEl) {
    metaEl.innerHTML = `
      ${rating ? `<span class="badge"><i data-lucide="star" style="fill:currentColor;width:11px;height:11px;display:inline;"></i> ${rating}</span>` : ''}
      ${year   ? `<span>${year}</span>` : ''}
      <span class="badge">${type === 'tv' ? 'TV Show' : 'Movie'}</span>`;
  }

  const inWl = inWatchlist(item.id);
  if (actionsEl) {
    actionsEl.innerHTML = `
      <button class="btn-primary" id="detailPlayBtn" style="font-size:0.78rem;">
        <i data-lucide="play"></i> Watch Now
      </button>
      <button class="btn-icon ${inWl ? 'active' : ''}" id="detailWlBtn">
        <i data-lucide="${inWl ? 'bookmark-check' : 'bookmark'}"></i>
        ${inWl ? 'Saved' : 'Watchlist'}
      </button>`;
  }

  overlay.classList.add('open');
  lucide.createIcons({ nodes: [overlay] });

  document.getElementById('detailPlayBtn')?.addEventListener('click', () => {
    overlay.classList.remove('open');
    openPlayer(item);
  });
  document.getElementById('detailWlBtn')?.addEventListener('click', (e) => {
    const added = toggleWatchlist(item);
    showToast(added ? 'Added to Watchlist' : 'Removed from Watchlist', added ? 'bookmark-check' : 'bookmark');
    const btn = e.currentTarget;
    btn.innerHTML = `<i data-lucide="${added ? 'bookmark-check' : 'bookmark'}"></i> ${added ? 'Saved' : 'Watchlist'}`;
    btn.classList.toggle('active', added);
    lucide.createIcons({ nodes: [btn] });
  });
}

document.getElementById('detailCloseBtn')?.addEventListener('click', () => {
  document.getElementById('detailOverlay')?.classList.remove('open');
});
document.getElementById('detailOverlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('detailOverlay'))
    document.getElementById('detailOverlay').classList.remove('open');
});

// ─── Player & Routing ───────────────────────────────────
function updateUrl(item, season, ep) {
  const url = new URL(window.location);
  url.searchParams.set('play', item.id);
  url.searchParams.set('type', item.media_type);
  if (item.media_type === 'tv') {
    url.searchParams.set('s', season);
    url.searchParams.set('e', ep);
  }
  window.history.pushState({}, '', url);
}

function closePlayer() {
  const page = document.getElementById('playerPage');
  const iframe = document.getElementById('playerIframe');
  if (page) page.classList.remove('open');
  if (iframe) iframe.src = '';
  document.body.style.overflow = '';
  
  const url = new URL(window.location);
  url.searchParams.delete('play');
  url.searchParams.delete('type');
  url.searchParams.delete('s');
  url.searchParams.delete('e');
  window.history.pushState({}, '', url);
}

async function openPlayer(item, season = 1, ep = 1, skipHistoryUpdate = false) {
  currentItem = item;
  currentSeason = season;
  currentEp = ep;
  
 // Use default server from Panel, fallback to local settings, fallback to vidking
  const settings = getSettings();
  const defaultId =
  (siteConfig && siteConfig.defaultServer) ||
  settings.defaultServer ||
  'videasy';

   currentSource = SOURCES.find(s => s.id === defaultId) || SOURCES[0];

  const page = document.getElementById('playerPage');
  const iframe = document.getElementById('playerIframe');
  const episodesSection = document.getElementById('episodesSection');

  if (!page || !iframe) return;

  if (!skipHistoryUpdate) updateUrl(item, season, ep);

  // Scroll player page to the top
  page.scrollTo(0, 0);

  const title = item.title || item.name || 'Unknown';
  document.getElementById('playerInfoTitle').textContent = title;
  document.getElementById('playerInfoDesc').textContent = item.overview || 'No description available.';
  
  const meta = document.getElementById('playerInfoMeta');
  if (item.media_type === 'tv') {
    meta.innerHTML = `<span style="color:var(--accent);">TV Show</span> &bull; Season ${season} &bull; Episode ${ep}`;
  } else {
    meta.innerHTML = `<span style="color:var(--accent);">Movie</span> &bull; ${(item.release_date || '').slice(0, 4)}`;
  }

  // Fetch show logo
  fetch(`${TMDB_BASE}/${item.media_type}/${item.id}/images?api_key=${TMDB_KEY}`)
    .then(res => res.json())
    .then(data => {
      const logos = data.logos || [];
      const enLogo = logos.find(l => l.iso_639_1 === 'en') || logos[0];
      const logoImg = document.getElementById('playerInfoLogo');
      if (enLogo && logoImg) {
        logoImg.src = `${IMG_W500}${enLogo.file_path}`;
        logoImg.style.display = 'block';
        document.getElementById('playerInfoTitle').style.display = 'none';
      } else {
        if(logoImg) logoImg.style.display = 'none';
        document.getElementById('playerInfoTitle').style.display = 'block';
      }
    }).catch(() => {
        document.getElementById('playerInfoTitle').style.display = 'block';
    });

  // Dispatch event to update the source dropdown UI
  window.dispatchEvent(new CustomEvent('playerSourceChanged', { detail: currentSource }));
  document.querySelectorAll('[data-server]').forEach(btn => {
  btn.classList.remove('active');
});

const activeBtn = document.querySelector(`[data-server="${currentSource}"]`);
if (activeBtn) activeBtn.classList.add('active');

  // Set iframe source
  iframe.src = buildEmbedUrl(item, currentSource, season, ep);

  // Show/Hide Episodes Grid based on media type
  if (item.media_type === 'tv') {
    episodesSection.style.display = 'flex';
    await loadEpisodeBar(item, season, ep);
  } else {
    episodesSection.style.display = 'none';
  }

  addToHistory({ ...item, watchedAt: Date.now() });
  page.classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function loadEpisodeBar(item, activeSeason, activeEp) {
  const seasonSel = document.getElementById('seasonSelect');
  const epBtnsDiv = document.getElementById('episodeBtns');
  if (!seasonSel || !epBtnsDiv) return;

  const details = await tmdb(`/tv/${item.id}`);
  const totalSeasons = details.number_of_seasons || 1;

  seasonSel.innerHTML = '';
  for (let s = 1; s <= totalSeasons; s++) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = `Season ${s}`;
    if (s === parseInt(activeSeason)) opt.selected = true;
    seasonSel.appendChild(opt);
  }

  async function renderEps(season) {
    const seasonData = await tmdb(`/tv/${item.id}/season/${season}`);
    const episodes = seasonData.episodes || [];
    epBtnsDiv.innerHTML = '';
    
    episodes.forEach(ep => {
      // Current playing : fix
const isAct = ep.episode_number === parseInt(currentEp) && parseInt(season) === parseInt(currentSeason);
      const imgPath = ep.still_path ? `${IMG_W500}${ep.still_path}` : '';
      
      const card = document.createElement('div');
      card.className = `ep-card ${isAct ? 'active' : ''}`;
      if (isAct) { setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100); }

      card.innerHTML = `
        ${imgPath ? `<img class="ep-card-img" src="${imgPath}" loading="lazy">` : `<div class="ep-card-img"></div>`}
        <div class="ep-card-info">
          <div class="ep-card-title">${isAct ? '<span style="color:var(--accent);">Playing:</span> ' : ''}${ep.episode_number}. ${ep.name}</div>
          <div class="ep-card-desc">${ep.overview || ''}</div>
        </div>
      `;
      
      card.addEventListener('click', () => {
        epBtnsDiv.querySelectorAll('.ep-card').forEach(b => b.classList.remove('active'));
        card.classList.add('active');
        currentEp = ep.episode_number;
        
        document.getElementById('playerIframe').src = buildEmbedUrl(item, currentSource, parseInt(seasonSel.value), ep.episode_number);
        document.getElementById('playerInfoMeta').innerHTML = `<span style="color:var(--accent);">TV Show</span> &bull; Season ${seasonSel.value} &bull; Episode ${ep.episode_number}`;
        
        document.getElementById('playerPage').scrollTo({ top: 0, behavior: 'smooth' });
        
        renderEps(seasonSel.value);
        updateUrl(item, seasonSel.value, ep.episode_number);
      });
      epBtnsDiv.appendChild(card);
    });
  }

  await renderEps(activeSeason);

  seasonSel.addEventListener('change', async () => {
    currentSeason = parseInt(seasonSel.value);
    currentEp = 1;
    await renderEps(currentSeason);
    document.getElementById('playerIframe').src = buildEmbedUrl(item, currentSource, currentSeason, 1);
    document.getElementById('playerPage').scrollTo({ top: 0, behavior: 'smooth' });
    updateUrl(item, currentSeason, 1);
  });
}

// ─── Source switching (called from Radix dropdown) ──────────────────────────
window.setPlayerSource = function(src) {
  currentSource = src;
  const iframe = document.getElementById('playerIframe');
  if (iframe && currentItem) {
    iframe.src = buildEmbedUrl(currentItem, currentSource, currentSeason, currentEp);
  }
};

// Anime sub/dub switching
document.querySelectorAll('.anime-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.anime-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    animeType = btn.dataset.type;
    
    // Reload iframe with the new sub/dub preference
    const iframe = document.getElementById('playerIframe');
    if (iframe && currentItem) {
      iframe.src = buildEmbedUrl(currentItem, currentSource, currentSeason, currentEp);
    }
  });
});

document.getElementById('playerBackBtn')?.addEventListener('click', closePlayer);

// ─── Initial Load Router ───
function checkUrlOnLoad() {
  const params = new URLSearchParams(window.location.search);
  const playId = params.get('play');
  if (playId) {
    const type = params.get('type') || 'movie';
    const s = params.get('s') || 1;
    const e = params.get('e') || 1;
    
    tmdb(`/${type}/${playId}`).then(data => {
      data.media_type = type;
      openPlayer(data, s, e, true);
    }).catch(err => console.error("Router fetch failed", err));
  }
}

// ─── Click-to-Pause Overlay ────────────────────
(function initClickPause() {
  const overlay = document.getElementById('playerClickOverlay');
  if (!overlay) return;

  overlay.addEventListener('click', () => {
    const iframe = document.getElementById('playerIframe');
    if (!iframe) return;

    overlay.classList.remove('flash');
    void overlay.offsetWidth; 
    overlay.classList.add('flash');

    try { iframe.contentWindow?.postMessage(JSON.stringify({ event: 'toggle_play_pause' }), '*'); } catch (_) {}
    try {
      const video = iframe.contentDocument?.querySelector('video');
      if (video) { video.paused ? video.play() : video.pause(); }
    } catch (_) {}
  });
})();

// ─── Nav Scroll Effect ────────────────────────
window.addEventListener('scroll', () => {
  const nav = document.getElementById('mainNav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

// ─── Hamburger Menu ────────────────────────
function initHamburgerMenu() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const hamburgerCloseBtn = document.getElementById('hamburgerCloseBtn');
  const hamburgerMenu = document.getElementById('hamburgerMenu');
  const hamburgerOverlay = document.getElementById('hamburgerOverlay');
  
  function openMenu() {
    hamburgerMenu?.classList.add('open');
    hamburgerOverlay?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  
  function closeMenu() {
    hamburgerMenu?.classList.remove('open');
    hamburgerOverlay?.classList.remove('open');
    document.body.style.overflow = '';
  }
  
  hamburgerBtn?.addEventListener('click', openMenu);
  hamburgerCloseBtn?.addEventListener('click', closeMenu);
  hamburgerOverlay?.addEventListener('click', closeMenu);
  
  // Handle genre links in hamburger menu
  document.querySelectorAll('.genre-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const genre = link.dataset.genre;
      closeMenu();
      
      // Trigger genre filter on home page
      if (window.location.pathname.includes('index.html') || window.location.pathname === '/') {
        const genrePill = document.querySelector(`.genre-pill[data-genre="${genre}"]`);
        if (genrePill) {
          genrePill.click();
          setTimeout(() => {
            window.scrollTo({ top: document.querySelector('.genre-bar')?.offsetTop - 80, behavior: 'smooth' });
          }, 100);
        }
      } else {
        window.location.href = `index.html#genre-${genre}`;
      }
    });
  });
}

// ─── Settings Management ───────────────────────
function getSettings() {
  const defaults = {
    theme: 'dark',
    accent: 'cream',
    defaultServer: 'videasy',
    autoplay: true,
    skipButtons: true
  };
  return JSON.parse(localStorage.getItem('vault_settings') || JSON.stringify(defaults));
}

function applyAccent(accent) {
  const accentColors = {
    cream: { main: '#F0ECE4', dim: '#C4BAAA' },
    blue: { main: '#5B9BFF', dim: '#4080DD' },
    purple: { main: '#B894FF', dim: '#9A7ADD' },
    red: { main: '#FF6B6B', dim: '#DD5555' },
    green: { main: '#51CF66', dim: '#3DB54A' }
  };
  
  const colors = accentColors[accent] || accentColors.cream;
  document.documentElement.style.setProperty('--accent', colors.main);
  document.documentElement.style.setProperty('--accent-dim', colors.dim);
}

function applyTheme(theme) {
  // Theme implementation (placeholder for now)
  document.body.setAttribute('data-theme', theme);
}

function loadAndApplySettings() {
  const settings = getSettings();
  applyTheme(settings.theme);
  applyAccent(settings.accent);
}

// ─── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Grab the config directly from the window (loaded via config.js)
  siteConfig = window.siteConfig || null;

  if (siteConfig) {
    // Handle Maintenance Mode instantly
    if (siteConfig.maintenance) {
      window.location.href = 'maintenance.html';
      return; // Stop loading the rest of the app
    }

    // Handle Custom Notification (Developer Mode - Shows on every refresh)
    if (siteConfig.notification && siteConfig.notification.active) {
      setTimeout(() => {
        showNotifyAwesome(
          siteConfig.notification.title, 
          siteConfig.notification.message, 
          siteConfig.notification.icon || 'bell', 
          siteConfig.notification.duration || 5000
        );
      }, 1500); // 1.5s delay so it slides in naturally after the page loads
    }
  } else {
    console.log('No config found, proceeding normally.'); 
  }

  // Load the site if maintenance is false
  lucide.createIcons();
  initSearch();
  initHamburgerMenu();
  initTrending(); 
  loadAndApplySettings(); 

  if (document.getElementById('heroSection')) {
    await loadHero(); 
    loadRows();
    initGenreFilter();
    
    if (window.location.hash === '#trendingSection') {
      setTimeout(() => {
        const section = document.getElementById('trendingSection');
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 500); 
    }
  }
  
  checkUrlOnLoad();
});