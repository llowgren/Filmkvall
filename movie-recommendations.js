// movie-recommendations.js
// Snabba personliga filmforslag baserat pa historik, val och betyg.

import { api } from './api.js';
import { getWho, on as onStore } from './store.js';
import { getMovieTokens } from './film-login.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];
const HISTORY_TTL_MS = 10 * 60 * 1000;
const PROFILE_TTL_MS = 14 * 24 * 3600_000;
const TMDB_URL = 'https://api.themoviedb.org/3';
const PROFILE_HISTORY_LIMIT = 500;

let activeWho = getWho();
let historyCache = null;
let historyPromise = null;
let profileCache = null;
let profilePromise = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function normalizeTitle(s) {
  let t = String(s || '').toLowerCase().trim();
  try { t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch {}
  return t
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(the|a|an)\s+/i, '')
    .trim();
}

function debounce(fn, ms = 140) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function filmTitle(row) {
  return String(row?.Film ?? row?.film ?? row?.Title ?? '').trim();
}

function picker(row) {
  return String(row?.['Vem valde'] ?? row?.who ?? row?.picker ?? '').trim();
}

function dateMs(row) {
  const d = new Date(row?.Datum ?? row?.date ?? row?.Date ?? '');
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

function personRating(row, who) {
  const n = Number(row?.[who]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function allRatings(row) {
  return PEOPLE.map((p) => personRating(row, p)).filter(Boolean);
}

function avgRating(row) {
  const nums = allRatings(row);
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

async function loadHistory({ force = false } = {}) {
  const now = Date.now();
  if (!force && historyCache?.savedAt && now - historyCache.savedAt < HISTORY_TTL_MS) {
    return historyCache.rows;
  }
  if (!force && historyPromise) return historyPromise;

  historyPromise = api('getHistory', { limit: PROFILE_HISTORY_LIMIT })
    .then((j) => {
      const rows = Array.isArray(j?.rows) ? j.rows : [];
      historyCache = { savedAt: Date.now(), rows };
      return rows;
    })
    .catch(() => historyCache?.rows || [])
    .finally(() => {
      historyPromise = null;
    });

  return historyPromise;
}

function uniqueLatest(rows) {
  const seen = new Map();
  for (const row of rows || []) {
    const title = filmTitle(row);
    const key = normalizeTitle(title);
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev || dateMs(row) > dateMs(prev)) seen.set(key, row);
  }
  return [...seen.values()];
}

function watchedTitleSet(rows) {
  return new Set(uniqueLatest(rows).map((row) => normalizeTitle(filmTitle(row))).filter(Boolean));
}

function tmdbKey() {
  try { return getMovieTokens()?.tmdb || ''; } catch { return ''; }
}

function tmdbImage(path) {
  return path ? `https://image.tmdb.org/t/p/w92${path}` : '';
}

function cacheGet(key, ttl = PROFILE_TTL_MS) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    if (v?.savedAt && Date.now() - v.savedAt < ttl) return v.value;
  } catch {}
  return null;
}

function cacheSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value })); } catch {}
}

async function tmdbJson(path, params = {}) {
  const key = tmdbKey();
  if (!key) return null;
  const qs = new URLSearchParams({ api_key: key, language: 'sv-SE', ...params });
  const r = await fetch(`${TMDB_URL}${path}?${qs}`, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}

async function tmdbSearchMovies(query, limit = 10) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const cacheKey = `personal_tmdb_search_${normalizeTitle(q)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const j = await tmdbJson('/search/movie', {
    query: q,
    include_adult: 'false'
  });
  const out = (Array.isArray(j?.results) ? j.results : [])
    .filter((it) => it?.title || it?.original_title)
    .slice(0, limit * 2);
  cacheSet(cacheKey, out);
  return out.slice(0, limit);
}

async function tmdbDiscoverMovies(profile, limit = 12) {
  const genres = topGenreIds(profile, 3);
  const params = {
    include_adult: 'false',
    sort_by: 'vote_average.desc',
    'vote_count.gte': '120'
  };
  if (genres.length) params.with_genres = genres.join('|');

  const cacheKey = `personal_tmdb_discover_${genres.join('_') || 'general'}`;
  const cached = cacheGet(cacheKey, 24 * 3600_000);
  if (cached) return cached.slice(0, limit);

  const j = await tmdbJson('/discover/movie', params);
  const out = Array.isArray(j?.results) ? j.results.slice(0, limit * 2) : [];
  cacheSet(cacheKey, out);
  return out.slice(0, limit);
}

async function tmdbFindMovie(title) {
  const key = normalizeTitle(title);
  if (!key) return null;
  const cacheKey = `personal_tmdb_find_${key}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  const hits = await tmdbSearchMovies(title, 4);
  const wanted = normalizeTitle(title);
  const best = hits
    .map((it) => ({ it, score: titleSimilarity(wanted, normalizeTitle(it.title || it.original_title)) }))
    .sort((a, b) => b.score - a.score)[0]?.it || null;

  const value = best?.id ? await tmdbMovieDetails(best.id) : null;
  cacheSet(cacheKey, value);
  return value;
}

