// film-wishlist.js
// Wishlist module ("Önskelista") – shows 1–5 upcoming picks for the logged-in user.
// Includes:
// - Autocomplete (TMDb) while typing
// - Poster thumbnail + IMDb link
// - Streaming availability (Watchmode) shown to the right (2 rows visible, expandable)
// - Reorder (up/down)
// - Calm autosave + explicit Save button

import { getWho, setWho, on as onStore, getAuth } from './store.js';
import { getApiUrl, getMovieTokens } from './film-login.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];

// --- tiny utils ---
const $ = (root, sel) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));
const normKey = (s) => String(s || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    p.set(k, String(v));
  });
  return p.toString();
}

async function api(action, params = {}) {
  const url = getApiUrl();
  const auth = getAuth();
  const query = qs({
    action,
    pw: auth?.pw || '',
    token: auth?.token || '',
    ...params,
  });
  const res = await fetch(`${url}?${query}`, { cache: 'no-store' });
  return res.json();
}

// --- external providers ---
function tokens() {
  // film-login.js is source-of-truth
  return getMovieTokens();
}

async function tmdbSearch(q, limit = 7) {
  const { tmdb } = tokens();
  if (!tmdb || !q) return [];
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(tmdb)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(q)}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json();
  const arr = Array.isArray(j?.results) ? j.results : [];
  return arr.slice(0, limit).map((it) => ({
    title: it.title || it.original_title || '',
    year: (it.release_date || '').slice(0, 4) || '',
  }));
}

async function omdbLookupTitle(q) {
  const { omdb } = tokens();
  if (!omdb || !q) return null;

  let title = String(q).trim();
  let year = '';
  const m = title.match(/\((\d{4})\)\s*$/);
  if (m) {
    year = m[1];
    title = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  }

  // If user pasted IMDb id/url
  const tt = (q.match(/tt\d{7,}/i) || q.match(/imdb\.com\/title\/(tt\d+)/i));
  if (tt) {
    const id = (tt[1] || tt[0]).replace(/^.*(tt\d+).*$/, '$1');
    const u = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&i=${encodeURIComponent(id)}&plot=short`;
    const r = await fetch(u, { cache: 'no-store' }).catch(() => null);
    const j = r ? await r.json() : null;
    if (j && j.Response !== 'False') return j;
    return null;
  }

  // Try direct title
  {
    const u = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&t=${encodeURIComponent(title)}${year ? `&y=${encodeURIComponent(year)}` : ''}&type=movie&plot=short`;
    const r = await fetch(u, { cache: 'no-store' }).catch(() => null);
    const j = r ? await r.json() : null;
    if (j && j.Response !== 'False') return j;
  }

  // Try search list then pick first
  {
    const u = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&s=${encodeURIComponent(title)}&type=movie`;
    const r = await fetch(u, { cache: 'no-store' }).catch(() => null);
    const j = r ? await r.json() : null;
    const hit = j?.Search?.[0];
    if (hit?.Title) return omdbLookupTitle(`${hit.Title} (${hit.Year || ''})`);
  }

  return null;
}

function imdbUrl(imdbID) {
  return imdbID ? `https://www.imdb.com/title/${imdbID}/` : '';
}

// --- Watchmode (streaming) with local cache ---
const WM_CACHE_PREFIX = 'filmkvall_wm_sources_v2_';

function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function cacheSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { }
}

