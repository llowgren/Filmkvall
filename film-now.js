// film-now.js
// <film-now> – På tur nu (film + betyg + spara kväll + hoppa över / byt tur)

import { api } from './api.js';
import { getWho, on as onStore } from './store.js';
import { getMovieTokens } from './film-login.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function debounce(fn, ms = 420) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- “best match”-helpers ----------
function splitTitleAndYear(raw) {
  let q = String(raw || '').trim();
  if (!q) return { title: '', year: '' };
  let year = '';
  const m = q.match(/\((\d{4})\)\s*$/);
  if (m) {
    year = m[1];
    q = q.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  }
  return { title: q, year };
}

function normalizeTitle(s) {
  let t = String(s || '').toLowerCase().trim();
  t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/['’`]/g, '');
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/^(the|a|an)\s+/i, '');
  return t;
}

function tokenSet(s) {
  const n = normalizeTitle(s);
  return new Set(n ? n.split(' ').filter(Boolean) : []);
}

function jaccard(aSet, bSet) {
  if (!aSet.size && !bSet.size) return 1;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const uni = aSet.size + bSet.size - inter;
  return uni ? inter / uni : 0;
}

const OMDB_URL = 'https://www.omdbapi.com/';

async function omdbGetByImdbId(imdbID) {
  const { omdb } = getMovieTokens();
  if (!omdb || !imdbID) return null;
  const u = `${OMDB_URL}?apikey=${encodeURIComponent(omdb)}&i=${encodeURIComponent(imdbID)}&plot=short`;
  const r = await fetch(u, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || j.Response === 'False') return null;
  return j;
}

async function omdbLookupByTitle(title, year = '') {
  const { omdb } = getMovieTokens();
  if (!omdb) return null;
  const t = String(title || '').trim();
  if (!t) return null;

  const u = `${OMDB_URL}?apikey=${encodeURIComponent(omdb)}&t=${encodeURIComponent(t)}${year ? `&y=${encodeURIComponent(year)}` : ''}&type=movie&plot=short`;
  const r = await fetch(u, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || j.Response === 'False') return null;
  return j;
}

async function omdbSearchList(title, page = 1) {
  const { omdb } = getMovieTokens();
  if (!omdb) return null;
  const t = String(title || '').trim();
  if (!t) return null;

  const u = `${OMDB_URL}?apikey=${encodeURIComponent(omdb)}&s=${encodeURIComponent(t)}&type=movie&page=${encodeURIComponent(page)}`;
  const r = await fetch(u, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || j.Response === 'False' || !Array.isArray(j.Search)) return null;
  return j.Search;
}

function scoreOmdbHit(it, wantedTitle, wantedYear = '') {
  const wantTokens = tokenSet(wantedTitle);
  const wantNorm = normalizeTitle(wantedTitle);
  const wantYearNum = wantedYear ? Number(wantedYear) : NaN;

  const t = it?.Title || '';
  const y = it?.Year || '';
  const imdbID = it?.imdbID || '';
  if (!t || !imdbID) return { score: -1 };

  const candTokens = tokenSet(t);
  const candNorm = normalizeTitle(t);

  const sim = jaccard(wantTokens, candTokens); // 0..1
  const prefixBoost = (candNorm.startsWith(wantNorm) || wantNorm.startsWith(candNorm)) ? 0.12 : 0;
  const exactBoost = (candNorm === wantNorm) ? 0.25 : 0;

  let yearBoost = 0;
  if (wantedYear && /^\d{4}$/.test(String(y))) {
    const dy = Math.abs(Number(y) - wantYearNum);
    yearBoost = dy === 0 ? 0.22 : dy <= 1 ? 0.12 : dy <= 2 ? 0.06 : 0;
  } else if (!wantedYear) {
    yearBoost = /^\d{4}$/.test(String(y)) ? 0.03 : 0;
  }

  const score = sim + prefixBoost + exactBoost + yearBoost;
  return { score, Title: t, Year: y, imdbID };
}

