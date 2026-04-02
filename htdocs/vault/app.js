'use strict';

const TMDB_KEY = '4e44d9029b1270a757cddc766a1bcb63';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_W500 = 'https://image.tmdb.org/t/p/w500';
const IMG_ORI = 'https://image.tmdb.org/t/p/original';

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
  // Anime detection is now disabled. Always use default playback behavior.
  animeMode = false;
  malId = null;
  document.getElementById('animeControls')?.classList.add('hidden');
}

let currentItem = null;
let currentSource = 'videasy';
let currentSeason = 1;
let currentEp = 1;
let searchTimer = null;
let searchType = 'multi';
let animeMode = false;
let malId = null;
let siteConfig = null;
let allLoadedItems = [];
let focusedCardRow = null;
let continueProgressInterval = null;
let gamepadPollInterval = null;
let resumeBaseSeconds = 0;
let sessionPlaybackSeconds = 0;

const VAULT_EXPORT_VERSION = 1;

// Migrate old localStorage keys to new keys if present
function migrateStorageKeys() {
  try {
    const mappings = [
      ['vault_watchlist', 'watchlist'],
      ['vault_history', 'history'],
      ['vault_continue', 'continueWatching'],
      ['vault_continue_watching', 'continueWatching']
    ];

    mappings.forEach(([oldKey, newKey]) => {
      const oldVal = localStorage.getItem(oldKey);
      const newVal = localStorage.getItem(newKey);
      if (oldVal && !newVal) {
        localStorage.setItem(newKey, oldVal);
        try { localStorage.removeItem(oldKey); } catch (_) {}
      }
    });
  } catch (e) {
    // ignore storage errors
  }
}

migrateStorageKeys();

function getWatchlist() { return JSON.parse(localStorage.getItem('watchlist') || '[]'); }
function setWatchlist(l) { localStorage.setItem('watchlist', JSON.stringify(l)); }
function getHistory() { return JSON.parse(localStorage.getItem('history') || '[]'); }
function setHistory(l) { localStorage.setItem('history', JSON.stringify(l)); }

function getContinueWatching() { return JSON.parse(localStorage.getItem('continueWatching') || '[]'); }
function setContinueWatching(l) { localStorage.setItem('continueWatching', JSON.stringify(l)); }

function migrateWatchlistAddedAt() {
  try {
    const wl = getWatchlist();
    if (!wl.length) return;
    const now = Date.now();
    let changed = false;
    wl.forEach((it, i) => {
      if (it.addedAt == null) {
        it.addedAt = now - (wl.length - i) * 1000;
        changed = true;
      }
    });
    if (changed) setWatchlist(wl);
  } catch (_) {}
}

migrateWatchlistAddedAt();

function getCollections() {
  try {
    const raw = localStorage.getItem('vault_collections');
    const d = raw ? JSON.parse(raw) : { lists: [] };
    if (!d || !Array.isArray(d.lists)) return { lists: [] };
    return d;
  } catch (_) {
    return { lists: [] };
  }
}

function setCollections(data) {
  localStorage.setItem('vault_collections', JSON.stringify(data));
  try { window.dispatchEvent(new Event('vault:collectionsUpdated')); } catch (_) {}
}

function generateListId() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function createCollection(name) {
  const c = getCollections();
  const id = generateListId();
  const label = String(name || '').trim() || 'Untitled list';
  c.lists.push({ id, name: label, items: [], createdAt: Date.now(), updatedAt: Date.now() });
  setCollections(c);
  return id;
}

function deleteCollection(listId) {
  const c = getCollections();
  c.lists = c.lists.filter(l => l.id !== listId);
  setCollections(c);
}

function renameCollection(listId, newName) {
  const c = getCollections();
  const list = c.lists.find(l => l.id === listId);
  if (!list) return;
  list.name = String(newName || '').trim() || list.name;
  list.updatedAt = Date.now();
  setCollections(c);
}

function normalizeLibraryItem(item) {
  const mt = item.media_type || item.mediaType || (item.title ? 'movie' : 'tv');
  return {
    id: item.id,
    media_id: item.id,
    mediaId: item.id,
    media_type: mt,
    mediaType: mt,
    title: item.title || item.name || '',
    name: item.name || item.title || '',
    poster_path: item.poster_path || item.poster || '',
    vote_average: item.vote_average || 0,
    release_date: item.release_date || item.first_air_date || '',
    addedAt: item.addedAt != null ? item.addedAt : Date.now()
  };
}

function addItemToCollection(listId, item) {
  const c = getCollections();
  const list = c.lists.find(l => l.id === listId);
  if (!list) return false;
  const norm = normalizeLibraryItem(item);
  if (list.items.some(x => sameMediaId(x.id ?? x.mediaId, norm.id))) return false;
  list.items.push(norm);
  list.updatedAt = Date.now();
  setCollections(c);
  return true;
}

function removeItemFromCollection(listId, mediaId) {
  const c = getCollections();
  const list = c.lists.find(l => l.id === listId);
  if (!list) return;
  list.items = list.items.filter(x => !sameMediaId(x.id ?? x.mediaId, mediaId));
  list.updatedAt = Date.now();
  setCollections(c);
}

