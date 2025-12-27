// film-wishlist.js
// <film-wishlist> – Önskelista (1–5)
// Mål: samma funktion/känsla som gamla single-file, men modulärt.
// - Autocomplete (TMDb) lugnt
// - Poster + IMDb-länk
// - Streaming (Watchmode) på samma rad som thumbnail, två rader synliga + expand
// - Upp/Ner för ordning
// - Autosave (lugnt) + Spara-knapp

import * as Store from './store.js';
import * as Api from './api.js';
import { getMovieTokens } from './film-login.js';

// ---------- små hjälpare ----------
const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];
const $$ = (root, sel) => Array.from(root.querySelectorAll(sel));
const $ = (root, sel) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

function debounce(fn, ms = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function lsGet(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

// ---------- API wrapper (tålig mot olika export-namn) ----------
async function callApi(action, params = {}) {
  // Prioritera en exporterad funktion om den finns
  if (typeof Api.api === 'function') return Api.api(action, params);
  if (typeof Api.callApi === 'function') return Api.callApi(action, params);
  if (typeof Api.request === 'function') return Api.request(action, params);

  // Fallback: om api.js exporterar getApiUrl + auth internt – men vi försöker ändå.
  if (typeof Api.apiUrl === 'function') {
    const url = Api.apiUrl(action, params);
    const r = await fetch(url, { cache: 'no-store' });
    return r.json();
  }

  throw new Error('api.js saknar en anropsfunktion (api/callApi/request).');
}

// ---------- Token helpers ----------
function tokens() {
  try { return getMovieTokens() || {}; } catch { return {}; }
}
function tmdbKey() { return tokens()?.tmdb || ''; }
function omdbKey() { return tokens()?.omdb || ''; }
function watchmodeKey() { return tokens()?.watchmode || ''; }

// ---------- TMDb autocomplete ----------
const TMDB_URL = 'https://api.themoviedb.org/3';
async function tmdbSearchMovies(query, limit = 8) {
  const key = tmdbKey();
  if (!key) return [];
  const q = (query || '').trim();
  if (q.length < 3) return [];

  const url = `${TMDB_URL}/search/movie?api_key=${encodeURIComponent(key)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(q)}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => null);
  const res = Array.isArray(j?.results) ? j.results : [];
  return res.slice(0, limit).map(it => ({
    title: it.title || it.original_title || '',
    year: (it.release_date || '').slice(0, 4) || ''
  }));
}

// ---------- OMDb lookup (enkelt) ----------
const OMDB_URL = 'https://www.omdbapi.com/';
async function omdbLookup(query) {
  const key = omdbKey();
  if (!key) return null;
  let q = String(query || '').trim();
  if (!q) return null;

  // stöd: "Titel (ÅÅÅÅ)"
  let year = '';
  const m = q.match(/\((\d{4})\)\s*$/);
  if (m) {
    year = m[1];
    q = q.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  }

  const u = `${OMDB_URL}?apikey=${encodeURIComponent(key)}&t=${encodeURIComponent(q)}${year ? `&y=${encodeURIComponent(year)}` : ''}&type=movie&plot=short`;
  const r = await fetch(u, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || j.Response === 'False') return null;
  return j;
}

function imdbUrl(j) {
  const id = j?.imdbID;
  return id ? `https://www.imdb.com/title/${id}/` : '';
}

// ---------- Watchmode streaming ----------
async function wmTitleIdFromImdb(imdbID) {
  const key = watchmodeKey();
  if (!key || !imdbID) return null;

  // 1) /find
  try {
    const u1 = `https://api.watchmode.com/v1/find/?apiKey=${encodeURIComponent(key)}&source=imdb&external_id=${encodeURIComponent(imdbID)}`;
    let r = await fetch(u1, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j?.title_id) return j.title_id;
    }

    // 2) /search fallback
    const u2 = `https://api.watchmode.com/v1/search/?apiKey=${encodeURIComponent(key)}&search_field=imdb_id&search_value=${encodeURIComponent(imdbID)}`;
    r = await fetch(u2, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const hit = Array.isArray(j?.title_results) ? j.title_results.find(t => String(t.imdb_id) === String(imdbID)) : null;
      if (hit?.id) return hit.id;
    }
  } catch { /* ignore */ }

  return null;
}

async function getStreamingInfo(imdbID) {
  const key = watchmodeKey();
  if (!key || !imdbID) return null;

  // Cache 7 dagar
  const cacheKey = `wm_sources_v1_${imdbID}`;
  const cached = lsGet(cacheKey, null);
  const now = Date.now();
  if (cached?.savedAt && (now - cached.savedAt) < 7 * 24 * 3600_000 && Array.isArray(cached?.data)) {
    return cached.data;
  }

  try {
    const wmId = await wmTitleIdFromImdb(imdbID);
    if (!wmId) return null;

    const url = `https://api.watchmode.com/v1/title/${wmId}/sources/?apiKey=${encodeURIComponent(key)}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data)) return null;

    const seen = new Set();
    const normalizeName = (s) => String(s || '')
      .replace(/\s*\(with Ads\)$/i, '')
      .replace(/\s+HD$/i, '')
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
        const k = `${s.service}|${s.quality}|${s.region}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (a.service + a.region + a.quality).localeCompare(b.service + b.region + b.quality));

    lsSet(cacheKey, { savedAt: now, data: filtered });
    return filtered.length ? filtered : null;
  } catch {
    return null;
  }
}

