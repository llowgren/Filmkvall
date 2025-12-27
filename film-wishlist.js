// film-wishlist.js
// Wishlist module ("Önskelista") – standalone, no globals
// Renders 5 upcoming picks for current user (from store/login)

import { api } from './api.js';
import { getWho, on as onStore } from './store.js';
import { getMovieTokens } from './film-login.js';

const PEOPLE_FALLBACK = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function debounce(fn, ms = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function imdbUrlFrom(imdbID) {
  return imdbID ? `https://www.imdb.com/title/${imdbID}/` : '';
}

function normLite(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9åäö\s:!?.\-]/g, '')
    .trim();
}

// Very small local cache to avoid hammering external APIs
const Cache = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
  }
};

async function getCached(key, ttlMs, fetcher) {
  const now = Date.now();
  const hit = Cache.get(key);
  if (hit?.t && hit?.v && (now - hit.t) < ttlMs) return hit.v;
  const v = await fetcher();
  Cache.set(key, { t: now, v });
  return v;
}

// --- External lookups (TMDb -> imdb id, OMDb details, Watchmode sources)
async function tmdbSearchMovies(query, limit = 8) {
  const { tmdb } = getMovieTokens();
  if (!tmdb || !query) return [];

  const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(tmdb)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json();
  const res = Array.isArray(j?.results) ? j.results : [];
  return res.slice(0, limit).map((it) => ({
    id: it.id,
    title: it.title || it.original_title || '',
    year: (it.release_date || '').slice(0, 4) || '',
    poster: it.poster_path ? `https://image.tmdb.org/t/p/w154${it.poster_path}` : ''
  }));
}

async function tmdbExternalIds(movieId) {
  const { tmdb } = getMovieTokens();
  if (!tmdb || !movieId) return null;
  const url = `https://api.themoviedb.org/3/movie/${movieId}/external_ids?api_key=${encodeURIComponent(tmdb)}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  return await r.json();
}

async function omdbLookupByImdb(imdbID) {
  const { omdb } = getMovieTokens();
  if (!omdb || !imdbID) return null;
  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&i=${encodeURIComponent(imdbID)}&plot=short`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json();
  return j && j.Response !== 'False' ? j : null;
}

async function omdbLookupByTitle(title, year) {
  const { omdb } = getMovieTokens();
  if (!omdb || !title) return null;

  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&t=${encodeURIComponent(title)}&type=movie&plot=short${year ? `&y=${encodeURIComponent(year)}` : ''}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json();
  return j && j.Response !== 'False' ? j : null;
}

async function smartLookup(query) {
  const q = String(query || '').trim();
  if (!q) return null;

  // Cache 30 dagar per normaliserad sträng
  const key = `fk_smart_v1_${normLite(q)}`;
  return getCached(key, 30 * 24 * 3600_000, async () => {
    // If query has (YYYY), strip it
    let title = q;
    let year = '';
    const m = q.match(/\((\d{4})\)\s*$/);
    if (m) {
      year = m[1];
      title = q.replace(/\s*\(\d{4}\)\s*$/, '').trim();
    }

    // If imdb id provided
    const tt = q.match(/\btt\d{7,}\b/i);
    if (tt) {
      const om = await omdbLookupByImdb(tt[0]);
      if (om) return om;
    }

    // TMDb search -> external imdb -> OMDb
    const hits = await tmdbSearchMovies(title, 5);
    if (hits.length) {
      // pick best: exact / startsWith / includes
      const qn = normLite(title);
      const scored = hits.map(h => {
        const tn = normLite(h.title);
        let score = 0;
        if (tn === qn) score = 100;
        else if (tn.startsWith(qn)) score = 80;
        else if (tn.includes(qn)) score = 60;
        if (year && h.year === year) score += 10;
        return { score, h };
      }).sort((a, b) => b.score - a.score);

      const best = scored[0].h;
      const ids = await tmdbExternalIds(best.id);
      const imdbID = ids?.imdb_id || '';
      if (imdbID) {
        const om = await omdbLookupByImdb(imdbID);
        if (om) return om;
      }
      // fallback: try OMDb by title/year
      const om2 = await omdbLookupByTitle(best.title, year || best.year);
      if (om2) return om2;

      // last resort: return minimal object
      return {
        Title: best.title,
        Year: best.year,
        Poster: best.poster || 'N/A',
        imdbID: imdbID,
        imdbRating: '-'
      };
    }

    // pure OMDb title lookup
    const om = await omdbLookupByTitle(title, year);
    return om;
  });
}