function exportVaultDataObject() {
  let vaultSettings = null;
  try {
    vaultSettings = localStorage.getItem('vault_settings');
  } catch (_) {}
  return {
    version: VAULT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    watchlist: getWatchlist(),
    history: getHistory(),
    continueWatching: getContinueWatching(),
    collections: getCollections(),
    vault_settings: vaultSettings
  };
}

function exportVaultDataJSON() {
  return JSON.stringify(exportVaultDataObject(), null, 2);
}

function importVaultDataJSON(text, mode) {
  const data = JSON.parse(text);
  if (data.version == null && !Array.isArray(data.watchlist) && !data.collections) {
    throw new Error('Unrecognized Vault export file.');
  }
  const mergeUniqueById = (a, b) => {
    const map = new Map();
    [...(a || []), ...(b || [])].forEach(it => {
      if (it == null || it.id == null) return;
      const k = `${it.media_type || it.mediaType || 'movie'}:${it.id}`;
      if (!map.has(k)) map.set(k, it);
    });
    return [...map.values()];
  };
  if (mode === 'replace') {
    if (Array.isArray(data.watchlist)) setWatchlist(data.watchlist);
    if (Array.isArray(data.history)) setHistory(data.history);
    if (Array.isArray(data.continueWatching)) setContinueWatching(data.continueWatching);
    if (data.collections && Array.isArray(data.collections.lists)) setCollections({ lists: data.collections.lists });
    if (typeof data.vault_settings === 'string') localStorage.setItem('vault_settings', data.vault_settings);
  } else {
    setWatchlist(mergeUniqueById(getWatchlist(), data.watchlist));
    const eh = getHistory();
    const nh = [...eh, ...(data.history || [])];
    nh.sort((x, y) => (y.watchedAt || 0) - (x.watchedAt || 0));
    setHistory(nh.slice(-250));
    const ec = getContinueWatching();
    const byId = new Map();
    [...ec, ...(data.continueWatching || [])].forEach(it => {
      if (it && it.id != null) {
        const cur = byId.get(String(it.id));
        if (!cur || (it.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(String(it.id), it);
      }
    });
    setContinueWatching([...byId.values()].slice(0, 24));
    if (data.collections && Array.isArray(data.collections.lists)) {
      const c = getCollections();
      const existingIds = new Set(c.lists.map(l => l.id));
      data.collections.lists.forEach(incoming => {
        if (!incoming || !incoming.name) return;
        if (existingIds.has(incoming.id)) {
          const target = c.lists.find(l => l.id === incoming.id);
          if (target) target.items = mergeUniqueById(target.items, incoming.items);
        } else {
          c.lists.push({
            id: incoming.id || generateListId(),
            name: incoming.name,
            items: incoming.items || [],
            createdAt: incoming.createdAt || Date.now(),
            updatedAt: Date.now()
          });
          existingIds.add(c.lists[c.lists.length - 1].id);
        }
      });
      setCollections(c);
    }
  }
  migrateWatchlistAddedAt();
  try { window.dispatchEvent(new Event('vault:dataUpdated')); } catch (_) {}
  try { window.dispatchEvent(new Event('vault:collectionsUpdated')); } catch (_) {}
}

function triggerVaultImportFile(file, mode) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        importVaultDataJSON(r.result, mode);
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsText(file, 'utf-8');
  });
}

function getResumeSeconds(item) {
  const direct = Number(item.lastPositionSeconds);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const p = Number(item.progress || 0);
  if (p > 0 && p < 100) {
    const dur = item.media_type === 'tv' ? 2700 : 5400;
    return Math.round((p / 100) * dur);
  }
  return 0;
}

function getContinueCardProgress(item) {
  const sec = getResumeSeconds(item);
  if (sec > 0) {
    const dur = item.media_type === 'tv' ? 2700 : 5400;
    return Math.min(99, Math.max(1, (sec / dur) * 100));
  }
  return Number(item.progress || 0);
}

function appendResumeTimeParam(url, item) {
  if (!item || item.media_type === 'tv') return url;
  const sec = getResumeSeconds(item);
  if (sec < 45) return url;
  const sep = url.includes('?') ? '&' : '?';
  try {
    return `${url}${sep}t=${sec}`;
  } catch (_) {
    return url;
  }
}

function sameMediaId(a, b) {
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a) === String(b);
}

function inWatchlist(id) {
  return getWatchlist().some(x => sameMediaId(x.id ?? x.mediaId, id));
}

async function addToWatchlist(item) {
  const wl = getWatchlist();
  if (!inWatchlist(item.id)) { 
    const watchlistItem = normalizeLibraryItem(item);
    watchlistItem.addedAt = Date.now();
    wl.push(watchlistItem); 
    setWatchlist(wl);
  }
}

async function removeFromWatchlist(id) { 
  const updated = getWatchlist().filter(x => !sameMediaId(x.id ?? x.mediaId, id));
  setWatchlist(updated);
}

async function toggleWatchlist(item) {
  if (inWatchlist(item.id)) {
    await removeFromWatchlist(item.id);
    return false;
  }
  await addToWatchlist(item);
  return true;
}