function topSuggestions(searchResults, wantedTitle, wantedYear = '', limit = 5) {
  const scored = (searchResults || [])
    .map((it) => scoreOmdbHit(it, wantedTitle, wantedYear))
    .filter((x) => x.imdbID && x.score >= 0)
    .sort((a, b) => b.score - a.score);

  const out = [];
  const seen = new Set();
  for (const s of scored) {
    const key = `${normalizeTitle(s.Title)}|${String(s.Year || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function pickBestSuggestion(suggestions) {
  if (!suggestions?.length) return null;
  const best = suggestions[0];
  if (best.score < 0.25 && suggestions.length >= 3) return null;
  return best;
}

async function smartLookupMovieDetailed(query, hint = null) {
  const q = String(query || '').trim();
  if (!q) return { data: null, suggestions: null, reason: 'empty' };

  const { title, year } = splitTitleAndYear(q);

  const cacheKey = `now_omdb_best_v2_${normalizeTitle(title)}_${year || '----'}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached?.savedAt && Date.now() - cached.savedAt < 30 * 24 * 3600_000) {
      return cached.payload || { data: cached.data ?? null, suggestions: null, reason: 'cache' };
    }
  } catch (_) {}

  if (hint?.title) {
    const d0 = await omdbLookupByTitle(hint.title, hint.year || year);
    if (d0?.imdbID) {
      const payload = { data: d0, suggestions: null, reason: 'hint' };
      try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload })); } catch (_) {}
      return payload;
    }
  }

  const list1 = await omdbSearchList(title, 1);
  const suggestions = list1?.length ? topSuggestions(list1, title, year, 5) : null;
  const best = pickBestSuggestion(suggestions);

  if (best?.imdbID) {
    const d = await omdbGetByImdbId(best.imdbID);
    if (d?.imdbID) {
      const wantN = normalizeTitle(title);
      const gotN = normalizeTitle(d.Title || '');
      const shouldOffer = suggestions?.length && wantN && gotN && wantN !== gotN;

      const payload = {
        data: d,
        suggestions: shouldOffer ? suggestions : null,
        reason: shouldOffer ? 'best_with_alternatives' : 'best'
      };
      try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload })); } catch (_) {}
      return payload;
    }
  }

  const d1 = await omdbLookupByTitle(title, year);
  if (d1?.imdbID) {
    const wantN = normalizeTitle(title);
    const gotN = normalizeTitle(d1.Title || '');
    const shouldOffer = suggestions?.length && wantN && gotN && wantN !== gotN;

    const payload = { data: d1, suggestions: shouldOffer ? suggestions : null, reason: 'title_fallback' };
    try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload })); } catch (_) {}
    return payload;
  }

  const title2 = String(title).replace(/^(the|a|an)\s+/i, '').trim();
  if (title2 && title2 !== title) {
    const d2 = await omdbLookupByTitle(title2, year);
    if (d2?.imdbID) {
      const payload = { data: d2, suggestions: suggestions?.length ? suggestions : null, reason: 'title_drop_article' };
      try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload })); } catch (_) {}
      return payload;
    }
  }

  const payload = { data: null, suggestions: suggestions?.length ? suggestions : null, reason: 'not_found' };
  try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload })); } catch (_) {}
  return payload;
}