async function watchmodeFindTitleId(imdbID) {
  const { watchmode } = getMovieTokens();
  if (!watchmode || !imdbID) return null;

  // Cache 30 dagar: imdb->watchmode id
  const key = `fk_wm_id_v1_${imdbID}`;
  return getCached(key, 30 * 24 * 3600_000, async () => {
    try {
      const u1 = `https://api.watchmode.com/v1/find/?apiKey=${encodeURIComponent(watchmode)}&source=imdb&external_id=${encodeURIComponent(imdbID)}`;
      const r1 = await fetch(u1, { cache: 'no-store' }).catch(() => null);
      if (r1?.ok) {
        const j1 = await r1.json();
        if (j1?.title_id) return j1.title_id;
      }
      const u2 = `https://api.watchmode.com/v1/search/?apiKey=${encodeURIComponent(watchmode)}&search_field=imdb_id&search_value=${encodeURIComponent(imdbID)}`;
      const r2 = await fetch(u2, { cache: 'no-store' }).catch(() => null);
      if (r2?.ok) {
        const j2 = await r2.json();
        const hit = Array.isArray(j2?.title_results)
          ? j2.title_results.find(t => String(t.imdb_id) === String(imdbID))
          : null;
        if (hit?.id) return hit.id;
      }
    } catch { /* ignore */ }
    return null;
  });
}