function addToHistory(item) {
  let hist = getHistory().filter(x => !sameMediaId(x.id, item.id));
  const historyItem = { 
    ...item, 
    watchedAt: Date.now(),
    mediaId: item.id,
    mediaType: item.media_type || (item.title ? 'movie' : 'tv')
  };
  hist.push(historyItem);
  if (hist.length > 200) hist = hist.slice(-200);
  setHistory(hist);
}

function addToContinueWatching(item, season = 1, episode = 1) {
  const prev = getContinueWatching();
  const existing = prev.find(x => sameMediaId(x.id, item.id));
  const cont = prev.filter(x => !sameMediaId(x.id, item.id));
  const progress = existing?.progress != null ? existing.progress : (item.progress || 6);
  const lastSec = existing?.lastPositionSeconds;
  const clean = { ...item };
  delete clean.resume;
  cont.unshift({
    ...clean,
    media_type: clean.media_type || existing?.media_type || 'movie',
    updatedAt: Date.now(),
    progress: Math.max(1, Math.min(99, progress)),
    cwSeason: season,
    cwEpisode: episode,
    lastPositionSeconds: lastSec,
    attemptedSeason: season,
    attemptedEp: episode
  });
  if (cont.length > 12) cont.splice(12);
  setContinueWatching(cont);
}

function updateContinueProgress(itemId, addPercent = 4) {
  const cont = getContinueWatching().map(item => {
    if (!sameMediaId(item.id, itemId)) return item;
    const updated = Math.max(1, Math.min(99, (item.progress || 0) + addPercent));
    const dur = item.media_type === 'tv' ? 2700 : 5400;
    const sec = Math.round((updated / 100) * dur);
    return {
      ...item,
      progress: updated,
      lastPositionSeconds: sec,
      cwSeason: currentSeason,
      cwEpisode: currentEp,
      updatedAt: Date.now()
    };
  });
  setContinueWatching(cont);
}

function touchContinueEpisode(itemId, season, episode) {
  const list = getContinueWatching().map(x =>
    sameMediaId(x.id, itemId)
      ? { ...x, cwSeason: season, cwEpisode: episode, updatedAt: Date.now() }
      : x
  );
  setContinueWatching(list);
}

function renderApiError(row, error) {
  if (!row) return;
  let msg = 'Failed to load content';
  let icon = 'wifi-off';

  if (error && error.status === 429) {
    msg = 'Rate limit reached, please try again later.';
    icon = 'clock';
  } else if (error && error.status === 0) {
    msg = 'No internet connection, check your network.';
    icon = 'wifi-off';
  } else if (error && error.message) {
    msg = error.message;
  }

  row.innerHTML = `<div class="empty-state"><i data-lucide="${icon}"></i><p>${msg}</p></div>`;
  lucide.createIcons({ nodes: [row] });
}

function removeContinueWatching() {
  setContinueWatching([]);
}

function getMostWatchedGenres() {
  const hist = getHistory();
  const genreCount = {};
  hist.forEach(i => {
    (i.genre_ids || []).forEach(g => { genreCount[g] = (genreCount[g] || 0) + 1; });
  });
  return Object.entries(genreCount).sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 3);
}

function showToast(msg, icon = 'check-circle') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<i data-lucide="${icon}"></i> ${msg}`;
  container.appendChild(t);
  lucide.createIcons({ nodes: [t] });
  setTimeout(() => {
    t.style.opacity = '0'; t.style.transform = 'translateX(20px)';
    t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300);
  }, 2800);
}

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

async function tmdb(path, params = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', TMDB_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const cacheKey = `vault_tmdb:${url.toString()}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.ts < 1000 * 60 * 10) { // 10 min
      return cached.data;
    }
  } catch (err) {
    // ignore parse errors
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const err = new Error(`TMDB request failed ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) {}
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'TypeError') {
      const netErr = new Error('Network error or offline');
      netErr.status = 0;
      throw netErr;
    }
    throw err;
  }
}

const SOURCES = [
  {
    id: 'videasy',
    movie: (id) => `https://player.videasy.net/movie/${id}`,
    tv: (id, s, e) => `https://player.videasy.net/tv/${id}/${s}/${e}`
  },
  {
    id: 'vidlink',
    movie: (id) => `https://vidlink.pro/movie/${id}`,
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`
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


function buildCard(item, options = {}) {
  const title = item.title || item.name || 'Unknown';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
  const poster = item.poster_path ? `${IMG_W500}${item.poster_path}` : '';
  const type = item.media_type || 'movie';

  const progressPercent = options.continueRow
    ? Math.max(0, Math.min(100, getContinueCardProgress(item)))
    : Math.max(0, Math.min(100, Number(item.progress || 0)));
  const hasProgress = progressPercent > 0 && progressPercent < 100;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    ${poster
      ? `<img class="card-poster" src="${poster}" alt="${title}" loading="lazy">`
      : `<div class="card-poster-placeholder">
           <i data-lucide="film"></i>
           <span>${type === 'tv' ? 'TV' : 'Film'}</span>
         </div>`}
    ${hasProgress ? '<div class="continue-label">Continue</div>' : ''}
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
      ${hasProgress ? `<div class="progress-container"><div class="progress-bar" style="width:${progressPercent}%;"></div></div>` : ''}
    </div>`;

  card.addEventListener('click', () => openDetail(item));
  return card;
}


function renderRow(rowId, items) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.innerHTML = '';
  items.forEach(item => row.appendChild(buildCard(item)));
  lucide.createIcons({ nodes: [row] });
}


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
    const logo = document.getElementById('heroLogo');
    const title = document.getElementById('heroTitle');
    const meta = document.getElementById('heroMeta');
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
      const year = (featured.release_date || featured.first_air_date || '').slice(0, 4);
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