// ---------- styles (en gång) ----------
function ensureStyles() {
  if (document.getElementById('filmWishlistStyles')) return;
  const s = document.createElement('style');
  s.id = 'filmWishlistStyles';
  s.textContent = `
  /* Wishlist layout */
  .wishlist-head{display:flex; align-items:flex-start; gap:12px; justify-content:space-between}
  .wishlist-head-left{display:flex; flex-direction:column; gap:2px}
  .wishlist-actions{display:flex; gap:10px; align-items:center}

  .wl-list{display:flex; flex-direction:column; gap:12px; margin-top:12px}
  .wl-row{border:1px solid var(--border); background:var(--panel); border-radius:14px; padding:12px}

  .wl-top{display:grid; grid-template-columns: 46px 1fr auto; gap:10px; align-items:center}
  .wl-num{color:var(--muted); font-size:13px; width:46px}

  .wl-inputwrap{position:relative}
  .wl-inputline{display:flex; gap:8px; align-items:center}
  .wl-inputline input{flex:1 1 auto; min-width:0}

  .wl-controls{display:flex; gap:8px; align-items:center}
  .wl-controls button{width:44px; height:44px; padding:0; border-radius:12px; font-size:18px; display:flex; align-items:center; justify-content:center}

  .wl-meta{display:grid; grid-template-columns: 96px 1fr; gap:12px; align-items:start; margin-top:10px}
  .wl-poster{width:96px; height:auto; border-radius:12px; border:1px solid var(--border); display:block}

  .wl-meta-right{display:flex; gap:12px; align-items:flex-start; justify-content:space-between}
  .wl-imdb{min-width:170px}
  .wl-imdb a{color:inherit; text-decoration:underline}

  .wl-stream{margin-left:auto; max-width:520px}
  .wl-stream strong{display:block; font-size:12px; color:var(--muted); margin-bottom:6px}
  .wl-stream-row{display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end}
  /* två rader synliga, resten dolt */
  .wl-stream-row.collapsed{max-height:72px; overflow:hidden}
  .wl-stream-toggle{margin-top:6px; font-size:12px; padding:0; border:none; background:transparent; text-decoration:underline; cursor:pointer; color:var(--muted); float:right}

  /* Autocomplete */
  .ac-list{position:absolute; left:0; right:0; top:100%; z-index:60; background:var(--panel); border:1px solid var(--border); border-radius:12px; margin-top:6px; overflow:hidden}
  .ac-item{padding:10px 12px; cursor:pointer; border-top:1px solid var(--border); font-size:14px}
  .ac-item:first-child{border-top:none}
  .ac-item:hover{filter:brightness(1.05)}
  .ac-muted{color:var(--muted); font-size:12px}

  @media (max-width:640px){
    .wl-meta{grid-template-columns: 84px 1fr}
    .wl-poster{width:84px}
    .wl-meta-right{flex-direction:column; align-items:flex-start}
    .wl-stream{max-width:none}
    .wl-stream-row{justify-content:flex-start}
    .wl-stream-toggle{float:none}
  }
  `;
  document.head.appendChild(s);
}