// ---------- TMDb autocomplete ----------
async function tmdbAutocomplete(query, limit = 8) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  const { tmdb } = getMovieTokens();
  if (!tmdb) return [];
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(tmdb)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(q)}`,
      { cache: 'no-store' }
    );
    if (!r.ok) return [];
    const j = await r.json();
    const res = Array.isArray(j?.results) ? j.results : [];
    return res.slice(0, limit).map((it) => ({
      title: it.title || it.original_title || '',
      year: (it.release_date || '').slice(0, 4) || ''
    }));
  } catch {
    return [];
  }
}

// ---------- Watchmode ----------
async function watchmodeSources(imdbID) {
  const { watchmode } = getMovieTokens();
  if (!watchmode || !imdbID) return null;

  const k = `wm_sources_${imdbID}`;
  try {
    const cached = JSON.parse(localStorage.getItem(k) || 'null');
    if (cached?.savedAt && Date.now() - cached.savedAt < 7 * 24 * 3600_000) return cached.data;
  } catch (_) {}

  const findTitleId = async () => {
    const f1 = await fetch(
      `https://api.watchmode.com/v1/find/?apiKey=${encodeURIComponent(watchmode)}&source=imdb&external_id=${encodeURIComponent(imdbID)}`,
      { cache: 'no-store' }
    ).catch(() => null);
    if (f1?.ok) {
      const j = await f1.json();
      if (j?.title_id) return j.title_id;
    }
    const f2 = await fetch(
      `https://api.watchmode.com/v1/search/?apiKey=${encodeURIComponent(watchmode)}&search_field=imdb_id&search_value=${encodeURIComponent(imdbID)}`,
      { cache: 'no-store' }
    ).catch(() => null);
    if (f2?.ok) {
      const j = await f2.json();
      const hit = Array.isArray(j?.title_results) ? j.title_results.find((t) => String(t.imdb_id) === String(imdbID)) : null;
      if (hit?.id) return hit.id;
    }
    return null;
  };

  try {
    const titleId = await findTitleId();
    if (!titleId) return null;

    const r = await fetch(
      `https://api.watchmode.com/v1/title/${encodeURIComponent(titleId)}/sources/?apiKey=${encodeURIComponent(watchmode)}`,
      { cache: 'no-store' }
    );
    if (!r.ok) return null;

    const data = await r.json();
    if (!Array.isArray(data)) return null;

    const seen = new Set();
    const normalizeName = (s) => String(s || '').replace(/\s*with Ads$/i, '').replace(/\s+HD$/, '').trim();

    const filtered = data
      .filter((s) => s.type === 'sub' && s.name)
      .map((s) => ({
        service: normalizeName(s.name),
        quality: s.format === '4K' || s.format === 'HD' ? s.format : '',
        region: s.region || '',
        link: s.web_url || ''
      }))
      .filter((s) => {
        const key = `${s.service}|${s.quality}|${s.region}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.service + a.region + a.quality).localeCompare(b.service + b.region + b.quality));

    const out = filtered.length ? filtered : null;
    try {
      localStorage.setItem(k, JSON.stringify({ savedAt: Date.now(), data: out }));
    } catch (_) {}
    return out;
  } catch {
    return null;
  }
}

class FilmNow extends HTMLElement {
  constructor() {
    super();
    this._unsubs = [];
    this._busy = false;
    this._cooldownUntil = 0;
    this._lastCurrent = null;
    this._pollTimer = null;

    this._lookupSeq = 0;
    this._hint = null;
  }

  connectedCallback() {
    this.render();
    this.wire();
    this.refresh();

    this._unsubs.push(
      onStore('who', () => {
        this.refresh();
      })
    );

    this._pollTimer = setInterval(() => {
      if (!this._busy && document.visibilityState !== 'hidden') {
        this.refresh({ locked: false, passive: true }).catch(() => {});
      }
    }, 7000);
  }

  disconnectedCallback() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    for (const u of this._unsubs) try { u(); } catch (_) {}
    this._unsubs = [];
  }

  $(sel) {
    return this.querySelector(sel);
  }

  setJumpMsg(text = '') {
    const el = this.$('#jumpMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';
  }

  _canRun() {
    if (this._busy) return false;
    if (Date.now() < this._cooldownUntil) return false;
    return true;
  }

  async runLocked(fn, cooldownMs = 650) {
    if (!this._canRun()) return;
    this.setBusy(true);
    this._cooldownUntil = Date.now() + cooldownMs;
    try {
      await fn();
    } finally {
      this.setBusy(false);
    }
  }

  setBusy(on) {
    this._busy = !!on;
    const buttons = [this.$('#btnRefresh'), this.$('#btnSkip'), this.$('#btnLookup'), this.$('#btnStartNight'), this.$('#btnSave'), this.$('#btnDoJump'), this.$('#btnSkipOne')];
    for (const b of buttons) {
      if (!b) continue;
      b.disabled = this._busy;
      b.classList.toggle('is-busy', this._busy);
    }
    if (!this._busy) this.applyActiveState();
  }

  resetScoresUI() {
    this.querySelectorAll('.score-select').forEach((s) => (s.value = ''));
  }

  async _refreshUnlocked({ passive = false } = {}) {
    const cur = await api('getCurrent');
    this._lastCurrent = cur;
    this.applyCurrent(cur, { passive });
    if (!passive || cur?.active) await this.updateSuggestedInfo();
  }

  async refresh({ locked = true, passive = false } = {}) {
    if (!locked) {
      await this._refreshUnlocked({ passive });
      return;
    }
    await this.runLocked(async () => {
      await this._refreshUnlocked({ passive });
    }, 350);
  }

  applyCurrent(cur, { passive = false } = {}) {
    if (!cur?.ok) return;

    const picker = (cur.next || '').trim();
    const whoEl = this.$('#picker');
    if (whoEl) whoEl.value = picker;

    const sug = (cur.suggestion || '').trim();
    const input = this.$('#suggested');
    if (input) {
      const editingUnlocked = passive && !cur.active && document.activeElement === input;
      if (!editingUnlocked) input.value = sug;
      input.readOnly = !!cur.active && !this.isCurrentPicker();
    }

    this.applyActiveState(cur);

    if (cur.scores) {
      for (const p of PEOPLE) {
        const el = this.$(`#s-${p}`);
        if (el) el.value = (cur.scores[p] ?? '') === '' ? '' : String(cur.scores[p]);
      }
    }

    this.updateJumpOptions({ forceDefault: true });
    this._hint = null;
  }

  isCurrentPicker() {
    return getWho() === (this.$('#picker')?.value || '').trim();
  }

  applyActiveState(cur = this._lastCurrent) {
    const active = !!cur?.active;
    const canEdit = !active || this.isCurrentPicker();
    const input = this.$('#suggested');
    const lookup = this.$('#btnLookup');
    const start = this.$('#btnStartNight');
    const msg = this.$('#activeMsg');

    if (input) input.readOnly = !canEdit;
    if (lookup) lookup.disabled = this._busy || !canEdit;
    if (start) {
      start.disabled = this._busy || !canEdit;
      start.textContent = active ? 'Uppdatera filmval' : 'Starta filmkväll';
    }
    if (msg) {
      if (active && canEdit) msg.textContent = 'Filmkvällen är startad. Du kan ändra filmvalet eftersom det är din tur.';
      else if (active) msg.textContent = `Filmkvällen är startad för ${(cur.next || '').trim()}. Endast den personen kan ändra filmvalet.`;
      else msg.textContent = 'Vem som helst kan skriva in filmvalet och starta filmkvällen för personen på tur.';
    }
  }

  orderedTurnList() {
    const cur = (this.$('#picker')?.value || '').trim();
    const idx = PEOPLE.indexOf(cur);
    if (idx < 0) return [...PEOPLE];

    const order = [];
    for (let k = 1; k <= PEOPLE.length; k++) {
      const p = PEOPLE[(idx + k) % PEOPLE.length];
      if (p !== cur) order.push(p);
    }
    return order;
  }

  updateJumpOptions({ preserveSelection = true, forceDefault = false } = {}) {
    const sel = this.$('#jumpTo');
    const btn = this.$('#btnDoJump');
    if (!sel || !btn) return;

    const order = this.orderedTurnList();
    const prev = (sel.value || '').trim();
    sel.innerHTML = order.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');

    let nextVal = order[0] || '';
    if (!forceDefault && preserveSelection && prev && order.includes(prev)) nextVal = prev;
    sel.value = nextVal;

    const steps = this.stepsToPerson(sel.value);
    btn.disabled = !sel.value || steps === 0;
  }

  stepsToPerson(target) {
    const cur = (this.$('#picker')?.value || '').trim();
    const a = PEOPLE.indexOf(cur);
    const b = PEOPLE.indexOf(target);
    if (a < 0 || b < 0) return 0;
    const n = PEOPLE.length;
    return (b - a + n) % n;
  }

  toggleSkipPanel() {
    const row = this.$('#advancedRow');
    if (!row) return;
    const open = row.style.display !== 'none';
    row.style.display = open ? 'none' : 'block';
    this.setJumpMsg('');
    if (!open) this.updateJumpOptions({ preserveSelection: false, forceDefault: true });
  }

  async doSkipOne() {
    await this.runLocked(async () => {
      this.setJumpMsg('Hoppar en…');
      await api('skipNext');
      this.resetScoresUI();
      await this.refresh({ locked: false });
      this.setJumpMsg('');
    });
  }

  async doJumpToSelected() {
    const target = (this.$('#jumpTo')?.value || '').trim();
    if (!target) return;
    const steps = this.stepsToPerson(target);
    if (steps === 0) return;

    await this.runLocked(async () => {
      this.setJumpMsg(`Byter till ${target}…`);
      for (let i = 0; i < steps; i++) await api('skipNext');
      this.resetScoresUI();
      await this.refresh({ locked: false });

      const row = this.$('#advancedRow');
      if (row) row.style.display = 'none';

      this.setJumpMsg(`Nu är det ${target} på tur.`);
      setTimeout(() => this.setJumpMsg(''), 1800);
    });
  }

  getScoresPayload() {
    const scores = {};
    for (const p of PEOPLE) {
      const val = (this.$(`#s-${p}`)?.value || '').trim();
      scores[p] = val;
    }
    return scores;
  }

  setSaveMsg(text = '') {
    const el = this.$('#saveMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';
  }

  mailStatusText(mail) {
    const sent = Number(mail?.sent || 0);
    const dev = Number(mail?.development || 0);
    const skipped = Number(mail?.skippedNoEmail || 0);
    const parts = [];
    if (sent) parts.push(`${sent} röstmejl skickade`);
    if (dev) parts.push(`${dev} röstmejl skapade i DevEmails`);
    if (skipped) parts.push(`${skipped} saknar e-post`);
    if (!parts.length) return 'Kvällen sparades, men inga röstmejl skapades.';
    const suffix = dev ? ' Riktiga mejl kräver EMAIL_MODE=send i Apps Script.' : '';
    return `${parts.join(', ')}.${suffix}`;
  }

  async saveNight() {
    await this.runLocked(async () => {
      const who = (this.$('#picker')?.value || '').trim();
      const film = (this.$('#suggested')?.value || '').trim();
      const comment = (this.$('#comment')?.value || '').trim();
      if (!who || !film) return;

      try {
        this.setSaveMsg('Sparar kväll och skapar röstlänkar...');
        await api('saveScores', { scores: JSON.stringify(this.getScoresPayload()) });
        const saved = await api('saveNight', { who, film, comment });
        if (!saved?.ok) throw new Error(saved?.error || 'Kunde inte spara kväll');

        this.resetScoresUI();
        const c = this.$('#comment');
        if (c) c.value = '';

        await this.refresh({ locked: false });
        this.setSaveMsg(this.mailStatusText(saved.mail));
      } catch (err) {
        this.setSaveMsg(String(err?.message || err));
      }
    });
  }

  async startNight() {
    await this.runLocked(async () => {
      const film = (this.$('#suggested')?.value || '').trim();
      if (!film) return;

      const res = await api('startNight', { film, by: getWho() });
      if (!res?.ok) {
        this.applyActiveState(this._lastCurrent);
        const msg = this.$('#activeMsg');
        if (msg) msg.textContent = res?.message || 'Filmvalet är låst av personen som är på tur.';
        return;
      }

      await this.refresh({ locked: false });
    }, 650);
  }

  renderSuggestions(suggestions, heading = 'Menade du:') {
    if (!suggestions || !suggestions.length) return '';
    const items = suggestions
      .map((s) => {
        const y = s.Year ? ` (${escapeHtml(s.Year)})` : '';
        return `
          <button type="button" class="ghost sugItem"
            data-pick-suggestion="1"
            data-title="${escapeHtml(s.Title)}"
            data-year="${escapeHtml(s.Year || '')}">
            ${escapeHtml(s.Title)}${y}
          </button>
        `;
      })
      .join('');

    return `
      <div class="sugBox">
        <div class="muted sugHead">${escapeHtml(heading)}</div>
        <div class="sugRow">${items}</div>
      </div>
    `;
  }

  async updateSuggestedInfo() {
    const input = this.$('#suggested');
    const q = (input?.value || '').trim();
    const info = this.$('#suggested-info');
    if (!info) return;

    if (!q) {
      info.innerHTML = '';
      return;
    }

    const mySeq = ++this._lookupSeq;
    info.innerHTML = `<div class="muted">Söker…</div>`;

    const out = await smartLookupMovieDetailed(q, this._hint);

    if (mySeq !== this._lookupSeq) return;
    if (((input?.value || '').trim()) !== q) return;

    if (!out?.data) {
      const base = `<div class="muted">Hittade inget för: ${escapeHtml(q)}</div>`;
      const sug = out?.suggestions?.length ? this.renderSuggestions(out.suggestions, 'Menade du någon av dessa?') : '';
      info.innerHTML = base + sug;
      return;
    }

    const meta = this.renderMovieMeta(out.data, q);
    const sug = out?.suggestions?.length ? this.renderSuggestions(out.suggestions, 'Om det blev fel, välj:') : '';
    info.innerHTML = meta + sug;

    this.wireStreamingLazy();
  }

  renderMovieMeta(data, query) {
    if (!data) {
      return `<div class="muted">Hittade inget för: ${escapeHtml(query)}</div>`;
    }

    const rating = escapeHtml(data.imdbRating || '-');
    const imdbID = data.imdbID || '';
    const imdbUrl = imdbID ? `https://www.imdb.com/title/${imdbID}/` : '';

    const poster = data.Poster && data.Poster !== 'N/A'
      ? `<img class="thumb" src="${escapeHtml(data.Poster)}" alt="poster" loading="lazy" decoding="async">`
      : `<div class="thumb ph" aria-hidden="true"></div>`;

    return `
      <div class="metaGrid">
        <div class="metaThumb">${poster}</div>

        <div class="metaImdb">
          <div><strong>IMDb</strong> ${rating}</div>
          ${imdbUrl ? `<a href="${imdbUrl}" target="_blank" rel="noopener">Öppna på IMDb</a>` : ''}
        </div>

        <div class="metaStream">
          <div class="muted streamHead">Tillgängligt i abonnemang (globalt):</div>
          <div class="streamWrap" data-imdb="${escapeHtml(imdbID)}">
            <div class="streamRow collapsed" style="display:none"></div>
            <button type="button" class="streamToggle">…</button>
          </div>
        </div>
      </div>
    `;
  }

  wireStreamingLazy() {
    const wrap = this.$('.streamWrap');
    if (!wrap) return;

    const imdbID = wrap.getAttribute('data-imdb') || '';
    const row = wrap.querySelector('.streamRow');
    const toggle = wrap.querySelector('.streamToggle');
    if (!toggle) return;

    let loaded = false;

    const applyPills = (options) => {
      if (!row) return;

      if (!options || !options.length) {
        row.style.display = 'none';
        toggle.style.display = 'none';
        wrap.insertAdjacentHTML('afterbegin', `<div class="muted streamEmpty">Inget abonnemang hittades just nu.</div>`);
        return;
      }

      const pills = options
        .map((opt) => {
          const label = `${opt.service}${opt.quality ? ` ${opt.quality}` : ''}${opt.region ? ` · ${opt.region}` : ''}`;
          const href = opt.link ? `href="${escapeHtml(opt.link)}"` : '';
          return `<a class="pill" ${href} target="_blank" rel="noopener">${escapeHtml(label)} (ingår)</a>`;
        })
        .join('');

      row.innerHTML = pills;
      row.style.display = 'flex';

      row.classList.add('collapsed');

      requestAnimationFrame(() => {
        const needs = row.scrollHeight > row.clientHeight + 2;
        toggle.style.display = needs ? 'inline-block' : 'none';
        toggle.textContent = row.classList.contains('collapsed') ? '…' : 'visa färre';
      });
    };

    const loadOnce = async () => {
      if (!imdbID) return;
      toggle.disabled = true;
      toggle.textContent = 'hämtar…';
      const options = await watchmodeSources(imdbID);
      applyPills(options);
      toggle.disabled = false;
      toggle.textContent = '…';
      loaded = true;
    };

    toggle.onclick = async () => {
      if (!imdbID) return;

      if (!loaded) {
        await loadOnce();
        return;
      }

      if (!row) return;
      row.classList.toggle('collapsed');
      toggle.textContent = row.classList.contains('collapsed') ? '…' : 'visa färre';
    };
  }

  wireAutocomplete() {
    const input = this.$('#suggested');
    const box = this.$('#ac-suggested');
    if (!input || !box) return;

    let composing = false;
    input.addEventListener('compositionstart', () => (composing = true));
    input.addEventListener('compositionend', () => (composing = false));

    const hide = () => {
      box.style.display = 'none';
      box.innerHTML = '';
    };

    const show = (items) => {
      if (!items.length) return hide();
      box.innerHTML = items
        .map(
          (x, i) => `
        <div class="ac-item" data-i="${i}">
          <div><strong>${escapeHtml(x.title)}</strong> <span class="ac-muted">${escapeHtml(x.year)}</span></div>
        </div>`
        )
        .join('');
      box.style.display = 'block';

      box.querySelectorAll('.ac-item').forEach((el) => {
        const pick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const i = Number(el.getAttribute('data-i'));
          const it = items[i];

          this._hint = it?.title ? { title: it.title, year: it.year || '' } : null;

          input.value = it.year ? `${it.title} (${it.year})` : it.title;
          hide();
          this.updateSuggestedInfo();
        };
        el.addEventListener('pointerdown', pick, { passive: false });
        el.addEventListener('touchstart', pick, { passive: false });
        el.addEventListener('click', pick);
      });
    };

    const doSearch = debounce(async () => {
      if (composing) return;
      if (input.readOnly) return hide();
      if (document.activeElement !== input) return;
      const q = (input.value || '').trim();
      if (q.length < 2) return hide();
      const items = await tmdbAutocomplete(q, 8);
      if (document.activeElement !== input) return;
      show(items);
    }, 520);

    input.addEventListener('input', () => {
      if (this._hint?.title) {
        const v = String(input.value || '').trim();
        const nV = normalizeTitle(v);
        const nH = normalizeTitle(this._hint.title);
        if (nV && nH && !nH.startsWith(nV) && !nV.startsWith(nH)) this._hint = null;
      }
      doSearch();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
      if (e.key === 'Enter') {
        e.preventDefault();
        hide();
        this.updateSuggestedInfo();
      }
    });

    input.addEventListener('blur', () => setTimeout(hide, 180));

    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('.ac-wrap')) return;
      hide();
    });
  }

  wire() {
    const logged = this.$('#loggedIn');
    if (logged) logged.textContent = getWho();

    this._unsubs.push(
      onStore('who', (w) => {
        const l = this.$('#loggedIn');
        if (l) l.textContent = w;
      })
    );

    this.$('#btnRefresh')?.addEventListener('click', () => this.refresh());
    this.$('#btnSkip')?.addEventListener('click', () => this.toggleSkipPanel());
    this.$('#btnSkipOne')?.addEventListener('click', () => this.doSkipOne());

    this.$('#jumpTo')?.addEventListener('change', () => {
      const t = (this.$('#jumpTo')?.value || '').trim();
      this.$('#btnDoJump').disabled = !t || this.stepsToPerson(t) === 0;
    });

    this.$('#btnDoJump')?.addEventListener('click', () => this.doJumpToSelected());

    this.$('#btnLookup')?.addEventListener('click', () => this.runLocked(() => this.updateSuggestedInfo(), 450));
    this.$('#btnStartNight')?.addEventListener('click', () => this.startNight());
    this.$('#suggested')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!this.$('#suggested')?.readOnly) this.runLocked(() => this.updateSuggestedInfo(), 450);
      }
    });

    this.$('#btnSave')?.addEventListener('click', () => this.saveNight());

    this.querySelectorAll('.score-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        if (this._busy) return;
        const who = sel.id.replace('s-', '');
        const val = (sel.value || '').trim();
        try {
          await api('saveScores', { scores: JSON.stringify({ [who]: val }) });
        } catch (e) {
          console.error(e);
        }
      });
    });

    this.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-pick-suggestion]');
      if (!btn) return;

      const title = btn.getAttribute('data-title') || '';
      const year = btn.getAttribute('data-year') || '';
      if (!title) return;

      this._hint = { title, year };

      const input = this.$('#suggested');
      if (input?.readOnly) return;
      if (input) input.value = year ? `${title} (${year})` : title;

      this.runLocked(() => this.updateSuggestedInfo(), 350);
    });

    this.wireAutocomplete();
  }

  render() {
    this.innerHTML = `
      <div class="card" id="nowCard">

        <div class="topRow">
          <div class="topLeft">
            <h3 class="nowTitle">På tur nu</h3>
            <div class="muted">Inloggad: <span id="loggedIn">–</span></div>
          </div>
          <div class="topRight">
            <button id="btnRefresh" class="ghost">Uppdatera</button>
            <button id="btnSkip" class="ghost">Hoppa över</button>
          </div>
        </div>

        <div class="row nowRow">
          <div class="col nowCol">
            <label>Filmväljare</label>
            <input id="picker" type="text" readonly>
          </div>
        </div>

        <div class="row nowRow">
          <div class="col nowCol">
            <label>Film (förslag)</label>
            <div class="filmRow ac-wrap">
              <input id="suggested" class="lookup-input" autocomplete="off" autocapitalize="off" spellcheck="false">
              <button id="btnLookup" class="lookup-btn">Sök</button>
              <button id="btnStartNight" class="primary start-btn">Starta filmkväll</button>
              <div class="ac-list" id="ac-suggested" style="display:none"></div>
            </div>
            <div id="activeMsg" class="muted activeMsg"></div>
          </div>
        </div>

        <div id="suggested-info" class="omdb-info"></div>

        <div id="advancedRow" class="advancedRow" style="display:none">
          <div class="row advRow">
            <div class="col advCol">
              <label>Hoppa till (nästa i tur överst)</label>
              <select id="jumpTo"></select>
            </div>

            <div class="col advBtns">
              <button id="btnDoJump" class="ghost" disabled>Byt tur</button>
              <button id="btnSkipOne" class="ghost">Hoppa en</button>
            </div>

            <div class="col advInfo">
              <div id="jumpMsg" class="muted" style="font-size:12px; display:none"></div>
              <div class="muted advHelp">Används bara vid undantag. Vanligtvis tar man sin tur.</div>
            </div>
          </div>
        </div>

        <div class="row nowRow nowScores">
          <div class="col nowCol">
            <label>Poäng</label>
            <div id="scoresRow" class="scoresGrid">
              ${PEOPLE.map(
                (p) => `
                <div class="scoreCell">
                  <label>${escapeHtml(p)}</label>
                  <select id="s-${escapeHtml(p)}" class="score-select">
                    <option value="">–</option>
                    <option>1</option><option>2</option><option>3</option><option>4</option><option>5</option>
                    <option>6</option><option>7</option><option>8</option><option>9</option><option>10</option>
                  </select>
                </div>`
              ).join('')}
            </div>
          </div>
        </div>

        <div class="row saveRow">
          <div class="col saveCol">
            <label>Kommentar</label>
            <input id="comment" placeholder="valfritt">
            <div id="saveMsg" class="muted saveMsg" role="status" aria-live="polite" style="display:none"></div>
          </div>
          <div class="col saveBtnCol">
            <button id="btnSave" class="primary">Spara kväll</button>
          </div>
        </div>
      </div>

      <style>
        /* --- Topp --- */
        .nowTitle{margin:0}
        .topRow{display:flex; align-items:flex-start; gap:12px}
        .topRight{margin-left:auto; display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end}

        /* Tajtare vertikalt */
        .nowRow{margin-top:10px}
        .omdb-info{margin-top:10px}

        /* Film-sök */
        .filmRow{display:flex; gap:8px; align-items:center; position:relative}
        .lookup-input{flex:1 1 auto; min-width:0}
        .start-btn{flex:0 0 auto}
        .activeMsg{font-size:12px; margin-top:6px}
        .saveMsg{font-size:12px; margin-top:6px}

        /* --- OMDb meta --- */
        .metaGrid{
          display:grid;
          grid-template-columns:112px 1fr 1.6fr;
          gap:14px;
          align-items:start;
        }

        .thumb{width:112px; height:auto; border-radius:12px; border:1px solid var(--border, #dfe3ee)}
        .thumb.ph{height:168px; background:rgba(0,0,0,.06)}
        .metaImdb{display:flex; flex-direction:column; gap:4px; align-self:start}
        .metaImdb a{ text-decoration:underline }
        .metaStream{align-self:start}
        .streamHead{font-size:12px}
        .streamRow{display:flex; flex-wrap:wrap; gap:6px; margin-top:6px}
        .streamRow.collapsed{max-height:86px; overflow:hidden}
        .streamToggle{margin-top:4px; font-size:12px; padding:0; border:none; background:transparent; text-decoration:underline; cursor:pointer; color:var(--muted, #5b6475)}
        .streamEmpty{font-size:12px; margin-top:6px}

        /* --- Autocomplete --- */
        .ac-list{position:absolute; left:0; right:0; top:100%; z-index:50; background:var(--panel, #fff); border:1px solid var(--border, #dfe3ee); border-radius:12px; margin-top:6px; overflow:hidden}
        .ac-item{padding:10px 12px; cursor:pointer; border-top:1px solid var(--border, #dfe3ee); font-size:14px}
        .ac-item:first-child{border-top:none}
        .ac-item:hover{filter:brightness(1.03)}
        .ac-muted{color:var(--muted, #5b6475); font-size:12px}

        /* --- Poäng: grid istället för horisontell scroll --- */
        .scoresGrid{
          display:grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap:10px;
          align-items:end;
        }
        .scoreCell label{display:block}
        .scoreCell select{width:100%; padding:8px 10px; border-radius:10px; text-align:center; text-align-last:center}

        /* --- Spara-rad: responsiv --- */
        .saveRow{align-items:end; margin-top:10px}
        .saveBtnCol{flex:0 0 auto}

        button.is-busy{opacity:.55; cursor:not-allowed}

        /* Förslagslista */
        .sugBox{margin-top:8px}
        .sugHead{font-size:12px; margin:10px 0 6px}
        .sugRow{display:flex; flex-wrap:wrap; gap:8px}
        .sugItem{padding:10px 12px; border-radius:12px}

        /* --- Mobil --- */
        @media (max-width: 600px){
          /* Topp: stacka och undvik tom luft */
          .topRow{flex-direction:column; align-items:stretch}
          .topRight{margin-left:0; justify-content:flex-start}

          /* Filmrad: knapp får plats */
          .lookup-btn{flex:0 0 auto}
          .filmRow{align-items:stretch; flex-wrap:wrap}
          .filmRow .lookup-input{height:auto}
          .start-btn{width:100%}

          /* Meta: en kolumn (minskar tomma områden) */
          .metaGrid{
            grid-template-columns:1fr;
            gap:10px;
          }
          .metaThumb{display:flex; justify-content:center}
          .thumb{width:160px; max-width:60vw}

          /* Poäng: en per rad */
          .scoresGrid{grid-template-columns:1fr}

          /* Spara: knapp under kommentar */
          .saveRow{flex-direction:column; align-items:stretch; gap:10px}
          .saveBtnCol{flex:1 1 auto}
          #btnSave{width:100%}

          /* Advanced: också stackad */
          .advRow{flex-direction:column; align-items:stretch; gap:10px}
          .advBtns{display:flex; gap:10px; flex-wrap:wrap}
        }

        /* Mellansteg: 2 kolumner för poäng */
        @media (min-width: 601px) and (max-width: 900px){
          .scoresGrid{grid-template-columns: repeat(2, minmax(0, 1fr));}
        }

        @media (min-width: 901px) and (max-width: 1100px){
          .scoresGrid{grid-template-columns: repeat(3, minmax(0, 1fr));}
        }
      </style>
    `;
  }
}

customElements.define('film-now', FilmNow);