async function loadRows() {
  const rows = [
    { id: 'row-trending-all', fn: () => tmdb('/trending/all/day') },
    { id: 'row-trending-movies', fn: () => tmdb('/trending/movie/week') },
    { id: 'row-popular-tv', fn: () => tmdb('/tv/popular') },
    { id: 'row-top-rated', fn: () => tmdb('/movie/top_rated') },
    { id: 'row-anime', fn: () => tmdb('/discover/tv', { with_genres: '16', with_keywords: '210024', sort_by: 'popularity.desc' }) },
    { id: 'row-now-playing', fn: () => tmdb('/movie/now_playing') },
  ];

  const typeMap = {
    'row-trending-all': 'auto',
    'row-trending-movies': 'movie',
    'row-popular-tv': 'tv',
    'row-top-rated': 'movie',
    'row-anime': 'tv',
    'row-now-playing': 'movie',
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
      allLoadedItems = allLoadedItems.concat(items);
    } catch (e) {
      renderApiError(el, e);
    }
  }
}

async function loadContinueWatching() {
  const row = document.getElementById('row-continue-watching');
  const section = row?.closest('section');
  if (!row) return;
  const items = getContinueWatching();

  if (!items.length) {
    if (section) section.style.display = 'none';
    row.innerHTML = '';
    return;
  }

  if (section) section.style.display = 'block';
  renderRow('row-continue-watching', items, { continueRow: true });
}
async function loadRecommended() {
  const row = document.getElementById('row-recommended');
  if (!row) return;
  row.innerHTML = Array(8).fill(0).map(() =>
    `<div class="card"><div class="skeleton" style="aspect-ratio:2/3;border-radius:10px;width:150px;"></div></div>`
  ).join('');

  const topGenres = getMostWatchedGenres();
  try {
    let data;
    if (topGenres.length) {
      data = await tmdb('/discover/movie', { with_genres: topGenres.join(','), sort_by: 'popularity.desc' });
    } else {
      data = await tmdb('/trending/movie/day');
    }
    const items = (data.results || []).slice(0, 20).map(i => ({ ...i, media_type: i.media_type || 'movie' }));
    renderRow('row-recommended', items);
    allLoadedItems = allLoadedItems.concat(items);
  } catch (e) {
    renderApiError(row, e);
  }
}

function attachRowControls() {
  document.querySelectorAll('.row-wrapper').forEach(wrapper => {
    if (wrapper.querySelector('.row-arrow.left')) return;

    const left = document.createElement('button');
    left.className = 'row-arrow left';
    left.innerHTML = '<i data-lucide="chevron-left"></i>';
    const right = document.createElement('button');
    right.className = 'row-arrow right';
    right.innerHTML = '<i data-lucide="chevron-right"></i>';

    left.addEventListener('click', () => {
      const row = wrapper.querySelector('.card-row');
      row?.scrollBy({ left: -320, behavior: 'smooth' });
    });
    right.addEventListener('click', () => {
      const row = wrapper.querySelector('.card-row');
      row?.scrollBy({ left: 320, behavior: 'smooth' });
    });

    wrapper.appendChild(left);
    wrapper.appendChild(right);
  });
  lucide.createIcons({ nodes: document.querySelectorAll('.row-arrow i') });
}

function initKeyboardNav() {
  const getRow = () => focusedCardRow || document.querySelector('.card-row.focused') || document.querySelector('.card-row:hover');

  document.addEventListener('keydown', e => {
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea') return;

    if (e.key === 'Escape') {
      document.getElementById('detailOverlay')?.classList.remove('open');
      closePlayer();
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const row = getRow();
      if (!row) return;
      const delta = e.key === 'ArrowRight' ? 280 : -280;
      row.scrollBy({ left: delta, behavior: 'smooth' });
      e.preventDefault();
    }

    if (e.key === 'Tab' && document.activeElement?.classList.contains('card-row')) {
      focusedCardRow = document.activeElement;
    }
  });

  document.querySelectorAll('.card-row').forEach(row => {
    row.tabIndex = 0;
    row.addEventListener('focus', () => { row.classList.add('focused'); focusedCardRow = row; });
    row.addEventListener('blur', () => { row.classList.remove('focused'); focusedCardRow = null; });
    row.addEventListener('touchstart', () => { focusedCardRow = row; });
  });

  window.addEventListener('gamepadconnected', () => {
    if (gamepadPollInterval) clearInterval(gamepadPollInterval);
    gamepadPollInterval = setInterval(() => {
      const gp = navigator.getGamepads()[0];
      if (!gp) return;
      const horizon = gp.axes[0];
      const row = getRow();
      if (!row || Math.abs(horizon) < 0.2) return;
      row.scrollBy({ left: horizon * 24, behavior: 'smooth' });
    }, 100);
  });

  window.addEventListener('gamepaddisconnected', () => {
    if (gamepadPollInterval) {
      clearInterval(gamepadPollInterval);
      gamepadPollInterval = null;
    }
  });
}

