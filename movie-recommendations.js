// movie-recommendations.js
// Snabba personliga filmforslag baserat pa historik, val, betyg och onskelistor.

import { api } from './api.js';
import { getWho, on as onStore } from './store.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];
const HISTORY_TTL_MS = 2 * 60 * 1000;
const WISHLIST_TTL_MS = 2 * 60 * 1000;

let activeWho = getWho();
let historyCache = null;
let historyPromise = null;
let wishlistCache = null;
let wishlistPromise = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function normalizePerson(s) {
  return String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function samePerson(a, b) {
  return normalizePerson(a) === normalizePerson(b);
}

function rowValue(row, wantedKey) {
  if (!row || !wantedKey) return '';
  if (Object.prototype.hasOwnProperty.call(row, wantedKey)) return row[wantedKey];
  const wanted = normalizePerson(wantedKey);
  const key = Object.keys(row).find((k) => normalizePerson(k) === wanted);
  return key ? row[key] : '';
}

function normalizeTitle(s) {
  let t = String(s || '').toLowerCase().trim();
  try { t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch {}
  return t
    .replace(/\((18|19|20|21)\d{2}\)\s*$/g, '')
    .replace(/[\s\-–—:,.]+(18|19|20|21)\d{2}\s*$/g, '')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(the|a|an)
+/i, '')
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
  return String(rowValue(row, 'Film') || row?.film || row?.Title || '').trim();
}

function picker(row) {
  return String(rowValue(row, 'Vem valde') || row?.who || row?.picker || '').trim();
}

function dateMs(row) {
  const d = new Date(rowValue(row, 'Datum') || row?.date || row?.Date || '');
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

function personRating(row, who) {
  const n = Number(rowValue(row, who));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function ratingsFrom(row, people = PEOPLE) {
  return people.map((p) => personRating(row, p)).filter(Boolean);
}

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function hasUserSeen(row, who) {
  return personRating(row, who) > 0 || samePerson(picker(row), who);
}

function titleMatchScore(title, query) {
  const t = normalizeTitle(title);
  const q = normalizeTitle(query);
  if (!t) return -1;
  if (!q) return 0.16;
  if (t === q) return 2.4;
  if (t.startsWith(q)) return 1.75;
  if (t.includes(q)) return 1.2;

  const tokens = q.split(' ').filter(Boolean);
  const hits = tokens.filter((token) => t.includes(token)).length;
  return tokens.length && hits ? hits / tokens.length : -1;
}

async function loadHistory({ force = false } = {}) {
  const now = Date.now();
  if (!force && historyCache?.savedAt && now - historyCache.savedAt < HISTORY_TTL_MS) {
    return historyCache.rows;
  }
  if (!force && historyPromise) return historyPromise;

  historyPromise = api('getHistory', { limit: 10000 })
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

async function loadWishlists({ force = false } = {}) {
  const now = Date.now();
  if (!force && wishlistCache?.savedAt && now - wishlistCache.savedAt < WISHLIST_TTL_MS) {
    return wishlistCache.rows;
  }
  if (!force && wishlistPromise) return wishlistPromise;

  wishlistPromise = Promise.all(
    PEOPLE.map((person) => api('getWishlist', { person }).catch(() => null))
  )
    .then((lists) => {
      const rows = [];
      lists.forEach((j, idx) => {
        const person = PEOPLE[idx];
        if (!j?.ok) return;
        for (let rank = 1; rank <= 5; rank++) {
          const title = String(j[`R${rank}`] || '').trim();
          if (title) rows.push({ title, person, rank });
        }
      });
      wishlistCache = { savedAt: Date.now(), rows };
      return rows;
    })
    .catch(() => wishlistCache?.rows || [])
    .finally(() => {
      wishlistPromise = null;
    });

  return wishlistPromise;
}

function buildUserProfile(historyRows, who) {
  const seen = new Set();
  const trust = new Map();

  for (const row of historyRows || []) {
    const title = filmTitle(row);
    const key = normalizeTitle(title);
    if (!key) continue;

    if (hasUserSeen(row, who)) seen.add(key);

    const own = personRating(row, who);
    const pickedBy = picker(row);
    if (own && pickedBy && !samePerson(pickedBy, who)) {
      const trustKey = PEOPLE.find((p) => samePerson(p, pickedBy)) || pickedBy;
      if (!trust.has(trustKey)) trust.set(trustKey, []);
      trust.get(trustKey).push(own / 10);
    }
  }

  const pickerTrust = new Map();
  PEOPLE.forEach((person) => {
    const values = trust.get(person) || [];
    pickerTrust.set(person, values.length ? avg(values) : 0.52);
  });
  pickerTrust.set(who, 0.95);

  return { seen, pickerTrust };
}

function ensureCandidate(map, title) {
  const key = normalizeTitle(title);
  if (!key) return null;
  if (!map.has(key)) {
    map.set(key, {
      key,
      title: String(title || '').trim(),
      wishlistOwners: [],
      bestWishlistRank: 99,
      historyRows: []
    });
  }
  return map.get(key);
}

function buildCandidates(historyRows, wishlistRows, who) {
  const profile = buildUserProfile(historyRows, who);
  const candidates = new Map();

  for (const item of wishlistRows || []) {
    const c = ensureCandidate(candidates, item.title);
    if (!c) continue;
    c.wishlistOwners.push(item.person);
    c.bestWishlistRank = Math.min(c.bestWishlistRank, Number(item.rank) || 99);
  }

  for (const row of historyRows || []) {
    const others = ratingsFrom(row, PEOPLE.filter((p) => !samePerson(p, who)));
    if (!others.length || hasUserSeen(row, who)) continue;
    const c = ensureCandidate(candidates, filmTitle(row));
    if (c) c.historyRows.push(row);
  }

  for (const [key, c] of candidates) {
    if (profile.seen.has(key)) {
      candidates.delete(key);
      continue;
    }
    c.wishlistOwners = [...new Set(c.wishlistOwners)];
  }

  return { candidates: [...candidates.values()], profile };
}

function scoreCandidate(candidate, query, who, profile) {
  const match = titleMatchScore(candidate.title, query);
  if (match < 0) return -1;

  const owners = candidate.wishlistOwners;
  const ownerTrust = owners.length ? avg(owners.map((p) => profile.pickerTrust.get(p) || 0.52)) : 0;
  const onMyWishlist = owners.some((p) => samePerson(p, who)) ? 1 : 0;
  const ownerAcceptance = Math.min(owners.length, 4) * 0.18;
  const rankBoost = candidate.bestWishlistRank < 99 ? (6 - candidate.bestWishlistRank) * 0.07 : 0;

  const otherRatings = candidate.historyRows.flatMap((row) => ratingsFrom(row, PEOPLE.filter((p) => !samePerson(p, who))));
  const communityAvg = otherRatings.length ? avg(otherRatings) / 10 : 0;
  const communityCount = Math.min(otherRatings.length, 4) * 0.12;
  const recent = candidate.historyRows.reduce((best, row) => Math.max(best, dateMs(row)), 0);
  const recentBoost = recent ? Math.max(0, 1 - ((Date.now() - recent) / (365 * 24 * 3600_000))) * 0.12 : 0;

  return match
    + onMyWishlist * 1.1
    + ownerTrust * 0.75
    + ownerAcceptance
    + rankBoost
    + communityAvg * 0.95
    + communityCount
    + recentBoost;
}

function rank(rows, wishlists, query, who, limit = 5) {
  const { candidates, profile } = buildCandidates(rows, wishlists, who);

  return candidates
    .map((candidate) => {
      const otherRatings = candidate.historyRows.flatMap((row) => ratingsFrom(row, PEOPLE.filter((p) => !samePerson(p, who))));
      return {
        title: candidate.title,
        owners: candidate.wishlistOwners,
        avg: otherRatings.length ? avg(otherRatings) : 0,
        n: otherRatings.length,
        score: scoreCandidate(candidate, query, who, profile)
      };
    })
    .filter((x) => x.title && x.score >= 0 && !profile.seen.has(normalizeTitle(x.title)))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'sv'))
    .slice(0, limit);
}

function metaText(item, who) {
  const parts = [];
  const others = item.owners.filter((p) => !samePerson(p, who));
  if (item.owners.some((p) => samePerson(p, who))) parts.push('pa din lista');
  if (others.length) parts.push(`pa ${others.join(', ')}s lista`);
  if (item.avg) parts.push(`andra gav ${Math.round(item.avg * 10) / 10}${item.n ? ` (${item.n})` : ''}`);
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
    .personalSuggest__item{display:inline-flex; flex-direction:column; align-items:flex-start; gap:2px; max-width:100%; border-radius:12px; text-align:left}
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
  box.innerHTML = '<div class="personalSuggest__head">Osedda forslag</div><div class="personalSuggest__row"></div>';
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
  activeWho = getWho() || activeWho;
  const [rows, wishlists] = await Promise.all([loadHistory(), loadWishlists()]);
  if (!input?.isConnected) return;

  const items = rank(rows, wishlists, input.value, activeWho);
  if (!items.length) return hide(input);

  const box = getBox(input, anchor);
  const row = box.querySelector('.personalSuggest__row');
  row.innerHTML = items.map((item, i) => {
    const meta = metaText(item, activeWho);
    return `
      <button type="button" class="ghost personalSuggest__item" data-personal-pick="${i}">
        <span class="personalSuggest__title">${esc(item.title)}</span>
        ${meta ? `<span class="personalSuggest__meta">${esc(meta)}</span>` : ''}
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
  const update = debounce(() => render(input, anchor, onPick), 140);
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
      historyCache = null;
      wishlistCache = null;
      Promise.all([
        loadHistory({ force: true }),
        loadWishlists({ force: true })
      ]).catch(() => {});
    });
  } catch {}

  const warm = () => Promise.all([loadHistory(), loadWishlists()]).catch(() => {});
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 3500 });
  else setTimeout(warm, 1200);
}
