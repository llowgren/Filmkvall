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

function normLite(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9åäö\s:!?.\-]/g, '')
    .trim();
}

async function smartLookupMovie(query) {
  const q = (query || '').trim();
  if (!q) return null;

  const { tmdb, omdb } = getMovieTokens();

  // 1) TMDb search (sv-SE) -> imdb_id -> OMDb
  try {
    if (tmdb) {
      const r = await fetch(
        `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(tmdb)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(q)}`,
        { cache: 'no-store' }
      );
      if (r.ok) {
        const j = await r.json();
        const res = Array.isArray(j?.results) ? j.results : [];
        if (res.length) {
          const qn = normLite(q);
          const best = res
            .map((it) => {
              const tn = normLite(it.title || it.original_title);
              let score = 0;
              if (tn === qn) score = 100;
              else if (tn.startsWith(qn)) score = 80;
              else if (tn.includes(qn)) score = 60;
              score += Math.min(20, (it.vote_count || 0) / 1000);
              return { score, it };
            })
            .sort((a, b) => b.score - a.score)[0]?.it;

          if (best?.id) {
            const idsR = await fetch(
              `https://api.themoviedb.org/3/movie/${best.id}/external_ids?api_key=${encodeURIComponent(tmdb)}`,
              { cache: 'no-store' }
            );
            const ids = idsR.ok ? await idsR.json() : null;
            const imdbID = ids?.imdb_id || '';

            if (omdb && imdbID) {
              const om = await fetch(
                `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&i=${encodeURIComponent(imdbID)}&plot=short`,
                { cache: 'no-store' }
              );
              const omj = om.ok ? await om.json() : null;
              if (omj && omj.Response !== 'False') return omj;
            }

            // fallback object
            const year = (best.release_date || '').slice(0, 4) || '';
            const poster = best.poster_path ? `https://image.tmdb.org/t/p/w154${best.poster_path}` : 'N/A';
            return {
              Title: best.title || best.original_title || q,
              Year: year,
              Poster: poster,
              imdbID,
              imdbRating: '-'
            };
          }
        }
      }
    }
  } catch (_) {}

  // 2) OMDb direct title search
  try {
    if (omdb) {
      let title = q;
      let year = '';
      const m = title.match(/\((\d{4})\)\s*$/);
      if (m) {
        year = m[1];
        title = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
      }
      const r = await fetch(
        `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdb)}&t=${encodeURIComponent(title)}${year ? `&y=${encodeURIComponent(year)}` : ''}&type=movie&plot=short`,
        { cache: 'no-store' }
      );
      const j = r.ok ? await r.json() : null;
      if (j && j.Response !== 'False') return j;
    }
  } catch (_) {}

  return null;
}

