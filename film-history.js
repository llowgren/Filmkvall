// film-history.js
// Web component: <film-history>
// Visar senaste 10 filmkvällar som en snygg, lättskannad lista.

import { api } from './api.js';

const PEOPLE = ['Hannah', 'Maria', 'Tuva', 'Alva', 'Lars'];

function esc(s) {
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
  if (!isFinite(n)) return '';
  return Math.round(n * 10) / 10;
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return String(iso ?? '');
    // Svenska, men kompakt
    return d.toLocaleDateString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return String(iso ?? '');
  }
}

function calcAvg(row) {
  const nums = PEOPLE
    .map((p) => Number(row?.[p] ?? 0))
    .filter((v) => isFinite(v) && v > 0);
  if (!nums.length) return '–';
  return String(round1(nums.reduce((a, b) => a + b, 0) / nums.length));
}

function scoreLine(row) {
  // Visar bara de som satte poäng (eller alla som "–" om du vill).
  const parts = PEOPLE.map((p) => {
    const v = row?.[p];
    const n = Number(v);
    const show = (isFinite(n) && n > 0) ? String(n) : '–';
    return `<span class="h-pill"><span class="h-pill__k">${esc(p)}</span><span class="h-pill__v">${esc(show)}</span></span>`;
  });
  return parts.join('');
}

class FilmHistory extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._rows = [];
    this._loading = false;
    this._lastErr = '';
  }

  connectedCallback() {
    this.render();
    this.load();
  }

  async load() {
    if (this._loading) return;
    this._loading = true;
    this._lastErr = '';
    this.render();

    try {
      const j = await api('getHistory', { limit: 10 });
      if (!j?.ok) throw new Error(j?.error || 'Kunde inte hämta historik');
      this._rows = Array.isArray(j.rows) ? j.rows : [];
    } catch (e) {
      this._rows = [];
      this._lastErr = String(e?.message || e);
    } finally {
      this._loading = false;
      this.render();
    }
  }

  render() {
    const s = this.shadowRoot;
    if (!s) return;

    const rowsHtml = this._rows.length
      ? this._rows.map((r) => {
          const film = r?.['Film'] ?? '';
          const who = r?.['Vem valde'] ?? '–';
          const date = fmtDate(r?.['Datum']);
          const comment = (r?.['Kommentar'] ?? '').trim();
          const avg = calcAvg(r);

          return `
            <div class="h-item">
              <div class="h-main">
                <div class="h-title">${esc(film || '–')}</div>
                <div class="h-meta">
                  <span class="h-muted">${esc(date)}</span>
                  <span class="h-dot">•</span>
                  <span class="h-muted">Vald av <strong>${esc(who)}</strong></span>
                  <span class="h-dot">•</span>
                  <span class="h-muted">Snitt <span class="h-avg">${esc(avg)}</span></span>
                </div>
                ${comment ? `<div class="h-comment">${esc(comment)}</div>` : ''}
              </div>

              <div class="h-scores" aria-label="Poäng">
                ${scoreLine(r)}
              </div>
            </div>
          `;
        }).join('')
      : `<div class="h-empty">${this._loading ? 'Laddar…' : (this._lastErr ? `Fel: ${esc(this._lastErr)}` : 'Ingen historik än.')}</div>`;

    s.innerHTML = `
      <style>
        :host{ display:block; }

        /* Lutar oss på globala card/typografi, men sätter layout lokalt */
        .card{ background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 18px; margin: 14px 0; }
        .head{ display:flex; align-items:center; gap:12px; }
        .title{ font-size: 18px; margin:0; }
        .spacer{ flex:1; }

        .btn{
          background: var(--btn);
          color: var(--btn-text);
          cursor: pointer;
          border: 1px solid var(--border);
          padding: 10px 14px;
          border-radius: 999px;
          font-size: 14px;
          line-height: 1;
          touch-action: manipulation;
        }
        .btn:disabled{ opacity:.6; cursor:not-allowed; }

        .list{ margin-top: 12px; display:flex; flex-direction:column; gap:12px; }

        .h-item{
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px;
          background: rgba(0,0,0,0.02);
        }
        :host([data-theme="light"]) .h-item{ background: rgba(0,0,0,0.015); }

        .h-main{ display:flex; flex-direction:column; gap:6px; }
        .h-title{ font-size: 16px; font-weight: 700; }
        .h-meta{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
        .h-muted{ color: var(--muted); font-size: 13px; }
        .h-dot{ color: var(--muted); }
        .h-avg{ font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
        .h-comment{ margin-top: 4px; color: var(--text); font-size: 14px; }

        /* Poängrad: wrappar snyggt på iPad */
        .h-scores{ margin-top: 10px; display:flex; flex-wrap:wrap; gap:8px; }

        /* Pills med tabular-nums så siffror känns stabila */
        .h-pill{
          display:inline-flex;
          align-items:center;
          gap:8px;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--pill-bg);
          font-size: 13px;
          line-height: 1;
        }
        .h-pill__k{ color: var(--muted); }
        .h-pill__v{
          min-width: 1.6ch;
          text-align: left;
          font-variant-numeric: tabular-nums;
          font-feature-settings: "tnum" 1;
          font-weight: 650;
        }

        .h-empty{ color: var(--muted); padding: 10px 2px; }

        @media (max-width: 520px){
          .card{ padding: 14px; }
          .h-item{ padding: 12px; }
          .btn{ padding: 10px 12px; }
        }
      </style>

      <section class="card" aria-label="Historik">
        <div class="head">
          <h3 class="title">Historik (senaste 10)</h3>
          <div class="spacer"></div>
          <button class="btn" id="refresh" ${this._loading ? 'disabled' : ''}>${this._loading ? 'Laddar…' : 'Uppdatera'}</button>
        </div>

        <div class="list">${rowsHtml}</div>
      </section>
    `;

    s.getElementById('refresh')?.addEventListener('click', () => this.load());
  }
}

customElements.define('film-history', FilmHistory);
