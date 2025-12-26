// film-now.js
// <film-now> – “På tur nu”-modulen (UI + API-koppling)
// Mål: samma beteende som gamla singelfilen, men fristående.

import { api } from './api.js';
import { getWho, on } from './store.js';
import { getMovieTokens } from './film-login.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];

// --- små helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const debounce = (fn, ms = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

function orderedFrom(next) {
  const i = Math.max(0, PEOPLE.indexOf(next));
  return [...PEOPLE.slice(i), ...PEOPLE.slice(0, i)];
}

function stepsToTarget(currentNext, target) {
  const a = PEOPLE.indexOf(currentNext);
  const b = PEOPLE.indexOf(target);
  if (a < 0 || b < 0) return 0;
  const n = PEOPLE.length;
  return (b - a + n) % n;
}

async function omdbLookup(titleOrId) {
  const { omdb } = getMovieTokens();
  if (!omdb) return null;
  const q = String(titleOrId || '').trim();
  if (!q) return null;

  // stöd: "Titel (År)" => plocka år
  let title = q;
  let year = '';
  const m = title.match(/\((\d{4})\)\s*$/);
  if (m) {
    year = m[1];
    title = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  }

  // om någon klistrar in tt123...
  const tt = (q.match(/tt\d{7,}/i) || q.match(/imdb\.com\/title\/(tt\d+)/i));
  const url = tt
    ? `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&i=${encodeURIComponent(tt[1] || tt[0])}&plot=short`
    : `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&t=${encodeURIComponent(title)}${year ? `&y=${encodeURIComponent(year)}` : ''}&type=movie&plot=short`;

  const r = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || j.Response === 'False') return null;
  return j;
}