function initGenreFilter() {
  const dropdownBtn = document.getElementById('genreDropdownBtn');
  const dropdownMenu = document.getElementById('genreDropdownMenu');
  const dropdownLabel = document.getElementById('genreDropdownLabel');
  const dropdownItems = document.querySelectorAll('.genre-dropdown-item');

  if (!dropdownBtn || !dropdownMenu) return;

  const genreNames = {
    'all': 'All Genres',
    '28': 'Action',
    '35': 'Comedy',
    '18': 'Drama',
    '27': 'Horror',
    '878': 'Sci-Fi',
    '53': 'Thriller',
    '16': 'Animation',
    '10759': 'Adventure',
    '10749': 'Romance',
    '99': 'Documentary'
  };

  // Toggle dropdown
  dropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdownMenu.style.display === 'block';
    dropdownMenu.style.display = isOpen ? 'none' : 'block';
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdownBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
      dropdownMenu.style.display = 'none';
    }
  });

  // Handle genre selection
  dropdownItems.forEach(item => {
    item.addEventListener('click', async () => {
      const genre = item.dataset.genre;
      
      // Update dropdown UI
      dropdownItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      dropdownLabel.textContent = genreNames[genre];
      dropdownMenu.style.display = 'none';

      // Update genre badges
      const moviesGenreBadge = document.getElementById('trendingMoviesGenreBadge');
      const tvGenreBadge = document.getElementById('popularTVGenreBadge');
      
      if (moviesGenreBadge) {
        if (genre === 'all') {
          moviesGenreBadge.style.display = 'none';
        } else {
          moviesGenreBadge.textContent = genreNames[genre];
          moviesGenreBadge.style.display = 'block';
        }
      }

      if (tvGenreBadge) {
        if (genre === 'all') {
          tvGenreBadge.style.display = 'none';
        } else {
          tvGenreBadge.textContent = genreNames[genre];
          tvGenreBadge.style.display = 'block';
        }
      }

      if (genre === 'all') { loadRows(); return; }

      const moviesRow = document.getElementById('row-trending-movies');
      const tvRow = document.getElementById('row-popular-tv');
      if (!moviesRow || !tvRow) return;

      moviesRow.innerHTML = Array(8).fill(0).map(() =>
        `<div class="card"><div class="skeleton" style="aspect-ratio:2/3;border-radius:10px;width:150px;"></div></div>`).join('');
      tvRow.innerHTML = moviesRow.innerHTML;

      const [movies, tv] = await Promise.all([
        tmdb('/discover/movie', { with_genres: genre, sort_by: 'popularity.desc' }),
        tmdb('/discover/tv', { with_genres: genre, sort_by: 'popularity.desc' }),
      ]);
      renderRow('row-trending-movies', (movies.results || []).map(i => ({ ...i, media_type: 'movie' })));
      renderRow('row-popular-tv', (tv.results || []).map(i => ({ ...i, media_type: 'tv' })));
    });
  });

  // Check for genre in URL params and apply filter
  const urlParams = new URLSearchParams(window.location.search);
  const genreParam = urlParams.get('genre');
  if (genreParam) {
    const item = document.querySelector(`.genre-dropdown-item[data-genre="${genreParam}"]`);
    if (item) {
      item.click();
    }
  }
}


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
  } catch (e) {
    renderApiError(row, e);
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

  // Hamburger genre links - apply filter, scroll to section and close menu (using event delegation)
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.genre-link');
    if (!link) return;
    
    e.preventDefault();
    
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    const hamburgerOverlay = document.getElementById('hamburgerOverlay');

    // Close hamburger menu
    if (hamburgerMenu) hamburgerMenu.classList.remove('open');
    if (hamburgerOverlay) hamburgerOverlay.classList.remove('open');
    document.body.style.overflow = '';

    // Get genre from href
    const href = link.getAttribute('href');
    const genreMatch = href.match(/genre=(\d+)/);
    const genre = genreMatch ? genreMatch[1] : null;
    
    if (genre) {
      // Find and click the corresponding genre pill
      const bar = document.getElementById('genreBar');
      if (bar) {
        const pill = bar.querySelector(`.genre-pill[data-genre="${genre}"]`);
        if (pill) {
          pill.click();
        }
      }
      
      // Scroll to trending section after a small delay
      setTimeout(() => {
        const section = document.getElementById('trendingSection');
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  });
}


function initSearch() {
  const openBtn = document.getElementById('searchOpenBtn');
  const closeBtn = document.getElementById('searchCloseBtn');
  const overlay = document.getElementById('searchOverlay');
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  const filters = document.getElementById('searchFilters');

  if (!openBtn || !overlay) return;

  openBtn.onclick = () => { overlay.classList.add('open'); setTimeout(() => input?.focus(), 100); };
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
  } catch (e) {
    results.innerHTML = `<p style="color:var(--text-muted);font-size:0.78rem;padding:12px;">Search failed. Try again.</p>`;
  }
}


