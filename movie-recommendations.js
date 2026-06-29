// movie-recommendations.js
// Snabba personliga filmforslag baserat pa historik, val och betyg.

import { api } from './api.js';
import { getWho, on as onStore } from './store.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];
const HISTORY_TTL_MS = 10 * 60 * 1000;

let activeWho = getWho();
let historyCache = null;
let historyPromise = null;

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

function avgRating(row) {
  const nums = PEOPLE.map((p) => personRating(row, p)).filter(Boolean);
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

async function loadHistory({ force = false } = {}) {
  const now = Date.now();
  if (!force && historyCache?.savedAt && now - historyCache.savedAt < HISTORY_TTL_MS) {
    return historyCache.rows;
  }
  if (!force && historyPromise) return historyPromise;

  historyPromise = api('getHistory', { limit: 80 })
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

function score(row, query, who) {
  const title = normalizeTitle(filmTitle(row));
  const q = normalizeTitle(query);
  if (!title) return -1;

  let match = 0;
  if (!q) match = 0.12;
  else if (title === q) match = 2.2;
  else if (title.startsWith(q)) match = 1.7;
  else if (title.includes(q)) match = 1.15;
  else {
    const tokens = q.split(' ').filter(Boolean);
    const hits = tokens.filter((token) => title.includes(token)).length;
    match = tokens.length ? hits / tokens.length : 0;
  }
  if (q && match <= 0) return -1;

  const own = personRating(row, who) / 10;
  const avg = avgRating(row) / 10;
  const pickedByMe = picker(row) === who ? 0.65 : 0;
  const age = dateMs(row) ? (Date.now() - dateMs(row)) / (365 * 24 * 3600_000) : 1;
  const recent = Math.max(0, 1 - age) * 0.2;

  return match + pickedByMe + own * 0.8 + avg * 0.55 + recent;
}

function rank(rows, query, who, limit = 5) {
  return uniqueLatest(rows)
    .map((row) => ({
      title: filmTitle(row),
      pickedBy: picker(row),
      mine: personRating(row, who),
      avg: avgRating(row),
      score: score(row, query, who)
    }))
    .filter((x) => x.title && x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function metaText(item, who) {
  const parts = [];
  if (item.mine) parts.push(`ditt betyg ${item.mine}`);
  if (!item.mine && item.avg) parts.push(`snitt ${Math.round(item.avg * 10) / 10}`);
  if (item.pickedBy && item.pickedBy !== who) parts.push(`vald av ${item.pickedBy}`);
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
  box.innerHTML = '<div class="personalSuggest__head">Personliga forslag</div><div class="personalSuggest__row"></div>';
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
  const rows = await loadHistory();
  if (!input?.isConnected) return;

  const items = rank(rows, input.value, activeWho);
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
      loadHistory({ force: true }).catch(() => {});
    });
  } catch {}

  const warm = () => loadHistory().catch(() => {});
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 3500 });
  else setTimeout(warm, 1200);
}