async function watchmodeTitleIdFromImdb(imdbID) {
  const { watchmode } = tokens();
  if (!watchmode || !imdbID) return null;

  // Prefer /find
  try {
    const u1 = `https://api.watchmode.com/v1/find/?apiKey=${encodeURIComponent(watchmode)}&source=imdb&external_id=${encodeURIComponent(imdbID)}`;
    const r1 = await fetch(u1, { cache: 'no-store' }).catch(() => null);
    const j1 = r1 ? await r1.json() : null;
    if (j1?.title_id) return j1.title_id;
  } catch { }

  // Fallback search
  try {
    const u2 = `https://api.watchmode.com/v1/search/?apiKey=${encodeURIComponent(watchmode)}&search_field=imdb_id&search_value=${encodeURIComponent(imdbID)}`;
    const r2 = await fetch(u2, { cache: 'no-store' }).catch(() => null);
    const j2 = r2 ? await r2.json() : null;
    const hit = Array.isArray(j2?.title_results)
      ? j2.title_results.find((t) => String(t.imdb_id) === String(imdbID))
      : null;
    return hit?.id || null;
  } catch {
    return null;
  }
}

async function getStreamingSources(imdbID) {
  if (!imdbID) return null;
  const { watchmode } = tokens();
  if (!watchmode) return null;

  const ck = WM_CACHE_PREFIX + imdbID;
  const cached = cacheGet(ck);
  const now = Date.now();
  if (cached?.data && cached?.savedAt && (now - cached.savedAt) < 7 * 24 * 3600_000) {
    return cached.data;
  }

  const titleId = await watchmodeTitleIdFromImdb(imdbID);
  if (!titleId) {
    cacheSet(ck, { savedAt: now, data: null });
    return null;
  }

  const url = `https://api.watchmode.com/v1/title/${encodeURIComponent(titleId)}/sources/?apiKey=${encodeURIComponent(watchmode)}`;
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  const arr = res ? await res.json() : null;
  if (!Array.isArray(arr)) {
    cacheSet(ck, { savedAt: now, data: null });
    return null;
  }

  const normalizeName = (s) => String(s || '')
    .replace(/\s*\(with Ads\)$/i, '')
    .replace(/\s+HD$/, '')
    .trim();

  const seen = new Set();
  const filtered = arr
    .filter((s) => s?.type === 'sub' && s?.name)
    .map((s) => ({
      service: normalizeName(s.name),
      quality: (s.format === '4K' || s.format === 'HD') ? s.format : '',
      region: s.region || '',
      link: s.web_url || '',
    }))
    .filter((s) => {
      const k = `${s.service}|${s.quality}|${s.region}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.service + a.region + a.quality).localeCompare(b.service + b.region + b.quality));

  const data = filtered.length ? filtered : null;
  cacheSet(ck, { savedAt: now, data });
  return data;
}

function renderStreamingPills(sources = [], collapsed = true) {
  if (!sources || !sources.length) {
    return `<div class="stream-empty">(ingen streaming hittad)</div>`;
  }
  const pills = sources.map((s) => {
    const label = `${s.service}${s.quality ? ` ${s.quality}` : ''}${s.region ? ` · ${s.region}` : ''}`;
    const href = s.link ? `href="${esc(s.link)}" target="_blank" rel="noopener"` : '';
    return `<a class="pill" ${href}>${esc(label)} (ingår)</a>`;
  }).join('');

  return `
    <div class="stream-wrap">
      <div class="stream-title">Tillgängligt i abonnemang:</div>
      <div class="stream-row ${collapsed ? 'collapsed' : ''}">${pills}</div>
      <button type="button" class="stream-toggle" style="display:none">…</button>
    </div>
  `;
}

function installStreamingToggle(container) {
  const row = container.querySelector('.stream-row');
  const btn = container.querySelector('.stream-toggle');
  if (!row || !btn) return;

  const update = () => {
    requestAnimationFrame(() => {
      const needs = row.scrollHeight > row.clientHeight + 2;
      btn.style.display = needs ? 'inline-block' : 'none';
      btn.textContent = row.classList.contains('collapsed') ? '…' : 'visa färre';
    });
  };

  update();
  btn.addEventListener('click', () => {
    row.classList.toggle('collapsed');
    btn.textContent = row.classList.contains('collapsed') ? '…' : 'visa färre';
  });
}

// --- Component ---
class FilmWishlist extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._autoTimer = null;
    this._busySave = false;
    this._busyLoad = false;
    this._rows = [1, 2, 3, 4, 5];
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = this.render();
    this.bind();
    this.syncWhoLabel();
    this.load({ quiet: true });

    // Keep label and optionally reload when login changes user
    this._unsubWho = onStore('who', () => {
      this.syncWhoLabel();
      this.load({ quiet: true });
    });
  }

  disconnectedCallback() {
    this._unsubWho?.();
  }

  render() {
    return `
      <style>
        :host{display:block}
        .card{background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; margin:14px 0}
        h3{margin:0 0 6px}
        .sub{color:var(--muted); font-size:13px; margin-bottom:10px}
        .rowTop{display:flex; align-items:center; gap:10px}
        .spacer{flex:1}
        button{background:var(--btn); color:var(--btn-text); cursor:pointer; border:1px solid var(--border); padding:8px 12px; border-radius:999px; font-size:14px; touch-action:manipulation}
        button.primary{background:var(--accent); color:#1b1f2a; border-color:#c8a73a; font-weight:600}
        button:disabled{opacity:.55; cursor:not-allowed; filter:saturate(.6)}

        .list{display:flex; flex-direction:column; gap:12px; margin-top:12px}

        .item{border:1px solid var(--border); border-radius:12px; padding:12px}
        .head{display:flex; align-items:center; gap:10px}
        .idx{min-width:28px; color:var(--muted); font-size:13px}
        .inputWrap{flex:1; position:relative}
        input{width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--input); color:var(--text); outline:none}

        .btnSok{border-radius:999px; padding:8px 12px}
        .move{display:flex; gap:8px}
        .move button{width:40px; height:40px; padding:0; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:18px; line-height:1}

        /* Autocomplete */
        .ac{position:absolute; left:0; right:0; top:calc(100% + 6px); z-index:50; background:var(--panel); border:1px solid var(--border); border-radius:10px; overflow:hidden; display:none}
        .acItem{padding:10px 12px; cursor:pointer; border-top:1px solid var(--border); font-size:14px}
        .acItem:first-child{border-top:none}
        .acItem:hover{filter:brightness(1.08)}
        .acMuted{color:var(--muted); font-size:12px}

        /* Meta row: thumbnail left, imdb/title middle, streaming right */
        .metaRow{display:flex; gap:12px; margin-top:10px; align-items:flex-start}
        .poster{width:88px; height:auto; border-radius:10px; border:1px solid var(--border); background:var(--pill-bg)}
        .metaMid{flex:1; min-width:160px}
        .title{font-weight:700; margin:2px 0 4px}
        .imdb a{color:inherit; text-decoration:underline}

        .metaRight{flex:1; min-width:220px; display:flex; justify-content:flex-end}

        .pill{display:inline-block; padding:6px 10px; border-radius:999px; font-size:13px; background:var(--pill-bg); border:1px solid var(--border); text-decoration:none; color:inherit; white-space:nowrap}
        .stream-wrap{min-width:220px; max-width:420px}
        .stream-title{color:var(--muted); font-size:12px; margin-bottom:6px}
        .stream-row{display:flex; flex-wrap:wrap; gap:6px}
        /* show ~2 rows */
        .stream-row.collapsed{max-height:68px; overflow:hidden}
        .stream-toggle{margin-top:6px; font-size:12px; padding:0; border:none; background:transparent; text-decoration:underline; cursor:pointer; color:var(--muted)}
        .stream-empty{color:var(--muted); font-size:12px}

        @media (max-width:720px){
          .metaRow{flex-direction:column}
          .metaRight{justify-content:flex-start}
          .stream-wrap{max-width:100%}
        }
      </style>

      <div class="card">
        <div class="rowTop">
          <div>
            <h3>Önskelista</h3>
            <div class="sub">Användare: <strong id="whoLabel">–</strong></div>
          </div>
          <span class="spacer"></span>
          <button id="btnLoad" type="button">Hämta</button>
          <button id="btnSave" type="button" class="primary">Spara</button>
        </div>

        <div class="list">
          ${this._rows.map((i) => this.renderItem(i)).join('')}
        </div>
      </div>
    `;
  }

  renderItem(i) {
    return `
      <div class="item" data-i="${i}">
        <div class="head">
          <div class="idx">#${i}</div>
          <div class="inputWrap">
            <input id="w${i}" placeholder="Film (${i})" autocomplete="off" spellcheck="false" />
            <div class="ac" id="ac-w${i}"></div>
          </div>
          <button class="btnSok" type="button" data-lookup="w${i}">Sök</button>
          <div class="move" aria-label="Flytta">
            <button type="button" class="ghost" data-move="up" data-i="${i}" aria-label="Flytta upp" ${i === 1 ? 'disabled' : ''}>▲</button>
            <button type="button" class="ghost" data-move="down" data-i="${i}" aria-label="Flytta ner" ${i === 5 ? 'disabled' : ''}>▼</button>
          </div>
        </div>

        <div class="metaRow" id="meta-w${i}" style="display:none"></div>
      </div>
    `;
  }

  bind() {
    const root = this.shadowRoot;

    // Buttons
    $('#btnLoad', root).addEventListener('click', () => this.load({ quiet: false }));
    $('#btnSave', root).addEventListener('click', () => this.save({ reason: 'manuell' }));

    // Search buttons
    root.querySelectorAll('[data-lookup]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-lookup');
        await this.lookupAndRender(id);
      });
    });

    // Reorder
    root.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-move][data-i]');
      if (!btn) return;
      const i = Number(btn.getAttribute('data-i'));
      const dir = btn.getAttribute('data-move');
      if (dir === 'up' && i > 1) this.swap(i, i - 1);
      if (dir === 'down' && i < 5) this.swap(i, i + 1);
    });

    // Autocomplete + autosave
    this._rows.forEach((i) => {
      const input = $(`#w${i}`, root);
      this.bindAutocomplete(`w${i}`, input);
      input.addEventListener('input', () => this.scheduleAutosave());
      input.addEventListener('blur', () => this.commitAutosave('klar'));
      input.addEventListener('change', () => this.lookupAndRender(`w${i}`));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.lookupAndRender(`w${i}`);
        }
      });
    });

    // Close autocomplete if click outside
    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('.inputWrap')) return;
      this._rows.forEach((i) => this.hideAc(`w${i}`));
    });
  }

  syncWhoLabel() {
    const who = getWho();
    const root = this.shadowRoot;
    $('#whoLabel', root).textContent = who || '–';
  }

  values() {
    const root = this.shadowRoot;
    const v = {};
    this._rows.forEach((i) => { v[`R${i}`] = $(`#w${i}`, root).value || ''; });
    return v;
  }

  setValues(obj = {}) {
    const root = this.shadowRoot;
    this._rows.forEach((i) => {
      const el = $(`#w${i}`, root);
      el.value = (obj[`R${i}`] ?? '').toString();
    });
  }

  signature(who) {
    const v = this.values();
    return [who, v.R1, v.R2, v.R3, v.R4, v.R5].map(normKey).join('␟');
  }

  scheduleAutosave() {
    clearTimeout(this._autoTimer);
    this._autoTimer = setTimeout(() => this.commitAutosave('skriver'), 1400);
  }

  async commitAutosave(reason) {
    const who = getWho();
    if (!who) return;

    const sig = this.signature(who);
    const last = this._lastSigByWho || {};
    if (last[who] === sig) return;

    // Avoid autosaving completely empty lists
    const any = sig.split('␟').slice(1).some((x) => x && x.length);
    if (!any) return;

    last[who] = sig;
    this._lastSigByWho = last;

    // autosave should feel calm – no button flashing
    await this.save({ reason, quiet: true });
  }

  async load({ quiet } = { quiet: false }) {
    if (this._busyLoad) return;
    this._busyLoad = true;

    const root = this.shadowRoot;
    const btn = $('#btnLoad', root);
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = 'Hämtar…';

    try {
      const who = getWho() || 'Lars';
      if (!PEOPLE.includes(who)) setWho('Lars');

      const j = await api('getWishlist', { person: who });
      if (!j?.ok) throw new Error(j?.error || 'getWishlist');

      this.setValues(j);

      // update sig so autosave doesn't immediately trigger
      const sig = this.signature(who);
      this._lastSigByWho = { ...(this._lastSigByWho || {}), [who]: sig };

      // Render metas (including streaming) – in parallel but calmly
      await Promise.allSettled(this._rows.map((i) => this.lookupAndRender(`w${i}`, { lazyStreaming: true })));
    } catch (e) {
      if (!quiet) console.error('wishlist load:', e);
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
      this._busyLoad = false;
    }
  }

  async save({ reason = '', quiet = false } = {}) {
    if (this._busySave) return;
    this._busySave = true;

    const root = this.shadowRoot;
    const btn = $('#btnSave', root);
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sparar…';

    try {
      const who = getWho();
      const v = this.values();
      const payload = { person: who, ...v };
      const j = await api('saveWishlist', payload);
      if (!j?.ok) throw new Error(j?.error || 'saveWishlist');

      // update sig baseline
      this._lastSigByWho = { ...(this._lastSigByWho || {}), [who]: this.signature(who) };

      // small UX: return label
      btn.textContent = 'Sparad';
      setTimeout(() => { btn.textContent = oldText; }, 900);
    } catch (e) {
      if (!quiet) console.error('wishlist save:', e);
      btn.textContent = 'Fel';
      setTimeout(() => { btn.textContent = oldText; }, 900);
    } finally {
      setTimeout(() => { btn.disabled = false; this._busySave = false; }, 250);
    }
  }

  swap(i, j) {
    const root = this.shadowRoot;
    const a = $(`#w${i}`, root);
    const b = $(`#w${j}`, root);
    const tmp = a.value;
    a.value = b.value;
    b.value = tmp;

    // Re-render metas for the swapped rows
    this.lookupAndRender(`w${i}`, { lazyStreaming: true });
    this.lookupAndRender(`w${j}`, { lazyStreaming: true });

    // autosave after reorder
    this.scheduleAutosave();
  }

  async lookupAndRender(id, { lazyStreaming = false } = {}) {
    const root = this.shadowRoot;
    const input = $(`#${id}`, root);
    if (!input) return;

    const q = (input.value || '').trim();
    const meta = $(`#meta-${id}`, root);
    if (!meta) return;

    if (!q) {
      meta.style.display = 'none';
      meta.innerHTML = '';
      return;
    }

    // OMDb
    const data = await omdbLookupTitle(q);
    if (!data) {
      meta.style.display = 'block';
      meta.innerHTML = `<div class="metaMid" style="color:var(--muted)">Hittade inget för: ${esc(q)}</div>`;
      return;
    }

    const title = `${data.Title || ''}${data.Year ? ` (${data.Year})` : ''}`;
    const poster = (data.Poster && data.Poster !== 'N/A') ? data.Poster : '';
    const imdbID = data.imdbID || '';

    // Streaming: show cached immediately if available, else lazy button that fetches
    const cacheKey = WM_CACHE_PREFIX + imdbID;
    const cached = imdbID ? (cacheGet(cacheKey)?.data || null) : null;

    const leftPoster = poster
      ? `<img class="poster" src="${esc(poster)}" alt="poster" loading="lazy" decoding="async">`
      : `<div class="poster" aria-hidden="true"></div>`;

    const mid = `
      <div class="metaMid">
        <div class="title">${esc(title)}</div>
        <div class="imdb">
          IMDb ${esc(data.imdbRating || '–')}
          ${imdbID ? ` — <a href="${esc(imdbUrl(imdbID))}" target="_blank" rel="noopener">Öppna på IMDb</a>` : ''}
        </div>
      </div>
    `;

    let right = '';

    if (imdbID) {
      if (cached) {
        right = `<div class="metaRight">${renderStreamingPills(cached, true)}</div>`;
      } else {
        // If lazyStreaming: don't fetch immediately; show the small toggle (…)
        right = `
          <div class="metaRight">
            <div class="stream-wrap" data-imdb="${esc(imdbID)}">
              <div class="stream-title">Tillgängligt i abonnemang:</div>
              <div class="stream-empty">(klicka … för att hämta)</div>
              <button type="button" class="stream-toggle" style="display:inline-block">…</button>
            </div>
          </div>
        `;
      }
    }

    meta.innerHTML = `${leftPoster}${mid}${right}`;
    meta.style.display = 'flex';

    // If we rendered cached pills, install expand toggle
    installStreamingToggle(meta);

    // Lazy fetch: attach handler if we are in "click to fetch" state
    const wrap = meta.querySelector('.stream-wrap');
    const btn = meta.querySelector('.stream-toggle');
    if (wrap && btn && !meta.querySelector('.stream-row')) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'hämtar…';
        const imdb = wrap.getAttribute('data-imdb') || '';
        const sources = await getStreamingSources(imdb);
        wrap.innerHTML = renderStreamingPills(sources || [], true);
        // after replacing, restore a real toggle and measure
        const newBtn = wrap.querySelector('.stream-toggle');
        const row = wrap.querySelector('.stream-row');
        if (newBtn && row) {
          newBtn.style.display = 'inline-block';
          installStreamingToggle(wrap);
        }
      }, { once: true });

      // Optional: if not lazyStreaming (e.g. user pressed "Sök"), fetch immediately
      if (!lazyStreaming) {
        btn.click();
      }
    }
  }

  // --- Autocomplete ---
  hideAc(id) {
    const box = this.shadowRoot.getElementById(`ac-${id}`);
    if (!box) return;
    box.style.display = 'none';
    box.innerHTML = '';
  }

  showAc(id, items, onPick) {
    const box = this.shadowRoot.getElementById(`ac-${id}`);
    if (!box) return;

    if (!items.length) {
      this.hideAc(id);
      return;
    }

    box.innerHTML = items.map((x, idx) => `
      <div class="acItem" data-i="${idx}">
        <div><strong>${esc(x.title)}</strong> <span class="acMuted">${esc(x.year)}</span></div>
      </div>
    `).join('');

    box.style.display = 'block';

    box.querySelectorAll('.acItem').forEach((el) => {
      const pick = (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        const i = Number(el.getAttribute('data-i'));
        onPick(items[i]);
        this.hideAc(id);
      };
      el.addEventListener('pointerdown', pick, { passive: false });
      el.addEventListener('touchstart', pick, { passive: false });
      el.addEventListener('click', pick);
    });
  }

  bindAutocomplete(id, input) {
    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });

    const debounced = this.debounce(async () => {
      if (composing) return;
      if (this.shadowRoot.activeElement !== input) return;

      const q = (input.value || '').trim();
      if (q.length < 3) { this.hideAc(id); return; }

      const hits = await tmdbSearch(q, 7);
      if (this.shadowRoot.activeElement !== input) return;

      this.showAc(id, hits, (pick) => {
        input.value = pick.year ? `${pick.title} (${pick.year})` : pick.title;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }, 420);

    input.addEventListener('input', debounced);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hideAc(id); });
    input.addEventListener('blur', () => setTimeout(() => this.hideAc(id), 150));
  }

  debounce(fn, ms = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
}

customElements.define('film-wishlist', FilmWishlist);