async function openDetail(item) {
  currentItem = item;
  await detectAnime(currentItem);
  const overlay = document.getElementById('detailOverlay');
  const backdrop = document.getElementById('detailBackdrop');
  const poster = document.getElementById('detailPoster');
  const titleEl = document.getElementById('detailTitle');
  const metaEl = document.getElementById('detailMeta');
  const overviewEl = document.getElementById('detailOverview');
  const actionsEl = document.getElementById('detailActions');

  if (!overlay) return;

  const title = item.title || item.name || 'Unknown';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
  const type = item.media_type || 'movie';

  if (backdrop) backdrop.src = item.backdrop_path ? `${IMG_ORI}${item.backdrop_path}` : '';
  if (poster) poster.src = item.poster_path ? `${IMG_W500}${item.poster_path}` : '';
  if (titleEl) titleEl.textContent = title;
  if (overviewEl) overviewEl.textContent = item.overview || 'No description available.';

  if (metaEl) {
    metaEl.innerHTML = `
      ${rating ? `<span class="badge"><i data-lucide="star" style="fill:currentColor;width:11px;height:11px;display:inline;"></i> ${rating}</span>` : ''}
      ${year ? `<span>${year}</span>` : ''}
      <span class="badge">${type === 'tv' ? 'TV Show' : 'Movie'}</span>`;
  }

  const inWl = inWatchlist(item.id);
  if (actionsEl) {
    actionsEl.innerHTML = `
      <button class="btn-primary" id="detailPlayBtn" style="font-size:0.78rem;">
        <i data-lucide="play"></i> Watch Now
      </button>
      <button class="btn-secondary" id="detailTrailerBtn" style="font-size:0.78rem; display:none;">
        <i data-lucide="film"></i> Watch Trailer
      </button>
      <button class="btn-icon ${inWl ? 'active' : ''}" id="detailWlBtn">
        <i data-lucide="${inWl ? 'bookmark-check' : 'bookmark'}"></i>
        ${inWl ? 'Saved' : 'Watchlist'}
      </button>
      <select id="detailAddToListSelect" class="detail-list-select" aria-label="Add to custom list">
        <option value="">Add to list…</option>
        <option value="__new__">+ New list…</option>
      </select>`;
    const sel = document.getElementById('detailAddToListSelect');
    if (sel) {
      getCollections().lists.forEach(l => {
        const o = document.createElement('option');
        o.value = l.id;
        o.textContent = `${l.name} (${l.items.length})`;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        const v = sel.value;
        if (!v) return;
        sel.value = '';
        if (v === '__new__') {
          const name = window.prompt('Name your new list:');
          if (!name || !String(name).trim()) return;
          const nm = String(name).trim();
          const id = createCollection(nm);
          if (addItemToCollection(id, item)) {
            showToast(`Added to “${nm}”`, 'list');
            try { window.dispatchEvent(new Event('vault:collectionsUpdated')); } catch (_) {}
          } else showToast('Could not add', 'info');
          return;
        }
        if (addItemToCollection(v, item)) {
          const list = getCollections().lists.find(l => l.id === v);
          showToast(list ? `Added to “${list.name}”` : 'Added to list', 'list');
          try { window.dispatchEvent(new Event('vault:collectionsUpdated')); } catch (_) {}
        } else showToast('Already in that list', 'info');
      });
    }
  }

  const previewContainer = document.getElementById('detailPreview');
  const previewFrame = document.getElementById('detailPreviewFrame');

  (async () => {
    try {
      const mediaType = item.media_type || 'movie';
      const videos = await tmdb(`/${mediaType}/${item.id}/videos`);
      const trailer = (videos.results || []).find(v => v.type.toLowerCase() === 'trailer' && v.site.toLowerCase() === 'youtube');
      if (trailer) {
        const settings = getSettings();
        const autoplayParam = settings.autoPlayTrailers ? 'autoplay=1&mute=1&' : '';
        const embedUrl = `https://www.youtube.com/embed/${trailer.key}?${autoplayParam}controls=0&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&fs=0&disablekb=1&playsinline=1`;
      if (previewContainer && previewFrame) {
        previewFrame.src = embedUrl;
        previewContainer.style.display = 'block';
      }
      const tBtn = document.getElementById('detailTrailerBtn');
      if (tBtn) {
        tBtn.style.display = 'inline-flex';
        tBtn.onclick = () => {
          if (previewFrame && previewFrame.src === embedUrl) {
            previewContainer.style.display = previewContainer.style.display === 'block' ? 'none' : 'block';
          } else {
            previewFrame.src = embedUrl;
            previewContainer.style.display = 'block';
          }
        };
      }
      } else {
        if (previewContainer) previewContainer.style.display = 'none';
      }
    } catch (_) {
      if (previewContainer) previewContainer.style.display = 'none';
    }
  })();

  overlay.classList.add('open');
  lucide.createIcons({ nodes: [overlay] });

  document.getElementById('detailPlayBtn')?.addEventListener('click', () => {
    overlay.classList.remove('open');
    openPlayer(item);
  });
  document.getElementById('detailWlBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!btn) return;
    const added = await toggleWatchlist(item);
    showToast(added ? 'Added to Watchlist' : 'Removed from Watchlist', added ? 'bookmark-check' : 'bookmark');
    if (!btn.isConnected) return;
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
  if (continueProgressInterval) {
    clearInterval(continueProgressInterval);
    continueProgressInterval = null;
  }
  if (currentItem) {
    const total = resumeBaseSeconds + sessionPlaybackSeconds;
    if (total > 15) {
      const list = getContinueWatching().map(x =>
        sameMediaId(x.id, currentItem.id)
          ? {
              ...x,
              lastPositionSeconds: Math.floor(total),
              cwSeason: currentSeason,
              cwEpisode: currentEp,
              progress: Math.min(99, Math.max(1, (total / (x.media_type === 'tv' ? 2700 : 5400)) * 100)),
              updatedAt: Date.now()
            }
          : x
      );
      setContinueWatching(list);
    }
  }
  resumeBaseSeconds = 0;
  sessionPlaybackSeconds = 0;

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
  currentSeason = Number(season) || 1;
  currentEp = Number(ep) || 1;

  resumeBaseSeconds = item.resume ? getResumeSeconds(item) : 0;
  sessionPlaybackSeconds = 0;

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
        if (logoImg) logoImg.style.display = 'none';
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

  const baseStream = buildEmbedUrl(item, currentSource, currentSeason, currentEp);
  iframe.src = item.resume ? appendResumeTimeParam(baseStream, item) : baseStream;

  // Show/Hide Episodes Grid based on media type
  if (item.media_type === 'tv') {
    episodesSection.style.display = 'flex';
    await loadEpisodeBar(item, season, ep);
  } else {
    episodesSection.style.display = 'none';
  }

  const histItem = { ...item };
  delete histItem.resume;
  addToHistory({ ...histItem, watchedAt: Date.now() });
  addToContinueWatching({ ...histItem, media_type: item.media_type }, currentSeason, currentEp);

  if (continueProgressInterval) clearInterval(continueProgressInterval);
  continueProgressInterval = setInterval(() => {
    if (!currentItem) return;
    sessionPlaybackSeconds += 5;
    const total = resumeBaseSeconds + sessionPlaybackSeconds;
    const list = getContinueWatching().map(x => {
      if (!sameMediaId(x.id, currentItem.id)) return x;
      const dur = x.media_type === 'tv' ? 2700 : 5400;
      const pct = Math.min(99, Math.max(1, (total / dur) * 100));
      return {
        ...x,
        lastPositionSeconds: Math.floor(total),
        cwSeason: currentSeason,
        cwEpisode: currentEp,
        progress: pct,
        updatedAt: Date.now()
      };
    });
    setContinueWatching(list);
    loadContinueWatching();
  }, 5000);

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
        const sn = parseInt(seasonSel.value, 10);

        document.getElementById('playerIframe').src = buildEmbedUrl(item, currentSource, sn, ep.episode_number);
        document.getElementById('playerInfoMeta').innerHTML = `<span style="color:var(--accent);">TV Show</span> &bull; Season ${seasonSel.value} &bull; Episode ${ep.episode_number}`;

        document.getElementById('playerPage').scrollTo({ top: 0, behavior: 'smooth' });

        touchContinueEpisode(item.id, sn, ep.episode_number);
        renderEps(seasonSel.value);
        updateUrl(item, seasonSel.value, ep.episode_number);
      });
      epBtnsDiv.appendChild(card);
    });
  }

  await renderEps(activeSeason);

  seasonSel.onchange = async () => {
    currentSeason = parseInt(seasonSel.value, 10);
    currentEp = 1;
    await renderEps(currentSeason);
    document.getElementById('playerIframe').src = buildEmbedUrl(item, currentSource, currentSeason, 1);
    document.getElementById('playerPage').scrollTo({ top: 0, behavior: 'smooth' });
    touchContinueEpisode(item.id, currentSeason, 1);
    updateUrl(item, currentSeason, 1);
  };
}