async function tmdbAutocomplete(query, limit = 8) {
  const q = (query || '').trim();
  if (q.length < 3) return [];
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

async function watchmodeSources(imdbID) {
  const { watchmode } = getMovieTokens();
  if (!watchmode || !imdbID) return null;

  // cache 7 days
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
    const normalizeName = (s) => String(s || '').replace(/\s*\(with Ads\)$/i, '').replace(/\s+HD$/, '').trim();

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
  }

  connectedCallback() {
    this.render();
    this.wire();
    this.refresh();

    this._unsubs.push(
      onStore('who', () => {
        // When user changes: refresh block
        this.refresh();
      })
    );
  }

  disconnectedCallback() {
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
    const buttons = [this.$('#btnRefresh'), this.$('#btnSkip'), this.$('#btnLookup'), this.$('#btnSave'), this.$('#btnDoJump'), this.$('#btnSkipOne')];
    for (const b of buttons) {
      if (!b) continue;
      b.disabled = this._busy;
      b.classList.toggle('is-busy', this._busy);
    }
  }

  resetScoresUI() {
    this.querySelectorAll('.score-select').forEach((s) => (s.value = ''));
  }

  async refresh() {
    await this.runLocked(async () => {
      const cur = await api('getCurrent');
      this._lastCurrent = cur;
      this.applyCurrent(cur);
      await this.updateSuggestedInfo();
    }, 350);
  }

  applyCurrent(cur) {
    if (!cur?.ok) return;

    // Filmväljare
    const picker = (cur.next || '').trim();
    const whoEl = this.$('#picker');
    if (whoEl) whoEl.value = picker;

    // suggested title
    const sug = (cur.suggestion || '').trim();
    const input = this.$('#suggested');
    if (input) {
      input.value = sug;
      input.readOnly = false;
    }

    // scores
    if (cur.scores) {
      for (const p of PEOPLE) {
        const el = this.$(`#s-${p}`);
        if (el) el.value = (cur.scores[p] ?? '') === '' ? '' : String(cur.scores[p]);
      }
    }

    // jump list (håll i sync)
    this.updateJumpOptions({ forceDefault: true });
  }

  // Viktigt: listan ska börja på NÄSTA i tur (inte nuvarande),
  // annars känns "Byt tur" som om den inte gör något.
  orderedTurnList() {
    const cur = (this.$('#picker')?.value || '').trim();
    const idx = PEOPLE.indexOf(cur);
    if (idx < 0) {
      // fallback: visa alla om vi inte vet vem som står på tur
      return [...PEOPLE];
    }

    const order = [];
    for (let k = 1; k <= PEOPLE.length; k++) {
      const p = PEOPLE[(idx + k) % PEOPLE.length];
      // exkludera nuvarande helt från dropdown (minskar “inget händer”-känslan)
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

    // Default ska vara NÄSTA i tur
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
      await this.refresh();
      this.setJumpMsg('');
    });
  }

  async doJumpToSelected() {
    const target = (this.$('#jumpTo')?.value || '').trim();
    if (!target) return;
    const steps = this.stepsToPerson(target);
    if (steps === 0) return;

    await this.runLocked(async () => {
      // Direkt feedback + dubbeltrycksskydd (setBusy sker i runLocked)
      this.setJumpMsg(`Byter till ${target}…`);

      for (let i = 0; i < steps; i++) await api('skipNext');

      this.resetScoresUI();
      await this.refresh();

      // Stäng panel + bekräftelse
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

  async saveNight() {
    await this.runLocked(async () => {
      const who = (this.$('#picker')?.value || '').trim();
      const film = (this.$('#suggested')?.value || '').trim();
      const comment = (this.$('#comment')?.value || '').trim();
      if (!who || !film) return;

      await api('saveScores', { scores: JSON.stringify(this.getScoresPayload()) });
      await api('saveNight', { who, film, comment });

      this.resetScoresUI();
      const c = this.$('#comment');
      if (c) c.value = '';

      await this.refresh();
    });
  }

  async updateSuggestedInfo() {
    const q = (this.$('#suggested')?.value || '').trim();
    const info = this.$('#suggested-info');
    if (!info) return;
    if (!q) {
      info.innerHTML = '';
      return;
    }

    const data = await smartLookupMovie(q);
    info.innerHTML = this.renderMovieMeta(data, q);
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
          <div class="muted" style="font-size:12px">Tillgängligt i abonnemang (globalt):</div>
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
        wrap.insertAdjacentHTML('afterbegin', `<div class="muted" style="font-size:12px">Inget abonnemang hittades just nu.</div>`);
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
      if (document.activeElement !== input) return;
      const q = (input.value || '').trim();
      if (q.length < 3) return hide();
      const items = await tmdbAutocomplete(q, 8);
      if (document.activeElement !== input) return;
      show(items);
    }, 520);

    input.addEventListener('input', doSearch);

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
    // logged in
    const logged = this.$('#loggedIn');
    if (logged) logged.textContent = getWho();

    // Keep updated if store changes
    this._unsubs.push(
      onStore('who', (w) => {
        const l = this.$('#loggedIn');
        if (l) l.textContent = w;
      })
    );

    // Buttons
    this.$('#btnRefresh')?.addEventListener('click', () => this.refresh());

    // Hoppa över => öppna panel (inte direkt hoppa)
    this.$('#btnSkip')?.addEventListener('click', () => this.toggleSkipPanel());

    this.$('#btnSkipOne')?.addEventListener('click', () => this.doSkipOne());

    this.$('#jumpTo')?.addEventListener('change', () => {
      const t = (this.$('#jumpTo')?.value || '').trim();
      this.$('#btnDoJump').disabled = !t || this.stepsToPerson(t) === 0;
    });

    this.$('#btnDoJump')?.addEventListener('click', () => this.doJumpToSelected());

    // Sök ska vara på samma rad som titel (UI), och funka både klick och Enter
    this.$('#btnLookup')?.addEventListener('click', () => this.runLocked(() => this.updateSuggestedInfo(), 450));
    this.$('#suggested')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.runLocked(() => this.updateSuggestedInfo(), 450);
      }
    });

    this.$('#btnSave')?.addEventListener('click', () => this.saveNight());

    // Score save per change
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

    // Autocomplete (lugnt)
    this.wireAutocomplete();
  }

  render() {
    this.innerHTML = `
      <div class="card" id="nowCard">

        <div class="topRow">
          <div class="topLeft">
            <h3 style="margin:0">På tur nu</h3>
            <div class="muted">Inloggad: <span id="loggedIn">–</span></div>
          </div>
          <div class="topRight">
            <button id="btnRefresh" class="ghost">Uppdatera</button>
            <button id="btnSkip" class="ghost">Hoppa över</button>
          </div>
        </div>

        <div class="row" style="margin-top:10px">
          <div class="col" style="flex:1 1 340px">
            <label>Filmväljare</label>
            <input id="picker" type="text" readonly>
          </div>
        </div>

        <div class="row" style="margin-top:6px">
          <div class="col" style="flex:1 1 520px">
            <label>Film (förslag)</label>
            <div class="filmRow ac-wrap">
              <input id="suggested" class="lookup-input" autocomplete="off" autocapitalize="off" spellcheck="false">
              <button id="btnLookup" class="lookup-btn">Sök</button>
              <div class="ac-list" id="ac-suggested" style="display:none"></div>
            </div>
          </div>
        </div>

        <div id="suggested-info" class="omdb-info"></div>

        <div id="advancedRow" class="advancedRow" style="display:none">
          <div class="row" style="align-items:end">
            <div class="col" style="min-width:260px; flex:0 0 300px">
              <label>Hoppa till (nästa i tur överst)</label>
              <select id="jumpTo"></select>
            </div>
            <div class="col" style="flex:0 0 auto">
              <button id="btnDoJump" class="ghost" disabled>Byt tur</button>
              <button id="btnSkipOne" class="ghost" style="margin-left:8px">Hoppa en</button>
            </div>
            <div class="col" style="flex:1 1 auto">
              <div id="jumpMsg" class="muted" style="font-size:12px; display:none"></div>
              <div class="muted" style="font-size:12px; margin-top:4px">Används bara vid undantag. Vanligtvis tar man sin tur.</div>
            </div>
          </div>
        </div>

        <div class="row" style="margin-top:14px">
          <div class="col" style="flex:1 1 100%">
            <label>Poäng</label>
            <div id="scoresRow" class="scoresRow">
              ${PEOPLE.map(
                (p) => `
                <div class="score-col">
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

        <div class="row" style="align-items:end; margin-top:10px">
          <div class="col">
            <label>Kommentar</label>
            <input id="comment" placeholder="valfritt">
          </div>
          <div class="col" style="flex:0 0 auto">
            <button id="btnSave" class="primary">Spara kväll</button>
          </div>
        </div>
      </div>

      <style>
        .topRow{display:flex; align-items:flex-start; gap:12px}
        .topRight{margin-left:auto; display:flex; gap:10px}

        .filmRow{display:flex; gap:8px; align-items:center; position:relative}
        .lookup-input{flex:1 1 auto; min-width:0}

        .omdb-info{margin-top:10px}

        .metaGrid{
          display:grid;
          grid-template-columns:112px 1fr 1.6fr;
          gap:14px;
          align-items:start;
        }
        @media (max-width:760px){
          .metaGrid{grid-template-columns:112px 1fr;}
          .metaStream{grid-column:1 / -1;}
        }

        .thumb{width:112px; height:auto; border-radius:12px; border:1px solid var(--border, #dfe3ee)}
        .thumb.ph{height:168px; background:rgba(0,0,0,.06)}

        .metaImdb{display:flex; flex-direction:column; gap:4px; align-self:start}
        .metaImdb a{ text-decoration:underline }

        .metaStream{align-self:start}

        .streamRow{display:flex; flex-wrap:wrap; gap:6px; margin-top:6px}
        .streamRow.collapsed{max-height:86px; overflow:hidden}
        .streamToggle{margin-top:4px; font-size:12px; padding:0; border:none; background:transparent; text-decoration:underline; cursor:pointer; color:var(--muted, #5b6475)}

        .ac-list{position:absolute; left:0; right:0; top:100%; z-index:50; background:var(--panel, #fff); border:1px solid var(--border, #dfe3ee); border-radius:12px; margin-top:6px; overflow:hidden}
        .ac-item{padding:10px 12px; cursor:pointer; border-top:1px solid var(--border, #dfe3ee); font-size:14px}
        .ac-item:first-child{border-top:none}
        .ac-item:hover{filter:brightness(1.03)}
        .ac-muted{color:var(--muted, #5b6475); font-size:12px}

        .scoresRow{display:flex; gap:10px; flex-wrap:nowrap; overflow:auto; padding-bottom:2px}
        .score-col{min-width:100px; flex:1 1 0}
        .score-col select{padding:8px 10px; border-radius:10px; text-align:center; text-align-last:center}

        button.is-busy{opacity:.55; cursor:not-allowed}
      </style>
    `;
  }
}

customElements.define('film-now', FilmNow);