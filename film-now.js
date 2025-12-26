// film-now.js
// <film-now> – “På tur nu”-modulen (UI + API-koppling)
// Mål: samma beteende som gamla singelfilen, men fristående.
//
// Viktigt beteende:
// - "Hoppa över" öppnar avancerad vy där man kan välja vem som ska vara näst på tur.
// - När man sparar en kväll eller byter tur (hoppa/byt tur), nollställs poäng (UI + backend).
// - Thumbnail liten. Streaming visas kollapsat (bara första raden) tills man expanderar.
// - Knappar gråas ut och låses under pågående kommando för att undvika dubbeltryck.

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

  // visa bara abonnemang (“sub”)
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
  if (!sources?.length) {
    return '<div class="muted" style="font-size:12px">Inget abonnemang hittades just nu.</div>';
  }

  const pills = sources.map((s) => {
    const label = `${s.service}${s.quality ? ` ${s.quality}` : ''}${s.region ? ` · ${s.region}` : ''}`;
    const href = s.url ? `href="${esc(s.url)}" target="_blank" rel="noopener"` : '';
    return `<a ${href} class="pill" style="text-decoration:none">${esc(label)} (ingår)</a>`;
  }).join('');

  // collapsed visar bara första raden
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

    this._bound = false;
    this._onJumpSelChange = null;
  }

  connectedCallback() {
    this.render();

    // re-render när "vem är inloggad" ändras
    this._unsub.push(on('who', this._onWhoChange));

    // initial laddning
    this.refresh();
  }

  disconnectedCallback() {
    for (const u of this._unsub) {
      try { u(); } catch { }
    }
    this._unsub = [];
  }

  _onWhoChange() {
    // UI-texten "Inloggad" ska uppdateras direkt
    const whoEl = this.querySelector('[data-now-who]');
    if (whoEl) whoEl.textContent = getWho();
    // refresh så vi får uppdaterad suggestion för ny användare
    this.refresh();
  }

  // --- Busy / dubbeltrycksskydd
  setBusy(on, { onlyButtons = null, labelWhileBusy = '…' } = {}) {
    this.state.busy = !!on;

    const btns = (onlyButtons && onlyButtons.length)
      ? onlyButtons
      : Array.from(this.querySelectorAll('button'));

    for (const b of btns) {
      if (!b) continue;
      if (this.state.busy) {
        b.disabled = true;
        b.classList.add('is-busy');
        if (!b.dataset.originalText) b.dataset.originalText = b.textContent;
        b.textContent = labelWhileBusy;
      } else {
        b.disabled = false;
        b.classList.remove('is-busy');
        if (b.dataset.originalText) {
          b.textContent = b.dataset.originalText;
          delete b.dataset.originalText;
        }
      }
    }

    this.toggleAttribute('aria-busy', this.state.busy);
  }

  _allActionButtons() {
    const ids = ['#now-refresh', '#now-skip', '#now-lookup', '#now-saveNight', '#now-doJump'];
    return ids.map((id) => this.querySelector(id)).filter(Boolean);
  }

  resetScoresUI() {
    PEOPLE.forEach((p) => {
      const el = this.querySelector(`#now-s-${CSS.escape(p)}`);
      if (el) el.value = '';
    });
  }

  async resetScoresOnServer() {
    // nollställ alla poäng i backend
    const empty = {};
    PEOPLE.forEach((p) => (empty[p] = ''));
    try {
      await api('saveScores', { scores: JSON.stringify(empty) });
    } catch { }
  }

  async refresh() {
    if (this.state.busy) return;

    const btn = this.querySelector('#now-refresh');
    this.setBusy(true, { onlyButtons: [btn], labelWhileBusy: '…' });

    try {
      const cur = await api('getCurrent');
      this.state.current = cur?.ok ? cur : null;

      this.applyCurrentToUI();
      await this.updatePreview();
      this.updateAdvancedOptions({ preserveSelection: true });
    } finally {
      this.setBusy(false, { onlyButtons: [btn] });
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

    // advanced-knappen "Byt tur" ska spegla vald person
    this.syncJumpButton();
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

    // lazy streaming
    box.innerHTML = `
      <div class="now-previewRow">
        <div class="now-previewLeft">
          ${poster}
        </div>
        <div class="now-previewRight">
          <div class="now-previewTitle">
            <strong>${esc(info.Title || film)}</strong>${info.Year ? ` (${esc(info.Year)})` : ''}
          </div>
          <div class="now-previewMeta">
            ${imdbLink ? `${imdbTxt} — <a href="${imdbLink}" target="_blank" rel="noopener">Öppna på IMDb</a>` : imdbTxt}
          </div>
        </div>
        <div class="now-previewStreams">
          <div class="muted" style="font-size:12px">Tillgängligt i abonnemang:</div>
          <div class="muted" style="font-size:12px;margin-top:6px">(klicka för att hämta)</div>
          <button type="button" class="streaming-toggle" style="display:inline-block">…</button>
        </div>
      </div>
    `;

    const streamBox = box.querySelector('.now-previewStreams');
    const btn = streamBox?.querySelector('.streaming-toggle');

    if (btn && streamBox) {
      btn.addEventListener('click', async () => {
        // Om vi redan har pills: toggla collapse
        const row = streamBox.querySelector('.streaming-row');
        if (row) {
          const collapsed = row.classList.toggle('collapsed');
          btn.textContent = collapsed ? '…' : 'visa färre';
          return;
        }

        // Annars: hämta sources
        btn.disabled = true;
        btn.classList.add('is-busy');
        btn.textContent = 'hämtar…';

        const sources = await watchmodeSources(info.imdbID);
        this.state.sources = sources;

        streamBox.innerHTML = buildStreamPills(sources);
        applyStreamingToggle(streamBox);

        // knappen kan ha dolts om det inte finns overflow — okej.
      });
    }
  }

  updateAdvancedOptions({ preserveSelection = true } = {}) {
    const curNext = (this.querySelector('#now-nextName')?.value || '').trim();
    const sel = this.querySelector('#now-jumpTo');
    if (!sel) return;

    const prev = (sel.value || '').trim();
    const list = orderedFrom(curNext);
    sel.innerHTML = list.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');

    const nextVal = (preserveSelection && prev && list.includes(prev)) ? prev : (list[0] || '');
    sel.value = nextVal;

    this.syncJumpButton();

    // bind onchange exakt en gång
    if (!this._onJumpSelChange) {
      this._onJumpSelChange = () => this.syncJumpButton();
      sel.addEventListener('change', this._onJumpSelChange);
    }
  }

  syncJumpButton() {
    const curNext = (this.querySelector('#now-nextName')?.value || '').trim();
    const sel = this.querySelector('#now-jumpTo');
    const btn = this.querySelector('#now-doJump');
    if (!sel || !btn) return;
    const steps = stepsToTarget(curNext, sel.value);
    btn.disabled = (steps === 0) || this.state.busy;
  }

  async doJump() {
    if (this.state.busy) return;

    const curNext = (this.querySelector('#now-nextName')?.value || '').trim();
    const target = (this.querySelector('#now-jumpTo')?.value || '').trim();
    const steps = stepsToTarget(curNext, target);
    if (steps <= 0) return;

    const btns = this._allActionButtons();
    this.setBusy(true, { onlyButtons: btns, labelWhileBusy: '…' });

    try {
      for (let i = 0; i < steps; i++) await api('skipNext');

      // Efter hopp: nollställ poäng (UI + backend)
      this.resetScoresUI();
      await this.resetScoresOnServer();

      await this.refresh();

      // Stäng avancerat efter utfört hopp
      this.state.advancedOpen = false;
      const row = this.querySelector('#now-advancedRow');
      if (row) row.style.display = 'none';
    } finally {
      this.setBusy(false, { onlyButtons: btns });
      this.syncJumpButton();
    }
  }

  toggleAdvanced(forceOpen = null) {
    if (forceOpen === true) this.state.advancedOpen = true;
    else if (forceOpen === false) this.state.advancedOpen = false;
    else this.state.advancedOpen = !this.state.advancedOpen;

    const row = this.querySelector('#now-advancedRow');
    if (row) row.style.display = this.state.advancedOpen ? 'flex' : 'none';

    // se till att listan är korrekt när man öppnar
    if (this.state.advancedOpen) {
      this.updateAdvancedOptions({ preserveSelection: false });
    }
  }

  async saveNight() {
    if (this.state.busy) return;

    const curNext = (this.querySelector('#now-nextName')?.value || '').trim();
    const film = (this.querySelector('#now-film')?.value || '').trim();
    const comment = (this.querySelector('#now-comment')?.value || '').trim();

    if (!curNext || !film) return;

    const btns = this._allActionButtons();
    this.setBusy(true, { onlyButtons: btns, labelWhileBusy: '…' });

    try {
      await api('saveNight', { who: curNext, film, comment });

      // Efter spara: nollställ poäng (UI + backend) + rensa kommentar
      this.resetScoresUI();
      await this.resetScoresOnServer();
      const c = this.querySelector('#now-comment');
      if (c) c.value = '';

      await this.refresh();
    } finally {
      this.setBusy(false, { onlyButtons: btns });
      this.syncJumpButton();
    }
  }

  async saveScore(person, value) {
    // sparar en person i taget
    try {
      await api('saveScores', { scores: JSON.stringify({ [person]: value || '' }) });
    } catch { }
  }

  bindEvents() {
    if (this._bound) return;
    this._bound = true;

    // update
    this.querySelector('#now-refresh')?.addEventListener('click', () => this.refresh());

    // hoppa över = öppna avancerat (inte direkt hoppa!)
    this.querySelector('#now-skip')?.addEventListener('click', () => this.toggleAdvanced(true));

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
        <h3 style="margin:0 0 10px">På tur nu</h3>

        <!-- Rad 1: Filmväljare vänster, knappar höger -->
        <div class="now-topRow">
          <div class="now-topLeft">
            <div class="muted" style="font-size:13px">Inloggad: <strong data-now-who>${esc(getWho())}</strong></div>
            <div class="now-chooser">
              <label>Filmväljare</label>
              <input id="now-nextName" type="text" readonly>
            </div>
          </div>

          <div class="now-topRight">
            <button id="now-refresh" class="ghost">Uppdatera</button>
            <button id="now-skip" class="ghost">Hoppa över</button>
          </div>
        </div>

        <!-- Rad 2: Film-titel -->
        <div class="now-filmRow">
          <label>Film (förslag)</label>
          <div class="lookup-wrap">
            <input id="now-film" class="lookup-input" type="text" autocomplete="off" spellcheck="false">
            <button id="now-lookup" class="lookup-btn" type="button">Sök</button>
          </div>
        </div>

        <!-- Rad 3: Thumbnail vänster, streaming höger -->
        <div id="now-preview" class="now-preview"></div>

        <!-- Poäng -->
        <div style="margin-top:12px">
          <label>Poäng</label>
          <div id="now-scoresRow" class="now-scoresRow">
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

    // CSS som är specifik för just den här modulen
    const style = document.createElement('style');
    style.textContent = `
      #nowCard .now-topRow{display:flex; align-items:flex-start; gap:16px;}
      #nowCard .now-topLeft{flex:1 1 auto; min-width:260px;}
      #nowCard .now-topRight{margin-left:auto; display:flex; gap:10px; justify-content:flex-end; align-items:flex-start;}

      #nowCard .now-chooser{margin-top:8px; max-width:520px;}

      #nowCard .now-filmRow{margin-top:10px;}

      /* Preview-layout: thumbnail vänster, streams höger */
      #nowCard .now-preview{margin-top:10px;}
      #nowCard .now-previewRow{display:flex; align-items:flex-start; gap:12px;}
      #nowCard .now-previewLeft{flex:0 0 auto;}
      #nowCard .now-previewRight{flex:1 1 auto;}
      #nowCard .now-previewStreams{flex:0 0 340px; text-align:right;}
      #nowCard .now-previewTitle{font-size:13px; color:var(--muted);}
      #nowCard .now-previewMeta{font-size:13px; color:var(--muted); margin-top:2px;}
      #nowCard .now-previewMeta a{color:inherit; text-decoration:underline;}

      /* Thumbnail mindre */
      #nowCard .now-poster{width:44px; height:auto; border-radius:8px; border:1px solid var(--border);}

      /* Streaming: visa bara första raden */
      #nowCard .streaming-row{display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end;}
      #nowCard .streaming-row.collapsed{max-height:34px; overflow:hidden;}
      #nowCard .streaming-toggle{margin-top:6px; font-size:12px; padding:0; border:none; background:transparent; text-decoration:underline; cursor:pointer; color:var(--muted);}

      /* Poängrad */
      #nowCard .now-scoresRow{display:flex; gap:10px; flex-wrap:nowrap; overflow:auto; padding-bottom:2px;}

      /* Gråa ut knappar när kommandot kör */
      #nowCard button.is-busy{opacity:.55; cursor:not-allowed;}

      @media (max-width:980px){
        #nowCard .now-previewStreams{flex-basis:260px;}
      }
      @media (max-width:820px){
        #nowCard .now-topRow{flex-direction:column;}
        #nowCard .now-topRight{width:100%; justify-content:flex-start;}
        #nowCard .now-previewRow{flex-direction:column;}
        #nowCard .now-previewStreams{text-align:left; width:100%;}
        #nowCard .streaming-row{justify-content:flex-start;}
      }
    `;
    this.appendChild(style);

    this.bindEvents();

    // bygg advanced dropdown direkt
    this.updateAdvancedOptions({ preserveSelection: false });
  }
}

customElements.define('film-now', FilmNow);