window.setPlayerSource = function (src) {
  currentSource = src;
  const iframe = document.getElementById('playerIframe');
  if (iframe && currentItem) {
    const base = buildEmbedUrl(currentItem, currentSource, currentSeason, currentEp);
    const withTime = appendResumeTimeParam(base, { ...currentItem, lastPositionSeconds: resumeBaseSeconds + sessionPlaybackSeconds });
    iframe.src = currentItem.media_type === 'tv' ? base : withTime;
  }
};

document.getElementById('playerBackBtn')?.addEventListener('click', closePlayer);


function checkUrlOnLoad() {
  const params = new URLSearchParams(window.location.search);
  const playId = params.get('play');
  if (playId) {
    const type = params.get('type') || 'movie';
    const s = params.get('s') || 1;
    const e = params.get('e') || 1;

    tmdb(`/${type}/${playId}`).then(data => {
      data.media_type = type;
      const cont = getContinueWatching().find(x => sameMediaId(x.id, data.id));
      let play = data;
      if (cont && (getResumeSeconds(cont) >= 45 || Number(cont.progress || 0) > 8)) {
        play = { ...data, ...cont, resume: true };
      }
      openPlayer(play, s, e, true);
    }).catch(err => console.error("Router fetch failed", err));
  }
}


(function initClickPause() {
  const overlay = document.getElementById('playerClickOverlay');
  if (!overlay) return;

  overlay.addEventListener('click', () => {
    const iframe = document.getElementById('playerIframe');
    if (!iframe) return;

    overlay.classList.remove('flash');
    void overlay.offsetWidth;
    overlay.classList.add('flash');

    try { iframe.contentWindow?.postMessage(JSON.stringify({ event: 'toggle_play_pause' }), '*'); } catch (_) { }
    try {
      const video = iframe.contentDocument?.querySelector('video');
      if (video) { video.paused ? video.play() : video.pause(); }
    } catch (_) { }
  });
})();