async function watchmodeSources(imdbID) {
  const { watchmode } = getMovieTokens();
  if (!watchmode || !imdbID) return null;

  // Cache 7 dagar: sources kan ändras
  const key = `fk_wm_src_v1_${imdbID}`;
  return getCached(key, 7 * 24 * 3600_000, async () => {
    const wmId = await watchmodeFindTitleId(imdbID);
    if (!wmId) return null;

    const url = `https://api.watchmode.com/v1/title/${wmId}/sources/?apiKey=${encodeURIComponent(watchmode)}`;
    const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
    if (!r?.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j)) return null;

    const seen = new Set();
    const normalizeName = (s) => String(s || '')
      .replace(/\s*\(with Ads\)$/i, '')
      .replace(/\s+HD$/i, '')
      .trim();

    const filtered = j
      .filter(s => s.type === 'sub' && s.name)
      .map(s => ({
        service: normalizeName(s.name),
        region: s.region || '',
        quality: (s.format === '4K' || s.format === 'HD') ? s.format : '',
        link: s.web_url || ''
      }))
      .filter(s => {
        const k = `${s.service}|${s.region}|${s.quality}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (a.service + a.region + a.quality).localeCompare(b.service + b.region + b.quality));

    return filtered.length ? filtered : null;
  });
}

function buildStreamingHtml(imdbID, sources, { collapsed = true } = {}) {
  if (!imdbID) return '';

  if (!sources || !sources.length) {
    return `
      <div class="fk-stream">
        <div class="fk-stream-title">Tillgängligt i abonnemang (globalt):</div>
        <div class="fk-stream-empty">Inget abonnemang hittades just nu.</div>
      </div>
    `;
  }

  const pills = sources.map(s => {
    const label = `${s.service}${s.quality ? ` ${s.quality}` : ''}${s.region ? ` · ${s.region}` : ''}`;
    const href = s.link ? `href="${escapeHtml(s.link)}" target="_blank" rel="noopener"` : '';
    return `<a class="pill" ${href} style="text-decoration:none">${escapeHtml(label)} (ingår)</a>`;
  }).join('');

  return `
    <div class="fk-stream" data-imdb="${escapeHtml(imdbID)}">
      <div class="fk-stream-title">Tillgängligt i abonnemang (globalt):</div>
      <div class="fk-stream-row ${collapsed ? 'collapsed' : ''}">${pills}</div>
      <button type="button" class="fk-stream-toggle" style="display:none">…</button>
    </div>
  `;
}

function ensureStreamingToggle(container) {
  const wrap = container.querySelector('.fk-stream');
  if (!wrap) return;
  const row = wrap.querySelector('.fk-stream-row');
  const toggle = wrap.querySelector('.fk-stream-toggle');
  if (!row || !toggle) return;

  const update = () => {
    const lines = 2; // show ~2 lines
    const lineH = 34; // matches CSS-ish
    // If content taller than 2 lines, show toggle
    const needs = row.scrollHeight > (lines * lineH + 2);
    toggle.style.display = needs ? 'inline-block' : 'none';
    toggle.textContent = row.classList.contains('collapsed') ? '…' : 'visa färre';
  };

  // initial
  requestAnimationFrame(update);

  toggle.addEventListener('click', () => {
    row.classList.toggle('collapsed');
    update();
  });

  // update after images load etc
  const imgs = container.querySelectorAll('img');
  imgs.forEach(img => img.addEventListener('load', update, { once: true }));
}

function disableButtonWhile(btn, promise) {
  if (!btn) return promise;
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.classList.add('is-busy');
  return Promise.resolve(promise)
    .finally(() => {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = prevText;
    });
}

class FilmWishlist extends HTMLElement {
  constructor() {
    super();
    this._unsub = null;
    this._autosaveTimer = null;
    this._applyFromServer = false;
    this._lastSig = '';
  }

  connectedCallback() {
    this.render();
    this.bind();
    this.load({ useCache: true });

    // React to user change from login
    if (typeof onStore === 'function') {
      this._unsub = onStore('who', () => this.load({ useCache: true }));
    }
  }

  disconnectedCallback() {
    try { this._unsub?.(); } catch { /* ignore */ }
  }

  render() {
    this.innerHTML = `
      <section class="card" id="wishlistCard">
        <div class="fk-head">
          <div>
            <h3 style="margin:0">Önskelista</h3>
            <div class="muted" style="font-size:13px">Användare: <strong id="fkUser">–</strong></div>
          </div>
          <div class="fk-actions">
            <button id="fkReload" class="ghost">Hämta</button>
            <button id="fkSave" class="primary">Spara</button>
          </div>
        </div>

        <div class="fk-list" id="fkList"></div>

        <style>
          .fk-head{display:flex; align-items:center; justify-content:space-between; gap:12px}
          .fk-actions{display:flex; gap:10px; align-items:center}
          .fk-list{display:flex; flex-direction:column; gap:14px; margin-top:12px}

          .fk-item{border:1px solid var(--border); border-radius:12px; padding:12px}

          .fk-toprow{display:flex; gap:10px; align-items:center; flex-wrap:wrap}
          .fk-input{flex:1 1 320px; min-width:220px}
          .fk-search{flex:0 0 auto}

          .fk-move{display:flex; gap:8px; margin-left:auto}
          .fk-move button{width:42px; height:42px; padding:0; border-radius:12px; font-size:18px; line-height:1; display:flex; align-items:center; justify-content:center; touch-action:manipulation;}

          .fk-meta{display:flex; gap:12px; align-items:flex-start; margin-top:10px}
          .fk-thumb{width:92px; height:auto; border-radius:10px; border:1px solid var(--border)}

          .fk-imdb{min-width:160px}
          .fk-imdb a{color:inherit; text-decoration:underline}

          .fk-right{margin-left:auto; text-align:right; max-width:520px}

          .fk-stream-title{font-size:13px; color:var(--muted); margin-bottom:6px}
          .fk-stream-empty{font-size:12px; color:var(--muted)}
          .fk-stream-row{display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end}
          .fk-stream-row.collapsed{max-height:68px; overflow:hidden} /* ~2 rader */
          .fk-stream-toggle{margin-top:6px; font-size:12px; padding:0; border:none; background:transparent; text-decoration:underline; cursor:pointer; color:var(--muted)}

          /* Autocomplete */
          .ac-wrap{ position:relative; }
          .ac-list{ position:absolute; left:0; right:0; top:100%; z-index:50; background:var(--panel); border:1px solid var(--border); border-radius:10px; margin-top:6px; overflow:hidden }
          .ac-item{ padding:10px 12px; cursor:pointer; border-top:1px solid var(--border); font-size:14px }
          .ac-item:first-child{border-top:none}
          .ac-item:hover{filter:brightness(1.08)}
          .ac-muted{ color:var(--muted); font-size:12px }

          /* Busy feedback */
          button.is-busy{opacity:.6; filter:saturate(.6)}

          @media (max-width:720px){
            .fk-meta{flex-direction:column}
            .fk-right{margin-left:0; text-align:left; max-width:none}
            .fk-stream-row{justify-content:flex-start}
          }
        </style>
      </section>
    `;

    const list = this.querySelector('#fkList');
    list.innerHTML = Array.from({ length: 5 }).map((_, idx) => {
      const i = idx + 1;
      return `
        <div class="fk-item" data-i="${i}">
          <div class="fk-toprow">
            <div class="fk-input ac-wrap" style="flex:1">
              <label style="margin:0 0 6px">#${i}</label>
              <input id="fk_w${i}" class="lookup-input" placeholder="Film (${i})" autocomplete="off" spellcheck="false" />
              <div class="ac-list" id="fk_ac_w${i}" style="display:none"></div>
            </div>
            <button class="lookup-btn fk-search" type="button" data-lookup="fk_w${i}">Sök</button>
            <div class="fk-move" aria-label="Flytta">
              <button type="button" class="ghost" data-move="up" data-i="${i}" aria-label="Flytta upp">▲</button>
              <button type="button" class="ghost" data-move="down" data-i="${i}" aria-label="Flytta ner">▼</button>
            </div>
          </div>

          <div class="fk-meta" id="fk_meta_w${i}"></div>
        </div>
      `;
    }).join('');

    this.updateMoveButtons();
  }

  bind() {
    const reloadBtn = this.querySelector('#fkReload');
    const saveBtn = this.querySelector('#fkSave');

    reloadBtn?.addEventListener('click', () => {
      disableButtonWhile(reloadBtn, this.load({ useCache: false }));
    });

    saveBtn?.addEventListener('click', () => {
      disableButtonWhile(saveBtn, this.save());
    });

    // Search buttons
    this.querySelectorAll('button[data-lookup]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-lookup');
        const input = this.querySelector(`#${id}`);
        const q = input?.value || '';
        await this.renderMeta(id, q, { withStreaming: true });
      });
    });

    // Move up/down
    this.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-move][data-i]');
      if (!btn) return;
      const i = Number(btn.getAttribute('data-i'));
      const dir = btn.getAttribute('data-move');
      if (dir === 'up' && i > 1) this.swap(i, i - 1);
      if (dir === 'down' && i < 5) this.swap(i, i + 1);
    });

    // Inputs: autosave + autocomplete + meta update (gentle)
    for (let i = 1; i <= 5; i++) {
      const input = this.querySelector(`#fk_w${i}`);
      if (!input) continue;

      // Gentle meta update on blur/change
      input.addEventListener('change', () => this.renderMeta(`fk_w${i}`, input.value, { withStreaming: true }));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.renderMeta(`fk_w${i}`, input.value, { withStreaming: true });
        }
      });

      // Autosave (quiet)
      input.addEventListener('input', () => this.scheduleAutosave());

      // Autocomplete
      this.bindAutocomplete(`fk_w${i}`);
    }

    // Close autocomplete when clicking outside
    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('.ac-wrap')) return;
      for (let i = 1; i <= 5; i++) this.hideAc(`fk_w${i}`);
    });
  }

  get person() {
    try { return getWho?.() || 'Lars'; } catch { return 'Lars'; }
  }

  sig() {
    const p = this.person;
    const vals = [];
    for (let i = 1; i <= 5; i++) vals.push((this.querySelector(`#fk_w${i}`)?.value || '').trim());
    return [p, ...vals].join('␟');
  }

  scheduleAutosave() {
    if (this._applyFromServer) return;
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => {
      const s = this.sig();
      if (s === this._lastSig) return;
      // Avoid saving if all empty
      const hasAny = s.split('␟').slice(1).some(x => x && x.length);
      if (!hasAny) return;
      this._lastSig = s;
      this.save({ quiet: true });
    }, 1400);
  }

  updateMoveButtons() {
    this.querySelectorAll('[data-move][data-i]').forEach((btn) => {
      const i = Number(btn.getAttribute('data-i'));
      const dir = btn.getAttribute('data-move');
      btn.disabled = (dir === 'up' && i === 1) || (dir === 'down' && i === 5);
    });
  }

  swap(i, j) {
    const a = this.querySelector(`#fk_w${i}`);
    const b = this.querySelector(`#fk_w${j}`);
    if (!a || !b) return;

    this._applyFromServer = true;
    const tmp = a.value;
    a.value = b.value;
    b.value = tmp;
    this._applyFromServer = false;

    // Re-render meta for those two rows
    this.renderMeta(`fk_w${i}`, a.value, { withStreaming: true });
    this.renderMeta(`fk_w${j}`, b.value, { withStreaming: true });

    this.updateMoveButtons();
    this.scheduleAutosave();
  }

  async load({ useCache = true } = {}) {
    const userEl = this.querySelector('#fkUser');
    if (userEl) userEl.textContent = this.person;

    const who = this.person;

    // Prefer cache for speed
    const cacheKey = `fk_wishlist_api_v1_${who}`;
    const cached = useCache ? Cache.get(cacheKey)?.v : null;
    if (cached?.ok) {
      this.applyWishlist(cached);
      // background refresh
      if (useCache) this.refreshFromServer(cacheKey, who);
      return;
    }

    await this.refreshFromServer(cacheKey, who);
  }

  async refreshFromServer(cacheKey, who) {
    const j = await api('getWishlist', { person: who });
    if (j?.ok) {
      Cache.set(cacheKey, { t: Date.now(), v: j });
      this.applyWishlist(j);
    } else {
      // leave UI as-is, but show a minimal hint
      const list = this.querySelector('#fkList');
      if (list && !list.querySelector('.fk-err')) {
        const div = document.createElement('div');
        div.className = 'muted fk-err';
        div.style.marginTop = '8px';
        div.textContent = `Kunde inte hämta önskelista: ${j?.error || 'okänt fel'}`;
        list.prepend(div);
      }
    }
  }

  applyWishlist(j) {
    this._applyFromServer = true;
    for (let i = 1; i <= 5; i++) {
      const el = this.querySelector(`#fk_w${i}`);
      if (el) el.value = j[`R${i}`] || '';
    }
    this._applyFromServer = false;

    // update signature so autosave doesn't trigger immediately
    this._lastSig = this.sig();

    // Render metas (parallel, but gentle)
    for (let i = 1; i <= 5; i++) {
      const q = this.querySelector(`#fk_w${i}`)?.value || '';
      if (q.trim()) this.renderMeta(`fk_w${i}`, q, { withStreaming: true });
      else this.clearMeta(`fk_w${i}`);
    }

    this.updateMoveButtons();
  }

  async save({ quiet = false } = {}) {
    const who = this.person;
    const body = { person: who };
    for (let i = 1; i <= 5; i++) {
      body[`R${i}`] = (this.querySelector(`#fk_w${i}`)?.value || '').trim();
    }

    // Optimistic cache
    Cache.set(`fk_wishlist_api_v1_${who}`, { t: Date.now(), v: { ok: true, ...body } });

    const saveBtn = this.querySelector('#fkSave');
    if (!quiet && saveBtn) {
      saveBtn.textContent = 'Sparar…';
      saveBtn.disabled = true;
    }

    try {
      const j = await api('saveWishlist', body);
      if (!j?.ok) throw new Error(j?.error || 'saveWishlist');
      this._lastSig = this.sig();
    } finally {
      if (!quiet && saveBtn) {
        saveBtn.textContent = 'Spara';
        saveBtn.disabled = false;
      }
    }
  }

  clearMeta(inputId) {
    const m = this.querySelector(`#fk_meta_${inputId}`);
    if (m) m.innerHTML = '';
  }

  async renderMeta(inputId, query, { withStreaming = true } = {}) {
    const meta = this.querySelector(`#fk_meta_${inputId}`);
    if (!meta) return;

    const q = String(query || '').trim();
    if (!q) {
      meta.innerHTML = '';
      return;
    }

    meta.innerHTML = `<div class="muted" style="font-size:13px">Hämtar…</div>`;

    const data = await smartLookup(q);
    if (!data) {
      meta.innerHTML = `<div class="muted" style="font-size:13px">Hittade inget för: ${escapeHtml(q)}</div>`;
      return;
    }

    const imdbID = data.imdbID || '';
    const imdbLink = imdbUrlFrom(imdbID);
    const rating = data.imdbRating || '-';
    const poster = (data.Poster && data.Poster !== 'N/A')
      ? data.Poster
      : '';

    // Streaming: show cached if present; otherwise lazy fetch via “…” button
    let sources = null;
    let hasCachedSources = false;

    if (withStreaming && imdbID) {
      const cached = Cache.get(`fk_wm_src_v1_${imdbID}`)?.v;
      if (cached) {
        sources = cached;
        hasCachedSources = true;
      }
    }

    const streamingBlock = (withStreaming && imdbID)
      ? (hasCachedSources
          ? buildStreamingHtml(imdbID, sources, { collapsed: true })
          : `
            <div class="fk-stream" data-imdb="${escapeHtml(imdbID)}">
              <div class="fk-stream-title">Tillgängligt i abonnemang (globalt):</div>
              <div class="fk-stream-empty">(klicka för att hämta)</div>
              <button type="button" class="fk-stream-toggle" style="display:inline-block">…</button>
            </div>
          `)
      : '';

    meta.innerHTML = `
      ${poster ? `<img class="fk-thumb" src="${escapeHtml(poster)}" alt="poster" loading="lazy" decoding="async" />` : ''}

      <div class="fk-imdb">
        <div><strong>${escapeHtml(data.Title || q)}</strong>${data.Year ? ` (${escapeHtml(data.Year)})` : ''}</div>
        <div>IMDb ${escapeHtml(rating)}${imdbLink ? ` — <a href="${escapeHtml(imdbLink)}" target="_blank" rel="noopener">Öppna på IMDb</a>` : ''}</div>
      </div>

      <div class="fk-right">
        ${streamingBlock}
      </div>
    `;

    // Enable collapse toggle for cached streaming
    ensureStreamingToggle(meta);

    // If no cached sources: lazy fetch when user clicks “…”
    const toggle = meta.querySelector('.fk-stream-toggle');
    const wrap = meta.querySelector('.fk-stream');
    const row = meta.querySelector('.fk-stream-row');

    if (toggle && wrap && !row && imdbID) {
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        toggle.textContent = 'hämtar…';

        const fetched = await watchmodeSources(imdbID);

        // Write into cache bucket used above
        Cache.set(`fk_wm_src_v1_${imdbID}`, { t: Date.now(), v: fetched });

        // Replace content
        wrap.innerHTML = buildStreamingHtml(imdbID, fetched, { collapsed: true })
          .replace(/^\s*<div class=\"fk-stream\"[^>]*>/, '')
          .replace(/<\/div>\s*$/, '');

        // Re-wire toggle
        ensureStreamingToggle(meta);
      }, { once: true });
    }
  }

  // --- Autocomplete (gentle)
  hideAc(inputId) {
    const box = this.querySelector(`#fk_ac_${inputId}`);
    if (box) {
      box.style.display = 'none';
      box.innerHTML = '';
    }
  }

  showAc(inputId, items, onPick) {
    const box = this.querySelector(`#fk_ac_${inputId}`);
    if (!box) return;
    if (!items.length) return this.hideAc(inputId);

    box.innerHTML = items.map((x, idx) => `
      <div class="ac-item" data-i="${idx}">
        <div><strong>${escapeHtml(x.title)}</strong> <span class="ac-muted">${escapeHtml(x.year)}</span></div>
      </div>
    `).join('');
    box.style.display = 'block';

    box.querySelectorAll('.ac-item').forEach((el) => {
      const pick = (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        const i = Number(el.getAttribute('data-i'));
        onPick(items[i]);
        this.hideAc(inputId);
      };
      el.addEventListener('pointerdown', pick, { passive: false });
      el.addEventListener('touchstart', pick, { passive: false });
      el.addEventListener('click', pick);
    });
  }

  bindAutocomplete(inputId) {
    const input = this.querySelector(`#${inputId}`);
    const box = this.querySelector(`#fk_ac_${inputId}`);
    if (!input || !box) return;

    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });

    const doSearch = debounce(async () => {
      if (composing) return;
      if (document.activeElement !== input) return;

      const q = (input.value || '').trim();
      if (q.length < 3) return this.hideAc(inputId);

      const hits = await tmdbSearchMovies(q, 8);
      if (document.activeElement !== input) return;

      this.showAc(inputId, hits, (pick) => {
        input.value = pick.year ? `${pick.title} (${pick.year})` : pick.title;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }, 420);

    input.addEventListener('input', doSearch);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideAc(inputId);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => this.hideAc(inputId), 160);
    });
  }
}

customElements.define('film-wishlist', FilmWishlist);
