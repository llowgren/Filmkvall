// film-wishlist.js
// <film-wishlist> – Hanterar önskelistan (1–5) för vald användare
// Funktioner: autocomplete (TMDb), poster+IMDb, streaming (Watchmode) kollapsad till ~2 rader, flytta upp/ner,
// lugn autosave + manuell spara-knapp.

import { api } from './api.js';
import { getWho, on as onStore, setWho } from './store.js';
import { getMovieTokens } from './film-login.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];

// ===== Tokens =====
const TOK = getMovieTokens?.() || {};
const TMDB_KEY = TOK.tmdb || '';
const OMDB_KEY = TOK.omdb || '';
const WATCHMODE_KEY = TOK.watchmode || '';

const TMDB_URL = 'https://api.themoviedb.org/3';
const OMDB_URL = 'https://www.omdbapi.com/';

// ===== Helpers =====
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

const normLite = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9åäö\s:!?.\-]/g, '')
  .trim();

function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ===== Local cache =====
const Cache = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { }
  }
};

async function getMetaCached(key, fetcher, ttlMs) {
  const cached = Cache.get(key);
  const now = Date.now();
  if (cached?.data && cached.savedAt && (now - cached.savedAt) < ttlMs) return cached.data;
  const data = await fetcher();
  Cache.set(key, { savedAt: now, data });
  return data;
}

// ===== TMDb autocomplete =====
async function tmdbSearchMovies(query, limit = 8) {
  if (!TMDB_KEY || !query) return [];
  const url = `${TMDB_URL}/search/movie?api_key=${encodeURIComponent(TMDB_KEY)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json();
  const res = Array.isArray(j?.results) ? j.results : [];
  return res.slice(0, limit).map(it => ({
    title: it.title || it.original_title || '',
    year: (it.release_date || '').slice(0, 4) || '',
  }));
}

function hideAc(root, id) {
  const box = root.querySelector(`#ac-${id}`);
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

function showAc(root, id, items, onPick) {
  const box = root.querySelector(`#ac-${id}`);
  if (!box) return;
  if (!items.length) return hideAc(root, id);

  box.innerHTML = items.map((x, i) => `
    <div class="ac-item" data-i="${i}">
      <div><strong>${esc(x.title)}</strong> <span class="ac-muted">${esc(x.year)}</span></div>
    </div>
  `).join('');
  box.style.display = 'block';

  box.querySelectorAll('.ac-item').forEach(el => {
    const pick = (ev) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      const i = Number(el.getAttribute('data-i'));
      onPick(items[i]);
      hideAc(root, id);
    };
    el.addEventListener('pointerdown', pick, { passive: false });
    el.addEventListener('touchstart', pick, { passive: false });
    el.addEventListener('click', pick);
  });
}

