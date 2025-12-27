// film-tops.js
// Topplistor (topp 5) – två tydliga kolumner med snygg align av poäng

import { api } from './api.js';

customElements.define('film-tops', class FilmTops extends HTMLElement {
  connectedCallback(){
    // Light DOM (så global styles.css kan styla .card osv)
    this.innerHTML = `
      <section class="card" id="topsCard">
        <div class="tops-head">
          <h3 style="margin:0">Topplistor (topp 5)</h3>
          <button class="ghost" id="topsRefresh" type="button">Uppdatera</button>
        </div>

        <div id="topsBody" class="tops-body">
          <div class="muted">Laddar…</div>
        </div>
      </section>

      <style>
        /* Header: titel vänster, knapp höger */
        .tops-head{ display:flex; align-items:center; gap:12px; }
        .tops-head #topsRefresh{ margin-left:auto; }

        /* Två listor sida vid sida (stack på mobil) */
        .tops-grid{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap:18px;
          align-items:start;
          margin-top:10px;
        }
        @media (max-width: 720px){
          .tops-grid{ grid-template-columns: 1fr; }
        }

        /* Tydligare separation mellan listorna */
        .tops-col{
          padding:10px 12px;
          border:1px solid var(--border);
          border-radius:12px;
          background: color-mix(in srgb, var(--panel) 92%, transparent);
        }

        .tops-title{
          font-size:13px;
          color: var(--muted);
          margin:0 0 10px;
        }

        /* Rader med grid så siffror hamnar i samma kolumn */
        .tops-row{
          display:grid;
          gap:10px;
          padding:6px 0;
          border-top: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
          align-items:baseline;
        }
        .tops-row:first-child{ border-top:none; }

        /* Filmer: titel | poäng | (vem) */
        .tops-row.film{
          grid-template-columns: 1fr 64px 96px;
        }

        /* Väljare: namn | snitt | (n filmer) */
        .tops-row.picker{
          grid-template-columns: 1fr 64px 120px;
        }

        .tops-name{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        /* VIKTIGT: poängen ska vara VÄNSTERSTÄLLD inom sin kolumn
           så heltalen hamnar under varandra mot samma lodräta linje. */
        .tops-num{
          text-align:left;
          justify-self:start;
          font-variant-numeric: tabular-nums;
          font-feature-settings: "tnum" 1;
          letter-spacing: .02em;
        }

        .tops-meta{
          text-align:left;
          color: var(--muted);
          font-size: 13px;
          min-width:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
      </style>
    `;

    this._btn = this.querySelector('#topsRefresh');
    this._body = this.querySelector('#topsBody');

    this._btn?.addEventListener('click', () => this.refresh({ force:true }));

    // första laddning
    this.refresh({ force:false });
  }

  async refresh({ force=false } = {}){
    if(!this._body) return;

    // Gråa ut knappen under laddning
    const btn = this._btn;
    if(btn){
      btn.disabled = true;
      btn.textContent = 'Hämtar…';
    }

    try{
      const data = await api('getTops', { limit: 5, _ts: force ? Date.now() : undefined });
      this.render(data);
    }catch(e){
      this._body.innerHTML = `<div class="err">Kunde inte hämta topplistor.</div>`;
    }finally{
      if(btn){
        btn.disabled = false;
        btn.textContent = 'Uppdatera';
      }
    }
  }

  render(tops){
    if(!this._body) return;
    if(!tops || !tops.ok){
      this._body.innerHTML = `<div class="muted">Inga topplistor just nu.</div>`;
      return;
    }

    const bestFilms = Array.isArray(tops.bestFilms) ? tops.bestFilms : [];
    const bestPickers = Array.isArray(tops.bestPickers) ? tops.bestPickers : [];

    const filmRows = bestFilms.map(x => `
      <div class="tops-row film">
        <div class="tops-name">${esc(x.film || '')}</div>
        <div class="tops-num"><strong>${esc(x.avg ?? '')}</strong></div>
        <div class="tops-meta">(${esc(x.who || '')})</div>
      </div>
    `).join('') || `<div class="muted">–</div>`;

    const pickerRows = bestPickers.map(x => `
      <div class="tops-row picker">
        <div class="tops-name">${esc(x.who || '')}</div>
        <div class="tops-num"><strong>${esc(x.avg ?? '')}</strong></div>
        <div class="tops-meta">(${esc(x.n ?? '')} filmer)</div>
      </div>
    `).join('') || `<div class="muted">–</div>`;

    this._body.innerHTML = `
      <div class="tops-grid" aria-label="Topplistor">
        <div class="tops-col" aria-label="Bästa filmer">
          <div class="tops-title">Bästa filmer</div>
          ${filmRows}
        </div>
        <div class="tops-col" aria-label="Bästa väljare">
          <div class="tops-title">Bästa väljare</div>
          ${pickerRows}
        </div>
      </div>
    `;
  }
});

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[m]));
}