async function tmdbMovieDetails(id) {
  if (!id) return null;
  const cacheKey = `personal_tmdb_details_${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const j = await tmdbJson(`/movie/${id}`);
  if (j?.id) cacheSet(cacheKey, j);
  return j?.id ? j : null;
}

function addWeight(map, id, weight) {
  if (!id || !Number.isFinite(weight) || weight === 0) return;
  map.set(String(id), (map.get(String(id)) || 0) + weight);
}

function genreIds(movie) {
  if (Array.isArray(movie?.genre_ids)) return movie.genre_ids.map(String);
  if (Array.isArray(movie?.genres)) return movie.genres.map((g) => String(g.id)).filter(Boolean);
  return [];
}

function topGenreIds(profile, limit = 3) {
  return [...profile.userGenres.entries()]
    .map(([id, weight]) => [id, weight + (profile.groupGenres.get(id) || 0) * 0.55])
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

function titleSimilarity(a, b) {
  const aa = String(a || '').split(' ').filter(Boolean);
  const bb = new Set(String(b || '').split(' ').filter(Boolean));
  if (!aa.length || !bb.size) return 0;
  const hits = aa.filter((token) => bb.has(token)).length;
  return hits / Math.max(aa.length, bb.size);
}

function rowTaste(row, who) {
  const own = personRating(row, who);
  const avg = avgRating(row);
  const ratings = allRatings(row);
  const lowVotes = ratings.filter((n) => n <= 5).length;
  const highVotes = ratings.filter((n) => n >= 8).length;
  const ratedByOthers = PEOPLE.filter((p) => p !== who).map((p) => personRating(row, p)).filter(Boolean);

  let user = 0;
  if (own >= 9) user += 3.2;
  else if (own >= 8) user += 2.4;
  else if (own >= 7) user += 1.1;
  else if (own > 0 && own <= 5) user -= 2.4;
  if (picker(row) === who) user += 0.7;

  let group = 0;
  if (avg >= 8.5 && highVotes >= 2) group += 2.4;
  else if (avg >= 8) group += 1.7;
  else if (avg >= 7) group += 0.8;
  group += Math.min(1.2, highVotes * 0.3);

  let avoid = 0;
  if (lowVotes) avoid += lowVotes * 1.4;
  if (ratedByOthers.length && ratedByOthers.some((n) => n <= 4)) avoid += 1.8;
  if (avg && avg < 6) avoid += 1.2;

  return { user, group, avoid };
}

async function buildProfile(rows, who) {
  const signature = uniqueLatest(rows)
    .map((row) => `${normalizeTitle(filmTitle(row))}:${dateMs(row)}:${PEOPLE.map((p) => personRating(row, p)).join(',')}`)
    .join('|');
  if (profileCache?.who === who && profileCache.signature === signature) return profileCache.profile;
  if (profilePromise) return profilePromise;

  profilePromise = (async () => {
    const profile = {
      watched: watchedTitleSet(rows),
      userGenres: new Map(),
      groupGenres: new Map(),
      avoidGenres: new Map(),
      likedTitles: [],
      dislikedTitles: []
    };

    const candidates = uniqueLatest(rows)
      .map((row) => ({ row, taste: rowTaste(row, who) }))
      .filter(({ taste }) => taste.user > 0 || taste.group > 0 || taste.avoid > 0)
      .sort((a, b) => (b.taste.user + b.taste.group + b.taste.avoid) - (a.taste.user + a.taste.group + a.taste.avoid))
      .slice(0, 35);

    for (const { row, taste } of candidates) {
      const movie = await tmdbFindMovie(filmTitle(row));
      const ids = genreIds(movie);
      for (const id of ids) {
        addWeight(profile.userGenres, id, taste.user);
        addWeight(profile.groupGenres, id, taste.group);
        addWeight(profile.avoidGenres, id, taste.avoid);
      }
      const title = normalizeTitle(filmTitle(row));
      if (title && taste.user + taste.group > 1) profile.likedTitles.push({ title, weight: taste.user + taste.group });
      if (title && taste.avoid > 0) profile.dislikedTitles.push({ title, weight: taste.avoid });
    }

    profileCache = { who, signature, profile };
    return profile;
  })().finally(() => {
    profilePromise = null;
  });

  return profilePromise;
}

function genreScore(ids, weights) {
  return ids.reduce((sum, id) => sum + (weights.get(String(id)) || 0), 0);
}

function scoreCandidate(movie, query, profile) {
  const title = movie?.title || movie?.original_title || '';
  const norm = normalizeTitle(title);
  if (!norm || profile.watched.has(norm)) return -1;

  const q = normalizeTitle(query);
  let queryScore = 0;
  if (q) {
    if (norm === q) queryScore = 3;
    else if (norm.startsWith(q)) queryScore = 2.1;
    else if (norm.includes(q)) queryScore = 1.3;
    else queryScore = titleSimilarity(q, norm);
    if (queryScore <= 0) return -1;
  } else {
    queryScore = 0.35;
  }

  const ids = genreIds(movie);
  const userFit = genreScore(ids, profile.userGenres);
  const groupFit = genreScore(ids, profile.groupGenres);
  const avoid = genreScore(ids, profile.avoidGenres);
  const vote = Number(movie.vote_average || 0);
  const votes = Number(movie.vote_count || 0);
  const quality = vote ? (vote / 10) * Math.min(1.2, Math.log10(Math.max(10, votes)) / 3) : 0;
  const popularity = Math.min(0.7, Math.log10(Math.max(1, Number(movie.popularity || 0))) / 4);
  const likedTitleEcho = Math.max(0, ...profile.likedTitles.map((x) => titleSimilarity(x.title, norm) * Math.min(1.2, x.weight / 4)));
  const dislikedTitleEcho = Math.max(0, ...profile.dislikedTitles.map((x) => titleSimilarity(x.title, norm) * Math.min(1.5, x.weight / 3)));

  return queryScore + userFit * 0.28 + groupFit * 0.2 + quality + popularity + likedTitleEcho - avoid * 0.35 - dislikedTitleEcho;
}

async function rankNewMovies(rows, query, who, limit = 5) {
  const profile = await buildProfile(rows, who);
  const q = String(query || '').trim();
  const base = q.length >= 2 ? await tmdbSearchMovies(q, 14) : await tmdbDiscoverMovies(profile, 14);

  const withDetails = await Promise.all(base.map(async (it) => {
    const details = await tmdbMovieDetails(it.id);
    return details || it;
  }));

  const seen = new Set();
  return withDetails
    .map((movie) => {
      const title = movie?.title || movie?.original_title || '';
      const key = normalizeTitle(title);
      if (!key || seen.has(key) || profile.watched.has(key)) return null;
      seen.add(key);
      return {
        title,
        year: String(movie?.release_date || '').slice(0, 4),
        poster: tmdbImage(movie?.poster_path),
        vote: Number(movie?.vote_average || 0),
        score: scoreCandidate(movie, q, profile)
      };
    })
    .filter((x) => x?.title && x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function metaText(item) {
  const parts = ['ny film'];
  if (item.year) parts.push(item.year);
  if (item.vote) parts.push(`TMDb ${Math.round(item.vote * 10) / 10}`);
  return parts.join(' · ');
}

function ensureStyles() {
  if (document.getElementById('movieRecommendationStyles')) return;
  const style = document.createElement('style');
  style.id = 'movieRecommendationStyles';
  style.textContent = `
    .personalSuggest{display:none; margin-top:8px}
    .personalSuggest.is-open{display:block}
    .personalSuggest__head{font-size:12px; color:var(--muted); margin-bottom:6px}
    .personalSuggest__row{display:flex; flex-wrap:wrap; gap:8px}
    .personalSuggest__item{display:inline-flex; flex-direction:row; align-items:center; gap:8px; max-width:100%; border-radius:12px; text-align:left}
    .personalSuggest__poster{width:28px; height:42px; object-fit:cover; border-radius:6px; background:rgba(255,255,255,.08); flex:0 0 auto}
    .personalSuggest__copy{display:flex; flex-direction:column; align-items:flex-start; gap:2px; min-width:0}
    .personalSuggest__title{max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
    .personalSuggest__meta{font-size:12px; color:var(--muted)}
  `;
  document.head.appendChild(style);
}

function getBox(input, anchor) {
  let box = input._personalSuggestBox;
  if (box?.isConnected) return box;
  box = document.createElement('div');
  box.className = 'personalSuggest';
  box.innerHTML = '<div class="personalSuggest__head">Nya forslag for dig</div><div class="personalSuggest__row"></div>';
  anchor.insertAdjacentElement('afterend', box);
  input._personalSuggestBox = box;
  return box;
}

function hide(input) {
  const box = input?._personalSuggestBox;
  if (!box) return;
  box.classList.remove('is-open');
  const row = box.querySelector('.personalSuggest__row');
  if (row) row.innerHTML = '';
}

async function render(input, anchor, onPick) {
  const queryAtStart = input?.value || '';
  const rows = await loadHistory();
  if (!input?.isConnected || input.value !== queryAtStart) return;

  const items = await rankNewMovies(rows, input.value, activeWho);
  if (!input?.isConnected || input.value !== queryAtStart) return;
  if (!items.length) return hide(input);

  const box = getBox(input, anchor);
  const row = box.querySelector('.personalSuggest__row');
  row.innerHTML = items.map((item, i) => {
    const meta = metaText(item);
    const poster = item.poster ? `<img class="personalSuggest__poster" src="${esc(item.poster)}" alt="">` : '';
    return `
      <button type="button" class="ghost personalSuggest__item" data-personal-pick="${i}">
        ${poster}
        <span class="personalSuggest__copy">
          <span class="personalSuggest__title">${esc(item.title)}</span>
          ${meta ? `<span class="personalSuggest__meta">${esc(meta)}</span>` : ''}
        </span>
      </button>
    `;
  }).join('');

  row.querySelectorAll('[data-personal-pick]').forEach((btn) => {
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const item = items[Number(btn.getAttribute('data-personal-pick'))];
      if (!item?.title) return;
      input.value = item.title;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      hide(input);
      onPick?.();
    }, { passive: false });
  });

  box.classList.add('is-open');
}

function installInput(input, anchor, onPick) {
  if (!input || input._personalSuggestInstalled) return;
  input._personalSuggestInstalled = true;
  const update = debounce(() => render(input, anchor, onPick), 180);
  input.addEventListener('focus', update);
  input.addEventListener('input', update);
  input.addEventListener('blur', () => setTimeout(() => hide(input), 180));
}

function installNow() {
  const host = document.querySelector('film-now');
  const input = host?.querySelector?.('#suggested');
  const anchor = host?.querySelector?.('.filmRow');
  if (!host || !input || !anchor) return false;
  installInput(input, anchor, () => host.querySelector('#btnLookup')?.click());
  return true;
}

function installWishlist() {
  const host = document.querySelector('film-wishlist');
  if (!host) return false;
  let installed = 0;
  host.querySelectorAll('input[id^="wl-"]').forEach((input) => {
    const line = input.closest('.wl-inputline');
    const wrap = input.closest('.wl-inputwrap');
    const idx = input.id.replace('wl-', '');
    if (!line || !wrap) return;
    installInput(input, line, () => wrap.querySelector(`[data-search="${idx}"]`)?.click());
    installed++;
  });
  return installed > 0;
}

function installWhenReady() {
  if (installNow() && installWishlist()) return;
  const observer = new MutationObserver(() => {
    if (installNow() && installWishlist()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 8000);
}

export function installMovieRecommendations() {
  ensureStyles();
  installWhenReady();

  try {
    onStore('who', (who) => {
      activeWho = who || activeWho;
      profileCache = null;
      loadHistory({ force: true }).catch(() => {});
    });
  } catch {}

  const warm = async () => {
    const rows = await loadHistory().catch(() => []);
    await buildProfile(rows, activeWho).catch(() => {});
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 3500 });
  else setTimeout(warm, 1200);
}