window.addEventListener('scroll', () => {
  const nav = document.getElementById('mainNav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });


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


function getSettings() {
  const defaults = {
    theme: 'dark',
    accent: 'cream',
    defaultServer: 'videasy',
    autoplay: true,
    skipButtons: true,
    fontSize: 'medium',
    autoPlayTrailers: false,
    notifications: true
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

  let colors;
  if (accent.startsWith('#')) {
    // Custom hex color
    colors = { main: accent, dim: accent }; // For simplicity, use same for dim, or calculate
  } else {
    colors = accentColors[accent] || accentColors.cream;
  }
  document.documentElement.style.setProperty('--accent', colors.main);
  document.documentElement.style.setProperty('--accent-dim', colors.dim);
}

function applyFontSize(size) {
  const sizes = {
    small: { base: '14px', heading: '18px', large: '20px' },
    medium: { base: '16px', heading: '20px', large: '24px' },
    large: { base: '18px', heading: '24px', large: '28px' }
  };
  const s = sizes[size] || sizes.medium;
  document.documentElement.style.setProperty('--font-size-base', s.base);
  document.documentElement.style.setProperty('--font-size-heading', s.heading);
  document.documentElement.style.setProperty('--font-size-large', s.large);
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  // Only dark theme supported
  document.documentElement.style.setProperty('--bg-base', '#0a0a0a');
  document.documentElement.style.setProperty('--bg-surface', '#111111');
  document.documentElement.style.setProperty('--bg-card', '#161616');
  document.documentElement.style.setProperty('--bg-overlay', 'rgba(15, 15, 15, 0.98)');
  document.documentElement.style.setProperty('--text-body', '#c0bbb4');
  document.documentElement.style.setProperty('--text-heading', '#f0ece4');
  document.documentElement.style.setProperty('--border', 'rgba(240, 236, 228, 0.08)');
}

function loadAndApplySettings() {
  const settings = getSettings();
  applyTheme('dark');
  applyAccent(settings.accent);
  applyFontSize(settings.fontSize);
}


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
  initKeyboardNav();

  if (document.getElementById('heroSection')) {
    await loadHero();
    await loadRows();
    await loadContinueWatching();
    await loadRecommended();
    attachRowControls();
    initGenreFilter();

    document.getElementById('continueClearBtn')?.addEventListener('click', () => {
      removeContinueWatching();
      loadContinueWatching();
      showToast('Continue Watching cleared', 'trash-2');
    });

    document.getElementById('recommendedRefreshBtn')?.addEventListener('click', async () => {
      await loadRecommended();
      showToast('Recommendations refreshed', 'refresh-cw');
    });

    document.getElementById('btnRandomPick')?.addEventListener('click', () => {
      if (!allLoadedItems.length) { showToast('Nothing to pick yet.'); return; }
      const item = allLoadedItems[Math.floor(Math.random() * allLoadedItems.length)];
      openDetail(item);
      showToast(`Random pick: ${item.title || item.name}`, 'shuffle');
    });

    document.getElementById('btnShareLink')?.addEventListener('click', () => {
      if (!currentItem) { showToast('Open something first to share', 'link-2'); return; }
      const url = new URL(window.location);
      url.searchParams.set('play', currentItem.id);
      url.searchParams.set('type', currentItem.media_type || 'movie');
      if (currentItem.media_type === 'tv') {
        url.searchParams.set('s', currentSeason);
        url.searchParams.set('e', currentEp);
      }
      url.searchParams.set('t', Math.floor(performance.now() / 1000));
      navigator.clipboard.writeText(url.toString()).then(() => {
        showToast('Share link copied to clipboard', 'copy');
      }).catch(() => showToast('Copy failed', 'alert-circle'));
    });

    if (window.location.hash === '#trendingSection') {
      setTimeout(() => {
        const section = document.getElementById('trendingSection');
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 500);
    }
  }

  checkUrlOnLoad();
});