// ---------- component ----------
class FilmWishlist extends HTMLElement {
  constructor() {
    super();
    this._applying = false;
    this._autoTimer = null;
    this._lastSig = '';
    this._who = '';

    // ✅ ny: skydd mot race conditions i load()
    this._loadSeq = 0;

    // ✅ ny: unsub-lista
    this._unsubs = [];

    // (behåll befintligt debounce-register)
    this._acDebouncers = null;

    // ✅ bindade handlers så vi kan städa
    this._onDocClick = (e) => {
      if (e.target?.closest?.('.wl-inputwrap')) return;
      for (let i = 1; i <= 5; i++) this.hideAc(i);
    };
  }

  connectedCallback() {
    ensureStyles();
    this.render();
    this.bind();
    this.syncWhoFromStore();
    this.load({ useCache: true }).catch(() => this.setNote('Kunde inte hämta önskelista.'));
  }

  disconnectedCallback() {
    for (const u of this._unsubs) {
      try { typeof u === 'function' && u(); } catch { /* ignore */ }
    }
    this._unsubs = [];
    document.removeEventListener('click', this._onDocClick);
    clearTimeout(this._autoTimer);
  }

  render() {
    this.innerHTML = `
      <div class="card" id="wlCard">
        <div class="wishlist-head">
          <div class="wishlist-head-left">
            <h3 style="margin:0">Önskelista</h3>
            <div class="muted" style="font-size:13px">Användare: <span id="wlWho">–</span></div>
          </div>
          <div class="wishlist-actions">
            <button id="wlLoad" class="ghost">Hämta</button>
            <button id="wlSave" class="primary">Spara</button>
          </div>
        </div>

        <div class="wl-list" id="wlList"></div>
        <div class="muted" id="wlNote" style="font-size:12px; margin-top:10px"></div>
      </div>
    `;

    const list = this.querySelector('#wlList');
    const mkRow = (i) => `
      <div class="wl-row" data-i="${i}">
        <div class="wl-top">
          <div class="wl-num">#${i}</div>
          <div class="wl-inputwrap">
            <div class="wl-inputline">
              <input id="wl-${i}" autocomplete="off" spellcheck="false" placeholder="Film (${i})" />
              <button class="ghost" data-search="${i}">Sök</button>
            </div>
            <div class="ac-list" id="ac-wl-${i}" style="display:none"></div>
          </div>
          <div class="wl-controls" aria-label="Ändra ordning">
            <button type="button" class="ghost" data-move="up" data-i="${i}" aria-label="Flytta upp">▲</button>
            <button type="button" class="ghost" data-move="down" data-i="${i}" aria-label="Flytta ner">▼</button>
          </div>
        </div>

        <div class="wl-meta" id="wl-meta-${i}" style="display:none">
          <img class="wl-poster" id="wl-poster-${i}" alt="poster" loading="lazy" decoding="async" />
          <div class="wl-meta-right">
            <div class="wl-imdb" id="wl-imdb-${i}"></div>
            <div class="wl-stream" id="wl-stream-${i}"></div>
          </div>
        </div>
      </div>
    `;

    list.innerHTML = [1, 2, 3, 4, 5].map(mkRow).join('');

    this.updateMoveButtons();
  }