function bindAutocomplete(root, inputId) {
  const input = root.querySelector(`#${inputId}`);
  const box = root.querySelector(`#ac-${inputId}`);
  if (!input || !box) return;

  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });

  const doSearch = debounce(async () => {
    if (composing) return;
    if (document.activeElement !== input) return;

    const q = (input.value || '').trim();
    if (q.length < 3) return hideAc(root, inputId);

    const hits = await tmdbSearchMovies(q, 8);
    if (document.activeElement !== input) return;

    showAc(root, inputId, hits, (pick) => {
      input.value = pick.year ? `${pick.title} (${pick.year})` : pick.title;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, 380);

  input.addEventListener('input', doSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideAc(root, inputId); });
  input.addEventListener('blur', () => setTimeout(() => hideAc(root, inputId), 150));
}

// ===== OMDb/TMDb lookup (smart) =====
async function tmdbSearchMovieBest(query) {
  if (!TMDB_KEY || !query) return null;
  const url = `${TMDB_URL}/search/movie?api_key=${encodeURIComponent(TMDB_KEY)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json();
  if (!Array.isArray(j?.results) || !j.results.length) return null;

  const qn = normLite(query);
  const scored = j.results.map(it => {
    const tn = normLite(it.title || it.original_title);
    let score = 0;
    if (tn === qn) score = 100;
    else if (tn.startsWith(qn)) score = 80;
    else if (tn.includes(qn)) score = 60;
    score += Math.min(20, (it.vote_count || 0) / 1000);
    return { score, it };
  }).sort((a, b) => b.score - a.score);

  return scored[0].it;
}

async function tmdbExternalIds(movieId) {
  if (!TMDB_KEY || !movieId) return null;
  const url = `${TMDB_URL}/movie/${movieId}/external_ids?api_key=${encodeURIComponent(TMDB_KEY)}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  return await r.json();
}

async function tmdbLookup(query) {
  const hit = await tmdbSearchMovieBest(query);
  if (!hit) return null;

  let imdbID = '';
  try {
    const ids = await tmdbExternalIds(hit.id);
    imdbID = ids?.imdb_id || '';
  } catch { }

  const poster = hit.poster_path ? `https://image.tmdb.org/t/p/w154${hit.poster_path}` : 'N/A';
  const year = (hit.release_date || '').slice(0, 4) || '';

  return {
    Title: hit.title || hit.original_title || '',
    Year: year,
    Poster: poster,
    imdbID,
    imdbRating: '-',
  };
}

async function omdbLookup(query) {
  if (!OMDB_KEY || !query) return null;
  let q = query.trim(), year = null;
  const mYear = q.match(/\((\d{4})\)$/);
  if (mYear) { year = mYear[1]; q = q.replace(/\s*\(\d{4}\)\s*$/, ''); }

  // imdbID or imdb url
  const tt = (q.match(/tt\d{7,}/i) || q.match(/imdb\.com\/title\/(tt\d+)/i));
  if (tt) {
    const id = (tt[1] || tt[0]).replace(/^.*(tt\d+).*$/, '$1');
    const r = await fetch(`${OMDB_URL}?apikey=${OMDB_KEY}&i=${id}&plot=short`, { cache: 'no-store' }).catch(() => null);
    const j = r ? await r.json() : null;
    if (j && j.Response !== 'False') return j;
    return null;
  }

  // title
  try {
    const r1 = await fetch(`${OMDB_URL}?apikey=${OMDB_KEY}&t=${encodeURIComponent(q)}${year ? `&y=${year}` : ''}&type=movie&plot=short`, { cache: 'no-store' });
    const j1 = await r1.json();
    if (j1 && j1.Response !== 'False') return j1;
  } catch { }

  // search
  try {
    const r2 = await fetch(`${OMDB_URL}?apikey=${OMDB_KEY}&s=${encodeURIComponent(q)}&type=movie`, { cache: 'no-store' });
    const j2 = await r2.json();
    if (j2 && j2.Response !== 'False' && Array.isArray(j2.Search) && j2.Search.length) {
      // pick first
      const first = j2.Search[0];
      return await omdbLookup(first?.Title ? `${first.Title} (${first.Year || ''})` : q);
    }
  } catch { }

  return null;
}

async function smartLookup(query) {
  if (!query) return null;
  const q = query.trim();
  const cacheKey = `smartLookup_v1_${normLite(q)}`;

  return getMetaCached(cacheKey, async () => {
    if (/\btt\d{7,}\b/i.test(q) || /imdb\.com\/title\/tt\d+/i.test(q)) {
      const om = await omdbLookup(q);
      if (om) return om;
    }

    const tm = await tmdbLookup(q);
    if (tm) {
      if (tm.imdbID) return tm;
      const tryOmdb = await omdbLookup(`${tm.Title} (${tm.Year || ''})`);
      return tryOmdb || tm;
    }

    return await omdbLookup(q);
  }, 30 * 24 * 3600_000);
}

function imdbUrlFrom(j) {
  return j?.imdbID ? `https://www.imdb.com/title/${j.imdbID}/` : '';
}

// ===== Watchmode (streaming) =====
async function wmTitleIdFromImdb(imdbID) {
  if (!WATCHMODE_KEY || !imdbID) return null;
  try {
    const u1 = `https://api.watchmode.com/v1/find/?apiKey=${WATCHMODE_KEY}&source=imdb&external_id=${encodeURIComponent(imdbID)}`;
    let r = await fetch(u1, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && j.title_id) return j.title_id;
    }
    const u2 = `https://api.watchmode.com/v1/search/?apiKey=${WATCHMODE_KEY}&search_field=imdb_id&search_value=${encodeURIComponent(imdbID)}`;
    r = await fetch(u2, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const hit = Array.isArray(j?.title_results) ? j.title_results.find(t => String(t.imdb_id) === String(imdbID)) : null;
      if (hit?.id) return hit.id;
    }
  } catch { }
  return null;
}

