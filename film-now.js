// film-now.js
// <film-now> = blocket "På tur nu" (förslag + preview + streaming + poäng + spara/skip)

import { api } from './api.js';
import { getWho, on as onStore } from './store.js';
import { getMovieTokens } from './film-login.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];

// -------------------- utils --------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

function debounce(fn, ms = 320) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function imdbUrlFrom(j) {
  return j?.imdbID ? `https://www.imdb.com/title/${j.imdbID}/` : '';
}

function tokens() {
  const t = (typeof getMovieTokens === 'function' ? getMovieTokens() : {}) || {};
  return {
    tmdb: t.tmdb || '',
    omdb: t.omdb || '',
    watchmode: t.watchmode || ''
  };
}

function emptyScoresPayload() {
  return Object.fromEntries(PEOPLE.map((p) => [p, '']));
}

// -------------------- TMDb autocomplete --------------------
async function tmdbSearchMovies(query, limit = 8) {
  const { tmdb } = tokens();
  if (!tmdb || !query) return [];

  const url =
    `https://api.themoviedb.org/3/search/movie` +
    `?api_key=${encodeURIComponent(tmdb)}` +
    `&language=sv-SE&include_adult=false` +
    `&query=${encodeURIComponent(query)}`;

  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => null);
  const res = Array.isArray(j?.results) ? j.results : [];
  return res.slice(0, limit).map((it) => ({
    title: it.title || it.original_title || '',
    year: (it.release_date || '').slice(0, 4) || ''
  }));
}