async function watchmodeSources(imdbID) {
  const { watchmode } = getMovieTokens();
  if (!watchmode || !imdbID) return null;

  // 1) hitta title_id
  const findUrl = `https://api.watchmode.com/v1/find/?apiKey=${encodeURIComponent(watchmode)}&source=imdb&external_id=${encodeURIComponent(imdbID)}`;
  const r1 = await fetch(findUrl, { cache: 'no-store' }).catch(() => null);
  const j1 = r1 && r1.ok ? await r1.json().catch(() => null) : null;
  const titleId = j1?.title_id;
  if (!titleId) return null;

  // 2) sources
  const srcUrl = `https://api.watchmode.com/v1/title/${encodeURIComponent(titleId)}/sources/?apiKey=${encodeURIComponent(watchmode)}`;
  const r2 = await fetch(srcUrl, { cache: 'no-store' }).catch(() => null);
  const j2 = r2 && r2.ok ? await r2.json().catch(() => null) : null;
  if (!Array.isArray(j2)) return null;

  // visa bara abonnemang (“sub”), globalt/region spelar mindre roll här
  const seen = new Set();
  const clean = (s) => String(s || '').replace(/\s*\(with Ads\)$/i, '').trim();
  const out = j2
    .filter((x) => x && x.type === 'sub' && x.name)
    .map((x) => ({
      service: clean(x.name),
      region: x.region || '',
      quality: (x.format === '4K' || x.format === 'HD') ? x.format : '',
      url: x.web_url || ''
    }))
    .filter((x) => {
      const k = `${x.service}|${x.region}|${x.quality}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.service + a.region + a.quality).localeCompare(b.service + b.region + b.quality));

  return out.length ? out : null;
}

function buildStreamPills(sources) {
  if (!sources?.length) return '<div class="muted" style="font-size:12px">Inget abonnemang hittades just nu.</div>';
  const pills = sources.map((s) => {
    const label = `${s.service}${s.quality ? ` ${s.quality}` : ''}${s.region ? ` · ${s.region}` : ''}`;
    const href = s.url ? `href="${esc(s.url)}" target="_blank" rel="noopener"` : '';
    return `<a ${href} class="pill" style="text-decoration:none">${esc(label)} (ingår)</a>`;
  }).join('');

  // Viktigt: collapsed ska bara visa första raden.
  return `
    <div class="streaming-wrap">
      <div class="muted" style="font-size:12px;margin:6px 0 6px">Tillgängligt i abonnemang (globalt):</div>
      <div class="streaming-row collapsed">${pills}</div>
      <button type="button" class="streaming-toggle" style="display:none">…</button>
    </div>
  `;
}

function applyStreamingToggle(root) {
  const row = root.querySelector('.streaming-row');
  const btn = root.querySelector('.streaming-toggle');
  if (!row || !btn) return;

  // visa knappen bara om det finns fler rader
  requestAnimationFrame(() => {
    const needs = row.scrollHeight > row.clientHeight + 2;
    btn.style.display = needs ? 'inline-block' : 'none';
    btn.textContent = '…';
  });

  btn.addEventListener('click', () => {
    const collapsed = row.classList.toggle('collapsed');
    btn.textContent = collapsed ? '…' : 'visa färre';
  });
}

export class FilmNow extends HTMLElement {
  constructor() {
    super();
    this.state = {
      current: null,
      info: null,
      sources: null,
      advancedOpen: false,
      busy: false,
    };

    this._unsub = [];
    this._onWhoChange = this._onWhoChange.bind(this);
  }

  connectedCallback() {
    this.render();

    // re-render när "vem är inloggad" ändras
    this._unsub.push(on('who', this._onWhoChange));

    // initial laddning
    this.refresh();
  }

  disconnectedCallback() {
    for (const u of this._unsub) try { u(); } catch { }
    this._unsub = [];
  }

  _onWhoChange() {
    // UI-texten "Inloggad" ska uppdateras direkt
    const whoEl = this.querySelector('[data-now-who]');
    if (whoEl) whoEl.textContent = getWho();
    // wishlist/andra moduler lyssnar själva; här räcker att refresh för att hämta ny #1
    this.refresh();
  }

  setBusy(on) {
    this.state.busy = !!on;
    this.querySelectorAll('button').forEach((b) => (b.disabled = this.state.busy));
  }

  resetScoresUI() {
    PEOPLE.forEach((p) => {
      const el = this.querySelector(`#now-s-${CSS.escape(p)}`);
      if (el) el.value = '';
    });
  }

  async resetScoresOnServer() {
    // nollställ alla poäng i backend (som gamla index gjorde efter spara/hoppa)
    const empty = {};
    PEOPLE.forEach((p) => (empty[p] = ''));
    try {
      await api('saveScores', { scores: JSON.stringify(empty) });
    } catch { }
  }

  async refresh() {
    try {
      this.setBusy(true);
      const cur = await api('getCurrent');
      this.state.current = cur?.ok ? cur : null;

      this.applyCurrentToUI();
      await this.updatePreview();
      this.updateAdvancedOptions();
    } finally {
      this.setBusy(false);
    }
  }

  applyCurrentToUI() {
    const cur = this.state.current;

    const nextName = this.querySelector('#now-nextName');
    const film = this.querySelector('#now-film');

    if (nextName) nextName.value = cur?.next || '';

    // suggested film = serverförslag
    if (film) {
      film.value = (cur?.suggestion || '').trim();
    }

    // scores
    PEOPLE.forEach((p) => {
      const el = this.querySelector(`#now-s-${CSS.escape(p)}`);
      if (!el) return;
      const v = cur?.scores?.[p];
      el.value = (v === 0 ? '' : (v ?? ''));
    });

    // text "Inloggad"
    const whoEl = this.querySelector('[data-now-who]');
    if (whoEl) whoEl.textContent = getWho();
  }

  async updatePreview() {
    const film = (this.querySelector('#now-film')?.value || '').trim();
    const box = this.querySelector('#now-preview');
    if (!box) return;

    if (!film) {
      box.innerHTML = '';
      return;
    }

    box.innerHTML = '<div class="muted" style="font-size:12px">Hämtar…</div>';

    const info = await omdbLookup(film);
    this.state.info = info;

    if (!info) {
      box.innerHTML = `<div class="muted" style="font-size:12px">Hittade inget för: ${esc(film)}</div>`;
      return;
    }

    const poster = (info.Poster && info.Poster !== 'N/A')
      ? `<img class="now-poster" src="${esc(info.Poster)}" alt="poster" loading="lazy" decoding="async">`
      : '';

    const imdbLink = info.imdbID ? `https://www.imdb.com/title/${esc(info.imdbID)}/` : '';
    const imdbTxt = (info.imdbRating && info.imdbRating !== 'N/A') ? `IMDb ${esc(info.imdbRating)}` : 'IMDb';

    // watchmode
    let sourcesHtml = `<div class="muted" style="font-size:12px;margin-top:6px">(klicka för att hämta)</div>`;
    let sources = null;

    // lazy: hämta först när man klickar …
    box.innerHTML = `
      <div class="omdb-info" style="align-items:flex-start">
        ${poster}
        <div>
          <strong>${esc(info.Title || film)}</strong>${info.Year ? ` (${esc(info.Year)})` : ''}<br>
          ${imdbLink ? `${imdbTxt} — <a href="${imdbLink}" target="_blank" rel="noopener">Öppna på IMDb</a>` : imdbTxt}
          <div class="now-stream" data-has="0">
            ${sourcesHtml}
            <button type="button" class="streaming-toggle" style="display:inline-block">…</button>
          </div>
        </div>
      </div>
    `;

    const streamWrap = box.querySelector('.now-stream');
    const btn = box.querySelector('.now-stream .streaming-toggle');

    if (btn && streamWrap) {
      btn.addEventListener('click', async () => {
        const has = streamWrap.getAttribute('data-has') === '1';

        // Om vi redan har pills: toggla collapse
        const row = streamWrap.querySelector('.streaming-row');
        if (has && row) {
          const collapsed = row.classList.toggle('collapsed');
          btn.textContent = collapsed ? '…' : 'visa färre';
          return;
        }

        // Annars: hämta sources
        btn.disabled = true;
        btn.textContent = 'hämtar…';
        sources = await watchmodeSources(info.imdbID);
        this.state.sources = sources;

        streamWrap.innerHTML = buildStreamPills(sources);
        streamWrap.setAttribute('data-has', '1');

        // sätt samma knapp (återanvänd)
        const realBtn = streamWrap.querySelector('.streaming-toggle');
        applyStreamingToggle(streamWrap);

        // om toggle göms (ingen overflow) så finns ingen knapp kvar – men ok.
        // annars: den finns och funkar.

        // klarmarkera
        if (realBtn) {
          realBtn.disabled = false;
        }
      });
    }
  }

  updateAdvancedOptions() {
    const curNext = (this.querySelector('#now-nextName')?.value || '').trim();
    const sel = this.querySelector('#now-jumpTo');
    const btn = this.querySelector('#now-doJump');
    if (!sel || !btn) return;

    const list = orderedFrom(curNext);
    sel.innerHTML = list.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    sel.value = list[0] || '';
    btn.disabled = true;

    sel.onchange = () => {
      const steps = stepsToTarget(curNext, sel.value);
      btn.disabled = (steps === 0);
    };
  }

  async doJump() {
    const curNext = (this.querySelector('#now-nextName')?.value || '').trim();
    const target = (this.querySelector('#now-jumpTo')?.value || '').trim();
    const steps = stepsToTarget(curNext, target);

    if (steps <= 0) return;

    this.setBusy(true);
    try {
      // hoppa i backend: skipNext N gånger
      for (let i = 0; i < steps; i++) {
        await api('skipNext');
      }

      // efter hopp: nollställ poäng (UI + backend)
      this.resetScoresUI();
      await this.resetScoresOnServer();

      // refresh
      await this.refresh();
    } finally {
      this.setBusy(false);
    }
  }

  toggleAdvanced() {
    this.state.advancedOpen = !this.state.advancedOpen;
    const row = this.querySelector('#now-advancedRow');
    if (row) row.style.display = this.state.advancedOpen ? 'flex' : 'none';

    // se till att listan är korrekt när man öppnar
    if (this.state.advancedOpen) this.updateAdvancedOptions();
  }

  async saveNight() {
    const curNext = (this.querySelector('#now-nextName')?.value || '').trim();
    const film = (this.querySelector('#now-film')?.value || '').trim();
    const comment = (this.querySelector('#now-comment')?.value || '').trim();

    if (!curNext || !film) return;

    this.setBusy(true);
    try {
      await api('saveNight', { who: curNext, film, comment });

      // efter spar: nollställ poäng + kommentar
      this.resetScoresUI();
      await this.resetScoresOnServer();
      const c = this.querySelector('#now-comment');
      if (c) c.value = '';

      await this.refresh();
    } finally {
      this.setBusy(false);
    }
  }

  async saveScore(person, value) {
    // sparar en person i taget (som gamla index)
    try {
      await api('saveScores', { scores: JSON.stringify({ [person]: value || '' }) });
    } catch { }
  }

  bindEvents() {
    // update
    this.querySelector('#now-refresh')?.addEventListener('click', () => this.refresh());

    // hoppa över = öppna avancerat (inte direkt hoppa!)
    this.querySelector('#now-skip')?.addEventListener('click', () => this.toggleAdvanced());

    // byt tur
    this.querySelector('#now-doJump')?.addEventListener('click', () => this.doJump());

    // spara kväll
    this.querySelector('#now-saveNight')?.addEventListener('click', () => this.saveNight());

    // sök/preview
    this.querySelector('#now-lookup')?.addEventListener('click', () => this.updatePreview());

    // score change
    PEOPLE.forEach((p) => {
      const el = this.querySelector(`#now-s-${CSS.escape(p)}`);
      if (!el) return;
      el.addEventListener('change', () => this.saveScore(p, el.value));
    });

    // film input: debounce preview
    const film = this.querySelector('#now-film');
    if (film) {
      const upd = debounce(() => this.updatePreview(), 350);
      film.addEventListener('input', upd);
    }
  }

  render() {
    this.innerHTML = `
      <section class="card" id="nowCard">
        <div class="row" style="align-items:center; gap:12px">
          <div>
            <h3 style="margin:0">På tur nu</h3>
            <div class="muted" style="font-size:13px">Inloggad: <strong data-now-who>${esc(getWho())}</strong></div>
          </div>
          <div class="right" style="display:flex; gap:10px">
            <button id="now-refresh" class="ghost">Uppdatera</button>
            <button id="now-skip" class="ghost">Hoppa över</button>
          </div>
        </div>

        <div class="row" style="align-items:flex-end">
          <div class="col">
            <label>Nästa i tur</label>
            <input id="now-nextName" type="text" readonly>
          </div>

          <div class="col" style="flex:2 1 340px">
            <label>Film (förslag)</label>
            <div class="lookup-wrap">
              <input id="now-film" class="lookup-input" type="text" autocomplete="off" spellcheck="false">
              <button id="now-lookup" class="lookup-btn" type="button">Sök</button>
            </div>
            <div id="now-preview" style="margin-top:6px"></div>
          </div>
        </div>

        <div style="margin-top:10px">
          <label>Poäng</label>
          <div id="now-scoresRow" style="display:flex; gap:10px; flex-wrap:nowrap; overflow:auto; padding-bottom:2px">
            ${PEOPLE.map((p) => `
              <div class="score-col" style="min-width:100px; flex:1 1 0">
                <label style="margin:0 0 4px">${esc(p)}</label>
                <select id="now-s-${esc(p)}" class="score-select">
                  <option value="">–</option>
                  <option>1</option><option>2</option><option>3</option><option>4</option><option>5</option>
                  <option>6</option><option>7</option><option>8</option><option>9</option><option>10</option>
                </select>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Hoppa över / avancerat: välj vem som ska vara näst på tur -->
        <div class="row" id="now-advancedRow" style="display:none; gap:10px; align-items:flex-end; margin-top:10px">
          <div class="col" style="min-width:220px; flex:0 0 260px">
            <label>Hoppa till (nästa i tur överst)</label>
            <select id="now-jumpTo"></select>
          </div>
          <div class="col" style="flex:0 0 auto">
            <button id="now-doJump" class="ghost" disabled>Byt tur</button>
          </div>
          <div class="col" style="flex:1 1 auto">
            <div class="muted" style="font-size:12px">Används bara vid undantag. Vanligtvis tar man sin tur.</div>
          </div>
        </div>

        <div class="row" style="align-items:flex-end; margin-top:10px">
          <div class="col" style="flex:2 1 340px">
            <label>Kommentar</label>
            <input id="now-comment" placeholder="valfritt">
          </div>
          <div class="col" style="flex:0 0 auto; align-self:end">
            <button id="now-saveNight" class="primary">Spara kväll</button>
          </div>
        </div>
      </section>
    `;

    // extra CSS som är specifik för previewn (för små thumbnails + collapsed streaming)
    // (vi lägger inline-style här för att slippa hoppa till styles.css)
    const style = document.createElement('style');
    style.textContent = `
      #nowCard .omdb-info{ display:flex; gap:10px; align-items:flex-start; }
      #nowCard .now-poster{ width:46px; height:auto; border-radius:8px; border:1px solid var(--border); }
      #nowCard .streaming-row{ display:flex; flex-wrap:wrap; gap:6px; }
      #nowCard .streaming-row.collapsed{ max-height:34px; overflow:hidden; }
      #nowCard .streaming-toggle{ margin-top:6px; font-size:12px; padding:0; border:none; background:transparent; text-decoration:underline; cursor:pointer; color:var(--muted); }
      @media (max-width:640px){
        #nowCard .right{ width:100%; justify-content:flex-start; }
      }
    `;
    this.appendChild(style);

    this.bindEvents();
  }
}

customElements.define('film-now', FilmNow);
