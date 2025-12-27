// film-tops.js
// Topplistor (topp 5) – fristående modul

import { api } from './api.js';
import { on } from './store.js';

const DEFAULT_LIMIT = 5;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function round1(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 10) / 10);
}

class FilmTops extends HTMLElement {
  constructor() {
    super();
    this._unsubs = [];
    this._busy = false;
  }

  connectedCallback() {
    this.render();

    // Om ni senare vill kunna filtrera topplistor per användare, så är hooken redan här.
    // Just nu laddar vi bara om när "who" ändras för att det känns konsekvent i UI.
    this._unsubs.push(on('who', () => this.load({ quiet: true })));

    // första laddning
    this.load({ quiet: true });
  }

  disconnectedCallback() {
    for (const u of this._unsubs) {
      try { u(); } catch { }
    }
    this._unsubs = [];
  }

  setBusy(v) {
    this._busy = !!v;
    const btn = this.querySelector('[data-action="refresh"]');
    if (btn) btn.disabled = this._busy;
  }

  async load({ quiet = false } = {}) {
    if (this._busy) return;
    this.setBusy(true);

    const statusEl = this.querySelector('[data-role="status"]');
    const leftEl = this.querySelector('[data-role="bestFilms"]');
    const rightEl = this.querySelector('[data-role="bestPickers"]');

    if (!quiet && statusEl) statusEl.textContent = 'Hämtar…';

    try {
      const j = await api('getTops', { limit: DEFAULT_LIMIT });

      if (!j || !j.ok) {
        const msg = j?.error ? String(j.error) : 'Kunde inte hämta topplistor.';
        if (statusEl) statusEl.textContent = msg;
        if (leftEl) leftEl.innerHTML = `<div class="muted">${escapeHtml(msg)}</div>`;
        if (rightEl) rightEl.innerHTML = '';
        return;
      }

      if (statusEl) statusEl.textContent = '';

      const bestFilms = Array.isArray(j.bestFilms) ? j.bestFilms : [];
      const bestPickers = Array.isArray(j.bestPickers) ? j.bestPickers : [];

      if (leftEl) {
        leftEl.innerHTML = bestFilms.length
          ? bestFilms.map((x) => {
              const film = escapeHtml(x.film ?? '');
              const avg = escapeHtml(round1(x.avg));
              const who = escapeHtml(x.who ?? '');
              return `
                <div class="pill" style="display:flex; gap:10px; align-items:baseline; justify-content:space-between;">
                  <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${film}</span>
                  <span style="flex:0 0 auto;">
                    <strong>${avg}</strong>
                    <span class="muted" style="margin-left:8px;">(${who})</span>
                  </span>
                </div>
              `;
            }).join('')
          : `<div class="muted">Inga toppliste-data ännu.</div>`;
      }

      if (rightEl) {
        rightEl.innerHTML = bestPickers.length
          ? bestPickers.map((x) => {
              const who = escapeHtml(x.who ?? '');
              const avg = escapeHtml(round1(x.avg));
              const n = escapeHtml(x.n ?? '');
              return `
                <div class="pill" style="display:flex; gap:10px; align-items:baseline; justify-content:space-between;">
                  <span>${who}</span>
                  <span style="flex:0 0 auto;">
                    <strong>${avg}</strong>
                    <span class="muted" style="margin-left:8px;">(${n} filmer)</span>
                  </span>
                </div>
              `;
            }).join('')
          : `<div class="muted">Inga toppliste-data ännu.</div>`;
      }

      // Liten “flash” på kortet när vi uppdaterat
      const card = this.querySelector('.card');
      if (card) {
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 700);
      }
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      if (statusEl) statusEl.textContent = msg;
      if (leftEl) leftEl.innerHTML = `<div class="muted">${escapeHtml(msg)}</div>`;
      if (rightEl) rightEl.innerHTML = '';
    } finally {
      this.setBusy(false);
    }
  }

  render() {
    // Vi använder era globala styles (.card, .row, .col, .pill, .muted, .flash)
    // så vi kör light DOM (ingen shadow).
    this.innerHTML = `
      <div class="card" id="tops">
        <div class="row" style="align-items:center; gap:10px;">
          <h3 style="margin:0;">Topplistor (topp ${DEFAULT_LIMIT})</h3>
          <span class="right"></span>
          <button class="ghost" data-action="refresh" type="button">Uppdatera</button>
        </div>

        <div class="muted" data-role="status" style="margin-top:6px;"></div>

        <div class="row" style="margin-top:10px;">
          <div class="col" style="display:flex; flex-direction:column; gap:8px;">
            <label>Bästa filmer</label>
            <div data-role="bestFilms"></div>
          </div>
          <div class="col" style="display:flex; flex-direction:column; gap:8px;">
            <label>Bästa väljare</label>
            <div data-role="bestPickers"></div>
          </div>
        </div>
      </div>
    `;

    const btn = this.querySelector('[data-action="refresh"]');
    if (btn) {
      btn.addEventListener('click', async () => {
        // gråa ut/stoppa dubbelklick
        if (this._busy) return;
        btn.disabled = true;
        try {
          await this.load({ quiet: false });
        } finally {
          btn.disabled = false;
        }
      }, { passive: true });
    }
  }
}

customElements.define('film-tops', FilmTops);