// -------------------- OMDb / Smart lookup --------------------
async function omdbLookup(query) {
  const { omdb } = tokens();
  if (!omdb || !query) return null;

  let q = query.trim();
  let year = '';
  const mYear = q.match(/\((\d{4})\)\s*$/);
  if (mYear) {
    year = mYear[1];
    q = q.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  }

  // imdb id?
  const tt = q.match(/\btt\d{7,}\b/i) || q.match(/imdb\.com\/title\/(tt\d+)/i);
  if (tt) {
    const id = (tt[1] || tt[0]).toLowerCase();
    const r = await fetch(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&i=${encodeURIComponent(id)}&plot=short`,
      { cache: 'no-store' }
    ).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (j && j.Response !== 'False') return j;
    return null;
  }

  // title exact
  {
    const r = await fetch(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&t=${encodeURIComponent(q)}${year ? `&y=${encodeURIComponent(year)}` : ''}&type=movie&plot=short`,
      { cache: 'no-store' }
    ).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (j && j.Response !== 'False') return j;
  }

  // search fallback
  {
    const r = await fetch(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&s=${encodeURIComponent(q)}&type=movie`,
      { cache: 'no-store' }
    ).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (j && j.Response !== 'False' && Array.isArray(j.Search) && j.Search.length) {
      const hit = j.Search[0];
      return omdbLookup(`${hit.Title} (${hit.Year})`);
    }
  }

  return null;
}

// TMDb först för bättre träffar, men OMDb för poster/rating.
async function smartLookup(query) {
  const q = (query || '').trim();
  if (!q) return null;

  // imdb-id/länk: gå direkt OMDb
  if (/\btt\d{7,}\b/i.test(q) || /imdb\.com\/title\//i.test(q)) {
    return omdbLookup(q);
  }

  const hits = await tmdbSearchMovies(q, 1);
  if (hits?.length) {
    const h = hits[0];
    const om = await omdbLookup(h.year ? `${h.title} (${h.year})` : h.title);
    if (om) return om;
  }

  return omdbLookup(q);
}

// -------------------- Watchmode streaming --------------------
const wmIdCache = new Map();
async function wmTitleIdFromImdb(imdbID) {
  const { watchmode } = tokens();
  if (!watchmode || !imdbID) return null;
  if (wmIdCache.has(imdbID)) return wmIdCache.get(imdbID);

  try {
    const u1 = `https://api.watchmode.com/v1/find/?apiKey=${encodeURIComponent(watchmode)}&source=imdb&external_id=${encodeURIComponent(imdbID)}`;
    const r1 = await fetch(u1, { cache: 'no-store' }).catch(() => null);
    if (r1 && r1.ok) {
      const j1 = await r1.json().catch(() => null);
      if (j1?.title_id) {
        wmIdCache.set(imdbID, j1.title_id);
        return j1.title_id;
      }
    }

    const u2 = `https://api.watchmode.com/v1/search/?apiKey=${encodeURIComponent(watchmode)}&search_field=imdb_id&search_value=${encodeURIComponent(imdbID)}`;
    const r2 = await fetch(u2, { cache: 'no-store' }).catch(() => null);
    if (r2 && r2.ok) {
      const j2 = await r2.json().catch(() => null);
      const hit = Array.isArray(j2?.title_results)
        ? j2.title_results.find((t) => String(t.imdb_id) === String(imdbID))
        : null;
      if (hit?.id) {
        wmIdCache.set(imdbID, hit.id);
        return hit.id;
      }
    }
  } catch (_) {}

  return null;
}

async function getStreamingInfo(imdbID) {
  const { watchmode } = tokens();
  if (!watchmode || !imdbID) return null;

  const key = `wm_sources_v1_${imdbID}`;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached?.savedAt && (Date.now() - cached.savedAt) < 7 * 24 * 3600_000) {
      return cached.data || null;
    }
  } catch (_) {}

  const wmId = await wmTitleIdFromImdb(imdbID);
  if (!wmId) return null;

  const url = `https://api.watchmode.com/v1/title/${wmId}/sources/?apiKey=${encodeURIComponent(watchmode)}`;
  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;

  const data = await r.json().catch(() => null);
  if (!Array.isArray(data)) return null;

  const seen = new Set();
  const normalizeName = (s) => String(s || '').replace(/\s*\(with Ads\)$/i, '').trim();

  const out = data
    .filter((s) => s.type === 'sub' && s.name)
    .map((s) => ({
      service: normalizeName(s.name),
      region: s.region || '',
      quality: (s.format === '4K' || s.format === 'HD') ? s.format : '',
      link: s.web_url || ''
    }))
    .filter((s) => {
      const k = `${s.service}|${s.region}|${s.quality}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.service + a.region + a.quality).localeCompare(b.service + b.region + b.quality));

  const result = out.length ? out : null;
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: result })); } catch (_) {}
  return result;
}

function renderStreamingPills(sources) {
  if (!sources?.length) {
    return `<div class="muted" style="margin-top:6px;font-size:12px">Inget abonnemang hittades just nu.</div>`;
  }

  const pills = sources.map((s) => {
    const label = `${s.service}${s.quality ? ` ${s.quality}` : ''}${s.region ? ` · ${s.region}` : ''}`;
    const href = s.link ? `href="${esc(s.link)}" target="_blank" rel="noopener"` : '';
    return `<a ${href} class="pill" style="text-decoration:none;display:inline-block">${esc(label)} (ingår)</a>`;
  }).join(' ');

  // Default: visa bara första raden (maxhöjd), med en "…"-toggle.
  return `
    <div class="streaming-wrap" style="margin-top:8px">
      <strong>Tillgängligt i abonnemang (globalt):</strong>
      <div class="streaming-row" data-collapsed="1"
           style="display:flex;flex-wrap:wrap;gap:4px;max-height:32px;overflow:hidden">
        ${pills}
      </div>
      <button type="button" class="streaming-toggle"
              style="margin-top:4px;font-size:12px;padding:0;border:none;background:transparent;text-decoration:underline;cursor:pointer;color:var(--muted)">…</button>
    </div>
  `;
}

// -------------------- component --------------------
class FilmNow extends HTMLElement {
  constructor() {
    super();
    this._unsub = null;
    this._busy = false;
  }

  connectedCallback() {
    this.render();
    this.bind();
    this.load();
  }

  disconnectedCallback() {
    try { this._unsub?.(); } catch (_) {}
  }

  render() {
    this.innerHTML = `
      <div class="card" id="nowCard">
        <style>
          .fn-poster{width:36px;height:auto;border-radius:6px;border:1px solid var(--border);flex:0 0 auto}
          .fn-info{display:flex;gap:10px;align-items:flex-start}
        </style>

        <div class="row" style="align-items:center">
          <div>
            <h3 style="margin:0">På tur nu</h3>
            <div class="muted" style="font-size:13px">Inloggad: <strong id="loggedIn">–</strong></div>
          </div>
          <span class="right"></span>
          <button id="btnRefresh" class="ghost">Uppdatera</button>
          <button id="btnSkip" class="ghost">Hoppa över</button>
        </div>

        <div class="row" style="margin-top:12px">
          <div class="col">
            <label>Nästa i tur</label>
            <input id="nextName" type="text" readonly>
          </div>

          <div class="col">
            <label>Film (förslag)</label>
            <div class="lookup-wrap ac-wrap">
              <input id="film" class="lookup-input" type="text" autocomplete="off" spellcheck="false" />
              <button id="btnLookup" class="lookup-btn">Sök</button>
              <div class="ac-list" id="ac-film" style="display:none"></div>
            </div>
            <div id="filmInfo" class="omdb-info"></div>
          </div>
        </div>

        <div style="margin-top:10px">
          <label>Poäng</label>
          <div id="scoresRow" style="display:flex; gap:8px; overflow:auto; padding-bottom:2px"></div>
        </div>

        <div class="row" style="margin-top:10px; align-items:flex-end; gap:8px">
          <div class="col">
            <label>Kommentar</label>
            <input id="comment" placeholder="valfritt" />
          </div>
          <div class="col" style="align-self:end; flex:0 0 auto">
            <button id="btnSaveNight" class="primary">Spara kväll</button>
          </div>
        </div>
      </div>
    `;

    const scoresRow = this.querySelector('#scoresRow');
    scoresRow.innerHTML = PEOPLE.map((p) => `
      <div class="score-col" style="min-width:100px;flex:1 1 0">
        <label style="margin-bottom:4px">${esc(p)}</label>
        <select id="s-${esc(p)}" class="score-select">
          <option value="">–</option>
          ${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
        </select>
      </div>
    `).join('');
  }

  bind() {
    const loggedIn = this.querySelector('#loggedIn');
    const applyWho = () => { loggedIn.textContent = getWho?.() || '–'; };
    applyWho();
    this._unsub = onStore?.('who', applyWho) || null;

    this.querySelector('#btnRefresh').addEventListener('click', () => this.load(true));
    this.querySelector('#btnSkip').addEventListener('click', () => this.skip());
    this.querySelector('#btnSaveNight').addEventListener('click', () => this.saveNight());
    this.querySelector('#btnLookup').addEventListener('click', () => this.lookupFilm());

    // spara poäng direkt
    PEOPLE.forEach((p) => {
      this.querySelector(`#s-${CSS.escape(p)}`).addEventListener('change', (e) => {
        const val = (e.target.value || '').trim();
        this.saveScore(p, val);
      });
    });

    // enter => lookup
    const filmEl = this.querySelector('#film');
    filmEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.lookupFilm(); }
      if (e.key === 'Escape') this.hideAc();
    });

    this.bindAutocomplete();

    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('.ac-wrap')) return;
      this.hideAc();
    });
  }

  setBusy(b) {
    this._busy = b;
    for (const id of ['#btnRefresh', '#btnSkip', '#btnSaveNight', '#btnLookup']) {
      const el = this.querySelector(id);
      if (el) el.disabled = b;
    }
  }

  clearScoresUI() {
    PEOPLE.forEach((p) => {
      const el = this.querySelector(`#s-${CSS.escape(p)}`);
      if (el) el.value = '';
    });
  }

  async resetScoresServer() {
    // Krav: vid "Hoppa över" och "Spara kväll" ska poängen nollställas.
    try {
      await api('saveScores', { scores: JSON.stringify(emptyScoresPayload()) });
    } catch (e) {
      // tyst (UI får ändå uppdateras vid nästa load)
      console.warn('resetScores failed', e);
    }
  }

  async load() {
    if (this._busy) return;
    this.setBusy(true);
    try {
      const cur = await api('getCurrent', {});
      if (!cur?.ok) throw new Error(cur?.error || 'getCurrent');

      this.querySelector('#nextName').value = cur.next || '';

      const filmEl = this.querySelector('#film');
      filmEl.value = (cur.suggestion || '').trim();
      filmEl.readOnly = false;

      if (cur.scores) {
        PEOPLE.forEach((p) => {
          const el = this.querySelector(`#s-${CSS.escape(p)}`);
          if (el) el.value = (cur.scores[p] ?? '').toString();
        });
      }

      // auto-preview som i gamla
      await this.lookupFilm(true);
    } catch (err) {
      console.error(err);
    } finally {
      this.setBusy(false);
    }
  }

  async skip() {
    if (this._busy) return;
    this.setBusy(true);

    // UI direkt
    this.querySelector('#film').value = '';
    this.querySelector('#filmInfo').innerHTML = '';
    this.clearScoresUI();

    try {
      const j = await api('skipNext', {});
      if (!j?.ok) throw new Error(j?.error || 'skipNext');

      // nollställ poäng efter skip
      await this.resetScoresServer();

      await this.load(true);
    } catch (err) {
      console.error(err);
      try { await this.load(true); } catch (_) {}
    } finally {
      this.setBusy(false);
    }
  }

  async saveScore(person, val) {
    try {
      await api('saveScores', { scores: JSON.stringify({ [person]: val }) });
    } catch (err) {
      console.error(err);
    }
  }

  async saveNight() {
    if (this._busy) return;

    const who = (this.querySelector('#nextName').value || '').trim();
    const film = (this.querySelector('#film').value || '').trim();
    const comment = (this.querySelector('#comment').value || '').trim();

    if (!who || !film) return;

    this.setBusy(true);
    try {
      const j = await api('saveNight', { who, film, comment });
      if (!j?.ok) throw new Error(j?.error || 'saveNight');

      // nollställ poäng efter sparad kväll
      this.clearScoresUI();
      await this.resetScoresServer();

      this.querySelector('#comment').value = '';
      await this.load(true);
    } catch (err) {
      console.error(err);
    } finally {
      this.setBusy(false);
    }
  }

  async lookupFilm(quiet = false) {
    const q = (this.querySelector('#film').value || '').trim();
    const info = this.querySelector('#filmInfo');
    if (!q) { info.innerHTML = ''; return; }

    if (!quiet) info.innerHTML = `<div class="muted">Söker…</div>`;

    const data = await smartLookup(q);
    if (!data) {
      info.innerHTML = `<div class="muted">Hittade inget för: ${esc(q)}</div>`;
      return;
    }

    const title = esc(data.Title || '');
    const year = esc(data.Year || '');
    const rating = esc(data.imdbRating || '-');
    const link = imdbUrlFrom(data);
    const poster = (data.Poster && data.Poster !== 'N/A')
      ? `<img src="${esc(data.Poster)}" alt="poster" loading="lazy" decoding="async" class="fn-poster">`
      : '';

    let streamingHtml = '';
    if (data.imdbID) {
      const sources = await getStreamingInfo(data.imdbID);
      streamingHtml = renderStreamingPills(sources);
    }

    info.innerHTML = `
      <div class="fn-info">
        ${poster}
        <div>
          <strong>${title}</strong>${year ? ` (${year})` : ''}<br>
          IMDb ${rating}${link ? ` — <a href="${esc(link)}" target="_blank" rel="noopener">Öppna på IMDb</a>` : ''}
          ${streamingHtml}
        </div>
      </div>
    `;

    // Toggle: kollapsa alltid till första raden.
    const row = info.querySelector('.streaming-row');
    const btn = info.querySelector('.streaming-toggle');
    if (row && btn) {
      const apply = () => {
        const collapsed = row.getAttribute('data-collapsed') === '1';
        row.style.maxHeight = collapsed ? '32px' : 'none';
        row.style.overflow = collapsed ? 'hidden' : 'visible';
        btn.textContent = collapsed ? '…' : 'visa färre';

        // dölj knappen om allt får plats
        requestAnimationFrame(() => {
          const needs = row.scrollHeight > 32 + 2;
          btn.style.display = needs ? 'inline-block' : 'none';
        });
      };

      apply();
      btn.onclick = () => {
        const collapsed = row.getAttribute('data-collapsed') === '1';
        row.setAttribute('data-collapsed', collapsed ? '0' : '1');
        apply();
      };
    }
  }

  // -------- autocomplete UI --------
  hideAc() {
    const box = this.querySelector('#ac-film');
    if (!box) return;
    box.style.display = 'none';
    box.innerHTML = '';
  }

  showAc(items) {
    const box = this.querySelector('#ac-film');
    if (!box) return;

    if (!items.length) { this.hideAc(); return; }

    box.innerHTML = items.map((x, i) => `
      <div class="ac-item" data-i="${i}">
        <div><strong>${esc(x.title)}</strong> <span class="ac-muted">${esc(x.year)}</span></div>
      </div>
    `).join('');
    box.style.display = 'block';

    box.querySelectorAll('.ac-item').forEach((el) => {
      const pick = (ev) => {
        ev.preventDefault?.();
        ev.stopPropagation?.();
        const i = Number(el.getAttribute('data-i'));
        const it = items[i];
        const filmEl = this.querySelector('#film');
        filmEl.value = it.year ? `${it.title} (${it.year})` : it.title;
        this.hideAc();
        this.lookupFilm(true);
      };
      el.addEventListener('pointerdown', pick, { passive: false });
      el.addEventListener('touchstart', pick, { passive: false });
      el.addEventListener('click', pick);
    });
  }

  bindAutocomplete() {
    const filmEl = this.querySelector('#film');

    const doSearch = debounce(async () => {
      if (document.activeElement !== filmEl) return;
      const q = (filmEl.value || '').trim();
      if (q.length < 3) { this.hideAc(); return; }

      const hits = await tmdbSearchMovies(q, 8);
      if (document.activeElement !== filmEl) return;
      this.showAc(hits);
    }, 380);

    filmEl.addEventListener('input', doSearch);
    filmEl.addEventListener('blur', () => setTimeout(() => this.hideAc(), 150));
  }
}

customElements.define('film-now', FilmNow);