async function getStreamingInfo(imdbID) {
  if (!WATCHMODE_KEY || !imdbID) return null;
  return getMetaCached(`wm_sources_${imdbID}`, async () => {
    const wmId = await wmTitleIdFromImdb(imdbID);
    if (!wmId) return null;

    const url = `https://api.watchmode.com/v1/title/${wmId}/sources/?apiKey=${WATCHMODE_KEY}`;
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
    const data = res ? await res.json() : null;
    if (!Array.isArray(data)) return null;

    const seen = new Set();
    const normalizeName = s => String(s || '')
      .replace(/\s*\(with Ads\)$/i, '')
      .replace(/\s+HD$/, '')
      .trim();

    const filtered = data
      .filter(s => s.type === 'sub' && s.name)
      .map(s => ({
        service: normalizeName(s.name),
        quality: (s.format === '4K' || s.format === 'HD') ? s.format : '',
        region: s.region || '',
        link: s.web_url || ''
      }))
      .filter(s => {
        const key = `${s.service}|${s.quality}|${s.region}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.service + a.region + a.quality).localeCompare(b.service + b.region + b.quality));

    return filtered.length ? filtered : null;
  }, 7 * 24 * 3600_000);
}

function buildStreamingHtml(imdbID) {
  // Cache-först: om vi har cache, rendera pills direkt utan nätverk.
  const cached = Cache.get(`wm_sources_${imdbID}`)?.data || null;
  if (cached) return pillsHtml(imdbID, cached);

  // Ingen cache: visa "(klicka för att hämta)" + knapp
  return `
    <div class="streaming-wrap" data-imdb="${esc(imdbID)}">
      <div class="muted" style="font-size:12px">Tillgängligt i abonnemang (globalt)</div>
      <div class="muted" style="font-size:12px">(klicka för att hämta)</div>
      <button type="button" class="streaming-toggle" style="display:inline-block">…</button>
    </div>
  `;
}

function pillsHtml(imdbID, options) {
  const pills = (options || []).map(opt => {
    const label = [
      opt.service,
      opt.quality ? ` ${opt.quality}` : '',
      opt.region ? ` · ${opt.region}` : ''
    ].join('');
    const href = opt.link ? `href="${opt.link}" target="_blank" rel="noopener"` : '';
    return `<a ${href} class="pill" style="text-decoration:none">${esc(label)} (ingår)</a>`;
  }).join('');

  return `
    <div class="streaming-wrap" data-imdb="${esc(imdbID)}">
      <div class="muted" style="font-size:12px">Tillgängligt i abonnemang (globalt)</div>
      <div class="streaming-row collapsed">${pills || ''}</div>
      <button type="button" class="streaming-toggle" style="display:none">…</button>
    </div>
  `;
}

function wireStreaming(el) {
  const wrap = el.querySelector('.streaming-wrap');
  const toggle = el.querySelector('.streaming-toggle');
  const row = el.querySelector('.streaming-row');
  if (!wrap || !toggle) return;

  const imdbID = wrap.getAttribute('data-imdb') || '';

  const ensureToggleVisibility = () => {
    if (!row) return;
    requestAnimationFrame(() => {
      const needs = row.scrollHeight > row.clientHeight + 2;
      toggle.style.display = needs ? 'inline-block' : 'none';
      toggle.textContent = row.classList.contains('collapsed') ? '…' : 'visa färre';
    });
  };

  // Cached-läge
  if (row) {
    ensureToggleVisibility();
    toggle.addEventListener('click', () => {
      const collapsed = row.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '…' : 'visa färre';
    });
    return;
  }

  // Lazy fetch-läge
  toggle.addEventListener('click', async () => {
    if (!imdbID) return;
    toggle.disabled = true;
    toggle.textContent = 'hämtar…';

    const options = await getStreamingInfo(imdbID);

    // bygg och injicera
    wrap.innerHTML = pillsHtml(imdbID, options).replace(/^\s*<div class="streaming-wrap"[^>]*>|<\/div>\s*$/g, '');

    // re-wire
    const newRow = wrap.querySelector('.streaming-row');
    const newToggle = wrap.querySelector('.streaming-toggle');
    if (!newRow || !newToggle) return;

    requestAnimationFrame(() => {
      const needs = newRow.scrollHeight > newRow.clientHeight + 2;
      newToggle.style.display = needs ? 'inline-block' : 'none';
      newToggle.textContent = '…';
    });

    newToggle.onclick = () => {
      const collapsed = newRow.classList.toggle('collapsed');
      newToggle.textContent = collapsed ? '…' : 'visa färre';
    };
  });
}

// ===== Render meta under each row =====
async function renderMeta(root, i, query) {
  const infoEl = root.querySelector(`#w${i}-info`);
  if (!infoEl) return;

  const q = (query || '').trim();
  if (!q) {
    infoEl.innerHTML = '';
    return;
  }

  const data = await smartLookup(q);
  if (!data) {
    infoEl.innerHTML = `<div class="muted">Hittade inget för: ${esc(q)}</div>`;
    return;
  }

  const title = esc(data.Title || '');
  const year = esc(data.Year || '');
  const rating = esc(data.imdbRating || '-');
  const imdbUrl = imdbUrlFrom(data);

  const poster = (data.Poster && data.Poster !== 'N/A')
    ? `<img class="wl-poster" src="${data.Poster}" alt="poster" loading="lazy" decoding="async">`
    : `<div class="wl-poster wl-poster-empty"></div>`;

  const streaming = data.imdbID
    ? buildStreamingHtml(data.imdbID)
    : '';

  infoEl.innerHTML = `
    <div class="wl-meta">
      <div class="wl-left">${poster}</div>
      <div class="wl-mid">
        <div class="wl-title"><strong>${title}</strong>${year ? ` (${year})` : ''}</div>
        <div class="wl-imdb">IMDb ${rating}${imdbUrl ? ` — <a href="${imdbUrl}" target="_blank" rel="noopener">Öppna på IMDb</a>` : ''}</div>
        <div class="wl-stream">${streaming}</div>
      </div>
    </div>
  `;

  // wire streaming toggle / lazy fetch
  wireStreaming(infoEl);
}

// ===== Component =====
class FilmWishlist extends HTMLElement {
  connectedCallback() {
    this.render();
    this.bind();
    this.loadFromServer({ useCache: true });
  }

  render() {
    this.innerHTML = `
      <section class="card" id="wishlistCard">
        <div class="row" style="align-items:center">
          <div class="col" style="min-width:240px">
            <h3 style="margin:0">Önskelista</h3>
            <div class="muted" style="font-size:13px">Användare: <span id="wlWho">–</span></div>
          </div>
          <span class="right"></span>
          <div class="col" style="flex:0 0 auto; display:flex; gap:8px; align-items:center; justify-content:flex-end">
            <button id="wlLoad" class="ghost">Hämta</button>
            <button id="wlSave" class="primary">Spara</button>
          </div>
        </div>

        <div class="wishlist-col" id="wishlistCol">
          ${[1, 2, 3, 4, 5].map(i => this.rowHtml(i)).join('')}
        </div>

        <div class="muted" id="wlStatus" style="margin-top:8px; font-size:12px"></div>
      </section>
    `;
  }

  rowHtml(i) {
    const upDisabled = i === 1 ? 'disabled' : '';
    const downDisabled = i === 5 ? 'disabled' : '';

    return `
      <div class="wishlist-item" data-i="${i}">
        <div class="ac-wrap lookup-wrap" style="flex:1">
          <input id="w${i}" class="lookup-input" placeholder="#${i}" autocomplete="off" autocapitalize="off" spellcheck="false">
          <button type="button" class="lookup-btn" data-lookup="w${i}">Sök</button>
          <div class="ac-list" id="ac-w${i}" style="display:none"></div>
        </div>

        <div class="wishlist-move" aria-label="Flytta önskan">
          <button type="button" class="ghost" data-move="up" data-i="${i}" aria-label="Flytta upp" ${upDisabled}>▲</button>
          <button type="button" class="ghost" data-move="down" data-i="${i}" aria-label="Flytta ner" ${downDisabled}>▼</button>
        </div>
      </div>
      <div id="w${i}-info" class="omdb-info"></div>
    `;
  }

  bind() {
    this._busy = false;

    // who
    this.updateWhoLabel();
    this._unsubWho = onStore('who', () => {
      this.updateWhoLabel();
      this.loadFromServer({ useCache: true });
    });

    // buttons
    this.querySelector('#wlLoad')?.addEventListener('click', () => this.loadFromServer({ useCache: false }));
    this.querySelector('#wlSave')?.addEventListener('click', () => this.saveNow({ reason: 'manuell' }));

    // lookup + meta (Sök-knapp)
    this.querySelectorAll('button[data-lookup]')?.forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-lookup');
        const val = this.querySelector(`#${id}`)?.value || '';
        await renderMeta(this, Number(id.replace('w', '')), val);
      });
    });

    // autocomplete
    ['w1', 'w2', 'w3', 'w4', 'w5'].forEach(id => bindAutocomplete(this, id));

    // calm meta lookup (on blur/enter + mild debounce)
    const scheduleMeta = debounce(async (id) => {
      const val = this.querySelector(`#${id}`)?.value || '';
      await renderMeta(this, Number(id.replace('w', '')), val);
    }, 900);

    ['w1', 'w2', 'w3', 'w4', 'w5'].forEach(id => {
      const el = this.querySelector(`#${id}`);
      if (!el) return;

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          scheduleMeta(id);
          this.autoSave.schedule('enter');
        }
      });

      el.addEventListener('blur', () => {
        scheduleMeta(id);
        this.autoSave.commit('blur');
      });

      el.addEventListener('input', () => {
        // meta ska inte jaga – bara om man stannar upp
        scheduleMeta(id);
        this.autoSave.schedule('skriver');
      });

      el.addEventListener('change', () => {
        scheduleMeta(id);
        this.autoSave.schedule('ändrat');
      });
    });

    // move up/down
    this.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-move][data-i]');
      if (!btn) return;

      const i = Number(btn.getAttribute('data-i'));
      const dir = btn.getAttribute('data-move');
      if (dir === 'up' && i > 1) this.swap(i, i - 1);
      if (dir === 'down' && i < 5) this.swap(i, i + 1);
    });

    // close autocomplete on outside
    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('.ac-wrap')) return;
      ['w1', 'w2', 'w3', 'w4', 'w5'].forEach(id => hideAc(this, id));
    }, { passive: true });

    // autosave controller
    this.autoSave = new WishlistAutoSaveController(this);
  }

  disconnectedCallback() {
    try { this._unsubWho?.(); } catch { }
  }

  updateWhoLabel() {
    const who = getWho?.() || 'Maria';
    const el = this.querySelector('#wlWho');
    if (el) el.textContent = who;
  }

  getValues() {
    const v = (id) => (this.querySelector(`#${id}`)?.value || '').trim();
    return {
      R1: v('w1'),
      R2: v('w2'),
      R3: v('w3'),
      R4: v('w4'),
      R5: v('w5'),
    };
  }

  setValues(rows) {
    const set = (id, val) => {
      const el = this.querySelector(`#${id}`);
      if (el) el.value = val || '';
    };

    // block autosave while applying
    this.autoSave.applying = true;
    set('w1', rows?.R1);
    set('w2', rows?.R2);
    set('w3', rows?.R3);
    set('w4', rows?.R4);
    set('w5', rows?.R5);
    this.autoSave.applying = false;

    // refresh metas (snällt)
    [1, 2, 3, 4, 5].forEach(i => renderMeta(this, i, this.querySelector(`#w${i}`)?.value || ''));
  }

  async loadFromServer({ useCache } = { useCache: true }) {
    const who = getWho?.() || 'Maria';
    this.updateWhoLabel();

    // cache
    const cacheKey = `api_getWishlist_v1_${who}`;

    if (useCache) {
      const cached = Cache.get(cacheKey)?.data;
      if (cached?.ok) {
        this.setValues(cached);
        this.autoSave.lastSigByPerson[who] = this.autoSave.sig(who);
      }
    }

    const j = await api('getWishlist', { person: who }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (!j?.ok) {
      this.setStatus(`Kunde inte hämta: ${j?.error || 'getWishlist'}`);
      return;
    }

    Cache.set(cacheKey, { savedAt: Date.now(), data: j });
    this.setValues(j);
    this.autoSave.lastSigByPerson[who] = this.autoSave.sig(who);
    this.setStatus('');
  }

  setStatus(msg) {
    const el = this.querySelector('#wlStatus');
    if (el) el.textContent = msg || '';
  }

  async saveNow({ reason } = { reason: '' }) {
    if (this._busy) return;
    this._busy = true;

    const saveBtn = this.querySelector('#wlSave');
    const loadBtn = this.querySelector('#wlLoad');
    if (saveBtn) saveBtn.disabled = true;
    if (loadBtn) loadBtn.disabled = true;

    const who = getWho?.() || 'Maria';
    const body = { person: who, ...this.getValues() };

    // optimistic cache
    Cache.set(`api_getWishlist_v1_${who}`, { savedAt: Date.now(), data: { ok: true, ...body } });

    try {
      this.setStatus(reason ? `Sparar (${reason})…` : 'Sparar…');
      const j = await api('saveWishlist', body);
      if (!j?.ok) throw new Error(j?.error || 'saveWishlist');

      this.autoSave.lastSigByPerson[who] = this.autoSave.sig(who);
      this.setStatus('Sparad.');
      setTimeout(() => this.setStatus(''), 1200);

      // liten "flash" på kolumnen
      const box = this.querySelector('#wishlistCol');
      box?.classList.add('flash');
      setTimeout(() => box?.classList.remove('flash'), 700);
    } catch (e) {
      this.setStatus(`Fel vid spara: ${String(e?.message || e)}`);
    } finally {
      this._busy = false;
      if (saveBtn) saveBtn.disabled = false;
      if (loadBtn) loadBtn.disabled = false;
    }
  }

  swap(i, j) {
    if (i === j) return;
    const a = this.querySelector(`#w${i}`);
    const b = this.querySelector(`#w${j}`);
    if (!a || !b) return;

    this.autoSave.applying = true;
    const tmp = a.value;
    a.value = b.value;
    b.value = tmp;
    this.autoSave.applying = false;

    // meta uppdateras för båda
    renderMeta(this, i, a.value);
    renderMeta(this, j, b.value);

    // autosave när ordningen ändras
    this.autoSave.schedule('ordning');
  }
}