  bind() {
    // Buttons
    this.querySelector('#wlLoad')?.addEventListener('click', () => this.load({ useCache: false }));
    this.querySelector('#wlSave')?.addEventListener('click', () => this.save({ manual: true }));

    // Move
    this.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-move][data-i]');
      if (!btn) return;
      const i = Number(btn.getAttribute('data-i'));
      const dir = btn.getAttribute('data-move');
      if (dir === 'up') this.swap(i, i - 1);
      if (dir === 'down') this.swap(i, i + 1);
    });

    // Search
    this.addEventListener('click', async (e) => {
      const btn = e.target?.closest?.('[data-search]');
      if (!btn) return;
      const i = Number(btn.getAttribute('data-search'));
      await this.lookupAndRender(i, { withStreaming: true });
    });

    // Inputs: autosave lugnt + autocomplete
    for (let i = 1; i <= 5; i++) {
      const inp = this.querySelector(`#wl-${i}`);
      if (!inp) continue;

      inp.addEventListener('input', () => {
        this.scheduleAutoSave('skriver');
        this.scheduleAutocomplete(i);
      });

      inp.addEventListener('blur', () => {
        // stäng autocomplete lite senare så klick hinner
        setTimeout(() => this.hideAc(i), 150);
        this.commitAutoSave('klar');
      });

      inp.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          await this.lookupAndRender(i, { withStreaming: true });
        }
        if (e.key === 'Escape') {
          this.hideAc(i);
        }
      });
    }

    // Klick utanför => stäng autocomplete
    document.addEventListener('click', this._onDocClick);

    // ✅ Store: who (robust)
    // Förväntat: Store.on('who', fn) returnerar unsubscribe (eller inte)
    if (typeof Store.on === 'function') {
      try {
        const unsub = Store.on('who', (who) => this.onWhoChange(who));
        if (typeof unsub === 'function') this._unsubs.push(unsub);
      } catch { /* ignore */ }
    }
  }

  syncWhoFromStore() {
    let who = '';
    if (typeof Store.getWho === 'function') who = Store.getWho();
    else if (typeof Store.getPerson === 'function') who = Store.getPerson();

    if (!PEOPLE.includes(who)) {
      who = lsGet('film_who', 'Lars');
      if (!PEOPLE.includes(who)) who = 'Lars';
    }

    this._who = who;
    const el = this.querySelector('#wlWho');
    if (el) el.textContent = who;
    this._lastSig = this.sig();
  }

  onWhoChange(who) {
    if (!who || who === this._who) return;
    this._who = who;
    const el = this.querySelector('#wlWho');
    if (el) el.textContent = who;
    this._lastSig = this.sig();
    this.load({ useCache: true }).catch(() => this.setNote('Kunde inte hämta önskelista.'));
  }

  setNote(msg) {
    const el = this.querySelector('#wlNote');
    if (el) el.textContent = msg || '';
  }

  // ----- load/save -----
  async load({ useCache = true } = {}) {
    this.setNote('');
    this.syncWhoFromStore();
    const who = this._who;

    // ✅ ny: bump seq och bind "denna load"
    const seq = ++this._loadSeq;

    const cacheKey = `wl_v2_${who}`;
    if (useCache) {
      const cached = lsGet(cacheKey, null);
      if (cached?.data?.ok) {
        // bara applicera om vi fortfarande är “latest”
        if (seq === this._loadSeq && who === this._who) {
          this.applyWishlist(cached.data);
        }
        // fortsätt i bakgrunden
        this.load({ useCache: false }).catch(() => {});
        return;
      }
    }

    const j = await callApi('getWishlist', { person: who });

    // ✅ ignorera om användaren hann bytas eller nyare load startade
    if (seq !== this._loadSeq || who !== this._who) return;

    if (!j?.ok) {
      this.setNote(j?.error || 'Kunde inte hämta önskelista.');
      return;
    }

    lsSet(cacheKey, { savedAt: Date.now(), data: j });
    this.applyWishlist(j);
  }

  applyWishlist(j) {
    this._applying = true;
    for (let i = 1; i <= 5; i++) {
      const inp = this.querySelector(`#wl-${i}`);
      if (inp) inp.value = (j[`R${i}`] || '').trim();
    }
    this._applying = false;

    this._lastSig = this.sig();

    // rendera metadata (inkl streaming) i bakgrunden för befintliga rader
    for (let i = 1; i <= 5; i++) {
      const v = (this.querySelector(`#wl-${i}`)?.value || '').trim();
      if (v) this.lookupAndRender(i, { withStreaming: true }).catch(() => {});
      else this.clearMeta(i);
    }
  }

  async save({ manual = false } = {}) {
    if (this._applying) return;
    this.syncWhoFromStore();

    const who = this._who;
    if (!who) return;

    const btn = this.querySelector('#wlSave');
    const text0 = btn?.textContent || 'Spara';

    const payload = {
      person: who,
      R1: (this.querySelector('#wl-1')?.value || '').trim(),
      R2: (this.querySelector('#wl-2')?.value || '').trim(),
      R3: (this.querySelector('#wl-3')?.value || '').trim(),
      R4: (this.querySelector('#wl-4')?.value || '').trim(),
      R5: (this.querySelector('#wl-5')?.value || '').trim(),
    };

    // cache optimistiskt
    lsSet(`wl_v2_${who}`, { savedAt: Date.now(), data: { ok: true, ...payload } });

    // disable för att undvika dubbeltryck
    if (btn) {
      btn.disabled = true;
      btn.textContent = manual ? 'Sparar…' : 'Autosparar…';
    }

    try {
      const j = await callApi('saveWishlist', payload);
      if (!j?.ok) throw new Error(j?.error || 'saveWishlist');
      this._lastSig = this.sig();
      this.setNote(manual ? 'Sparad.' : '');
    } catch (e) {
      this.setNote('Kunde inte spara – prova igen.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = text0;
      }
    }
  }

  // ----- autosave -----
  sig() {
    const who = this._who || '';
    const v = (i) => (this.querySelector(`#wl-${i}`)?.value || '').trim();
    return [who, v(1), v(2), v(3), v(4), v(5)].join('␟');
  }

  scheduleAutoSave(reason = '') {
    if (this._applying) return;
    clearTimeout(this._autoTimer);
    this._autoTimer = setTimeout(() => this.commitAutoSave(reason), 1600);
  }

  commitAutoSave(reason = '') {
    if (this._applying) return;
    const s = this.sig();
    if (!s || s === this._lastSig) return;

    // undvik autosave om allt tomt
    const parts = s.split('␟').slice(1);
    const hasAny = parts.some(x => x && x.length);
    if (!hasAny) return;

    // spara tyst
    this.save({ manual: false });
  }

  // ----- reorder -----
  updateMoveButtons() {
    for (let i = 1; i <= 5; i++) {
      const up = this.querySelector(`[data-move="up"][data-i="${i}"]`);
      const down = this.querySelector(`[data-move="down"][data-i="${i}"]`);
      if (up) up.disabled = i === 1;
      if (down) down.disabled = i === 5;
    }
  }

  swap(i, j) {
    if (i < 1 || i > 5 || j < 1 || j > 5) return;
    const a = this.querySelector(`#wl-${i}`);
    const b = this.querySelector(`#wl-${j}`);
    if (!a || !b) return;

    this._applying = true;
    const tmp = a.value;
    a.value = b.value;
    b.value = tmp;
    this._applying = false;

    // rendera om meta för båda
    const va = a.value.trim();
    const vb = b.value.trim();
    if (va) this.lookupAndRender(i, { withStreaming: true }).catch(() => {}); else this.clearMeta(i);
    if (vb) this.lookupAndRender(j, { withStreaming: true }).catch(() => {}); else this.clearMeta(j);

    // autospara ordning lugnt
    this.scheduleAutoSave('ordning');
  }

  // ----- meta rendering -----
  clearMeta(i) {
    const box = this.querySelector(`#wl-meta-${i}`);
    if (box) box.style.display = 'none';
    const imdb = this.querySelector(`#wl-imdb-${i}`);
    const stream = this.querySelector(`#wl-stream-${i}`);
    if (imdb) imdb.innerHTML = '';
    if (stream) stream.innerHTML = '';
  }

  async lookupAndRender(i, { withStreaming = true } = {}) {
    const q = (this.querySelector(`#wl-${i}`)?.value || '').trim();
    if (!q) {
      this.clearMeta(i);
      return;
    }

    // OMDb (och liten cache per query)
    const qKey = `omdb_v1_${q.toLowerCase()}`;
    let data = lsGet(qKey, null);
    if (!data) {
      data = await omdbLookup(q);
      lsSet(qKey, data);
    }

    const box = this.querySelector(`#wl-meta-${i}`);
    if (!box) return;

    if (!data) {
      // visa bara text
      box.style.display = 'grid';
      const poster = this.querySelector(`#wl-poster-${i}`);
      if (poster) poster.style.display = 'none';
      const imdb = this.querySelector(`#wl-imdb-${i}`);
      const stream = this.querySelector(`#wl-stream-${i}`);
      if (imdb) imdb.innerHTML = `<div class="muted">Hittade inget för: ${esc(q)}</div>`;
      if (stream) stream.innerHTML = '';
      return;
    }

    // poster
    const poster = this.querySelector(`#wl-poster-${i}`);
    const hasPoster = data.Poster && data.Poster !== 'N/A';
    if (poster) {
      poster.src = hasPoster ? data.Poster : '';
      poster.style.display = hasPoster ? 'block' : 'none';
    }

    // imdb block
    const imdb = this.querySelector(`#wl-imdb-${i}`);
    const title = esc(data.Title || q);
    const year = esc(data.Year || '');
    const rating = esc(data.imdbRating || '–');
    const link = imdbUrl(data);

    if (imdb) {
      imdb.innerHTML = `
        <div style="font-weight:700; font-size:16px">${title}${year ? ` (${year})` : ''}</div>
        <div>IMDb ${rating}${link ? ` — <a href="${link}" target="_blank" rel="noopener">Öppna på IMDb</a>` : ''}</div>
      `;
    }

    // streaming block (höger sida)
    const stream = this.querySelector(`#wl-stream-${i}`);
    if (stream) {
      if (!withStreaming || !data.imdbID || !watchmodeKey()) {
        stream.innerHTML = '';
      } else {
        stream.innerHTML = `<strong>Tillgängligt i abonnemang (globalt):</strong><div class="muted" style="font-size:12px">hämtar…</div>`;
        const options = await getStreamingInfo(data.imdbID);
        stream.innerHTML = this.renderStreaming(options);
      }
    }

    box.style.display = 'grid';
  }

  renderStreaming(options) {
    if (!options || !options.length) {
      return `<strong>Tillgängligt i abonnemang (globalt):</strong><div class="muted" style="font-size:12px">Inget abonnemang hittades just nu.</div>`;
    }

    const pills = options.map(opt => {
      const label = [
        opt.service,
        opt.quality ? ` ${opt.quality}` : '',
        opt.region ? ` · ${opt.region}` : ''
      ].join('');
      const href = opt.link ? `href="${opt.link}" target="_blank" rel="noopener"` : '';
      return `<a ${href} class="pill" style="text-decoration:none">${esc(label)} (ingår)</a>`;
    }).join('');

    const uid = `wl_stream_${Math.random().toString(16).slice(2)}`;

    queueMicrotask(() => {
      const host = this.querySelector(`[data-stream-uid="${uid}"]`);
      if (!host) return;
      const row = host.querySelector('.wl-stream-row');
      const btn = host.querySelector('.wl-stream-toggle');
      if (!row || !btn) return;

      const update = () => {
        const needs = row.scrollHeight > row.clientHeight + 2;
        btn.style.display = needs ? 'inline-block' : 'none';
        btn.textContent = row.classList.contains('collapsed') ? '…' : 'visa färre';
      };

      update();
      btn.addEventListener('click', () => {
        row.classList.toggle('collapsed');
        update();
      });

      setTimeout(update, 60);
    });

    return `
      <div data-stream-uid="${uid}">
        <strong>Tillgängligt i abonnemang (globalt):</strong>
        <div class="wl-stream-row collapsed">${pills}</div>
        <button type="button" class="wl-stream-toggle" style="display:none">…</button>
      </div>
    `;
  }

  // ----- autocomplete UI -----
  scheduleAutocomplete(i) {
    const input = this.querySelector(`#wl-${i}`);
    if (!input) return;
    if (document.activeElement !== input) return;

    if (!this._acDebouncers) this._acDebouncers = {};
    if (!this._acDebouncers[i]) {
      this._acDebouncers[i] = debounce(async () => {
        const q = (input.value || '').trim();
        if (q.length < 3) { this.hideAc(i); return; }
        const hits = await tmdbSearchMovies(q, 8);
        if (document.activeElement !== input) return;
        this.showAc(i, hits);
      }, 420);
    }
    this._acDebouncers[i]();
  }

  hideAc(i) {
    const box = this.querySelector(`#ac-wl-${i}`);
    if (!box) return;
    box.style.display = 'none';
    box.innerHTML = '';
  }

  showAc(i, items) {
    const box = this.querySelector(`#ac-wl-${i}`);
    const input = this.querySelector(`#wl-${i}`);
    if (!box || !input) return;

    if (!items || !items.length) {
      this.hideAc(i);
      return;
    }

    box.innerHTML = items.map((x, idx) => `
      <div class="ac-item" data-i="${idx}">
        <div><strong>${esc(x.title)}</strong> <span class="ac-muted">${esc(x.year)}</span></div>
      </div>
    `).join('');
    box.style.display = 'block';

    $$(box, '.ac-item').forEach(el => {
      const pick = (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        const idx = Number(el.getAttribute('data-i'));
        const it = items[idx];
        input.value = it.year ? `${it.title} (${it.year})` : it.title;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        this.hideAc(i);
        this.lookupAndRender(i, { withStreaming: true }).catch(() => {});
      };

      el.addEventListener('pointerdown', pick, { passive: false });
      el.addEventListener('touchstart', pick, { passive: false });
      el.addEventListener('click', pick);
    });
  }
}

customElements.define('film-wishlist', FilmWishlist);