class WishlistAutoSaveController {
  constructor(root) {
    this.root = root;
    this.timer = null;
    this.delayMs = 1600;
    this.applying = false;
    this.lastSigByPerson = Object.create(null);
  }

  sig(person) {
    const v = (id) => (this.root.querySelector(`#${id}`)?.value || '').trim();
    return [person, v('w1'), v('w2'), v('w3'), v('w4'), v('w5')].join('␟');
  }

  schedule(reason = '') {
    if (this.applying) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(reason), this.delayMs);
  }

  commit(reason = '') {
    if (this.applying) return;
    const person = getWho?.() || 'Maria';
    const sig = this.sig(person);

    if (this.lastSigByPerson[person] === sig) return;

    // undvik tom-synk
    const hasAny = sig.split('␟').slice(1).some(x => x && x.length);
    if (!hasAny) return;

    this.lastSigByPerson[person] = sig;

    // Autospara tyst, men behåll manuell knapp för "känslan"
    // (reason används bara som status om det inte är "skriver")
    if (reason && reason !== 'skriver') {
      this.root.setStatus(`Autosparar (${reason})…`);
    }

    this.root.saveNow({ reason: reason || 'auto' });
  }
}

customElements.define('film-wishlist', FilmWishlist);

/*
  Kräver att styles.css innehåller (som du redan har från tidigare):
  - .card .row .col .muted .pill .flash
  - .lookup-wrap .lookup-input .lookup-btn
  - .ac-wrap .ac-list .ac-item .ac-muted
  - .wishlist-item .wishlist-move

  Lägg till dessa klasser i styles.css (eller kopiera in om de saknas):

  .wl-meta{display:grid; grid-template-columns:112px 1fr; gap:12px; align-items:start; margin:6px 0 10px;}
  .wl-poster{width:112px; height:auto; border-radius:10px; border:1px solid var(--border);}
  .wl-poster-empty{width:112px; height:168px; border-radius:10px; border:1px dashed var(--border); background:transparent;}
  .wl-imdb a{color:inherit; text-decoration:underline;}

  // Streaming: visa ~2 rader och fäll ut med …
  .streaming-row{display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;}
  .streaming-row.collapsed{max-height:64px; overflow:hidden;}
  .streaming-toggle{margin-top:4px; font-size:12px; padding:0; border:none; background:transparent; text-decoration:underline; cursor:pointer; color:var(--muted);}
*/
