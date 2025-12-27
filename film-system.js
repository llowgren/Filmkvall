// film-system.js
// System: theme selector + debug/status. Reads/writes global state via store.

import { getWho, getAuth, getTheme, setTheme, getDebugSnapshot, on } from './store.js';
import * as Api from './api.js';

function pickApiHelpers() {
  // Tries to adapt to different api.js shapes.
  // Preferred:
  //   export const apiUrl = '...';
  //   export async function callApi(action, params) { ... }
  const apiUrl =
    (typeof Api.apiUrl === 'string') ? Api.apiUrl :
    (typeof Api.API_URL === 'string') ? Api.API_URL :
    (typeof Api.getApiUrl === 'function') ? Api.getApiUrl() :
    '';

  const callApi =
    (typeof Api.callApi === 'function') ? Api.callApi :
    (typeof Api.api === 'function') ? Api.api :
    (typeof Api.call === 'function') ? Api.call :
    null;

  return { apiUrl, callApi };
}

class FilmSystem extends HTMLElement {
  connectedCallback() {
    this.render();

    this._unsubWho = on('who', () => this.update());
    this._unsubAuth = on('auth', () => this.update());
    this._unsubTheme = on('theme', () => this.updateThemeUI());

    this.$('#sysTheme')?.addEventListener('change', (e) => {
      setTheme(e.target.value);
    });

    this.$('#sysRefresh')?.addEventListener('click', () => this.refresh());
    this.$('#sysCopy')?.addEventListener('click', () => this.copyStatus());

    // initial
    this.update();
    this.updateThemeUI();
    this.refresh();
  }

  disconnectedCallback() {
    this._unsubWho?.();
    this._unsubAuth?.();
    this._unsubTheme?.();
  }

  $(sel) {
    return this.querySelector(sel);
  }

  render() {
    // IMPORTANT: No Shadow DOM (so global CSS vars apply).
    this.innerHTML = `
      <div class="card sys" id="systemCard">
        <div class="sys-head">
          <div class="sys-title">
            <h3 style="margin:0">System</h3>
            <div class="muted" style="margin-top:2px">Tema + felsökning/status</div>
          </div>

          <div class="sys-theme">
            <label>Tema</label>
            <select id="sysTheme">
              <option value="auto">Auto</option>
              <option value="dark">Mörkt</option>
              <option value="light">Ljust</option>
            </select>
          </div>

          <div class="sys-status">
            <label>Status</label>
            <div id="sysStatus" class="pill">Init…</div>
          </div>

          <div class="sys-actions">
            <button id="sysRefresh" class="ghost">Uppdatera</button>
            <button id="sysCopy" class="ghost">Kopiera status</button>
          </div>
        </div>

        <details style="margin-top:12px">
          <summary class="muted" style="cursor:pointer">Felsökning / status</summary>

          <div class="sys-grid" style="margin-top:12px">
            <div class="sys-col">
              <div class="row" style="gap:10px">
                <div class="col" style="min-width:120px">
                  <label>Användare</label>
                  <div><strong id="dbgWho">–</strong></div>
                </div>
                <div class="col" style="min-width:120px">
                  <label>Tema</label>
                  <div><strong id="dbgTheme">–</strong></div>
                </div>
              </div>

              <div style="margin-top:10px">
                <label>API</label>
                <div class="muted" style="word-break:break-all" id="dbgApi">–</div>
              </div>

              <div class="row" style="margin-top:10px; gap:10px">
                <div class="col" style="min-width:120px">
                  <label>Auth pw</label>
                  <div id="dbgPw">(ej satt)</div>
                </div>
                <div class="col" style="min-width:120px">
                  <label>Auth token</label>
                  <div id="dbgToken">(ej satt)</div>
                </div>
              </div>

              <div style="margin-top:10px">
                <label>Tokens</label>
                <div class="muted" id="dbgTokens">–</div>
              </div>
            </div>

            <div class="sys-col">
              <label>Lokal konfig</label>
              <pre id="dbgLocal" class="sys-pre"></pre>
            </div>

            <div class="sys-col">
              <label>Remote check (getCurrent)</label>
              <pre id="dbgRemote" class="sys-pre"></pre>
            </div>
          </div>
        </details>
      </div>

      <style>
        /* Scoped to this component via the .sys root (no shadow DOM) */
        .sys .sys-head{
          display:grid;
          grid-template-columns: 1.4fr 1fr 1fr auto;
          gap:16px;
          align-items:end;
        }
        .sys .sys-actions{display:flex; gap:10px; justify-content:flex-end; align-items:end; flex-wrap:wrap;}
        .sys .sys-grid{
          display:grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap:16px;
          align-items:start;
        }
        .sys .sys-pre{
          margin:0;
          white-space:pre-wrap;
          background:var(--input);
          border:1px solid var(--border);
          border-radius:10px;
          padding:10px 12px;
          min-height:120px;
          overflow:auto;
          color:var(--text);
        }
        @media (max-width: 900px){
          .sys .sys-head{grid-template-columns: 1fr 1fr;}
          .sys .sys-actions{justify-content:flex-start;}
          .sys .sys-grid{grid-template-columns: 1fr;}
        }
      </style>
    `;
  }

  updateThemeUI() {
    const t = (getTheme?.() || 'auto');
    const sel = this.$('#sysTheme');
    if (sel && sel.value !== t) sel.value = t;

    const dbgTheme = this.$('#dbgTheme');
    if (dbgTheme) dbgTheme.textContent = t;
  }

  update() {
    const who = getWho?.() || '–';
    const auth = getAuth?.() || { pw:'', token:'' };
    const { apiUrl } = pickApiHelpers();

    this.$('#dbgWho').textContent = who;
    this.$('#dbgApi').textContent = apiUrl || '–';

    this.$('#dbgPw').textContent = auth.pw ? '(satt)' : '(ej satt)';
    this.$('#dbgToken').textContent = auth.token ? '(satt)' : '(ej satt)';

    // Tokens: show if keys exist in api.js (best-effort)
    const tokens = {
      tmdb: Boolean(Api.TMDB_KEY),
      omdb: Boolean(Api.OMDB_KEY),
      watchmode: Boolean(Api.WATCHMODE_KEY)
    };
    this.$('#dbgTokens').textContent =
      `TMDb: ${tokens.tmdb ? '✓' : '–'}  ·  OMDb: ${tokens.omdb ? '✓' : '–'}  ·  Watchmode: ${tokens.watchmode ? '✓' : '–'}`;

    const local = {
      ...((typeof getDebugSnapshot === 'function') ? getDebugSnapshot() : { who, theme: getTheme?.() || 'auto' }),
      apiUrl: apiUrl || ''
    };
    this.$('#dbgLocal').textContent = JSON.stringify(local, null, 2);
  }

  async refresh() {
    const statusEl = this.$('#sysStatus');
    const btn = this.$('#sysRefresh');
    const copyBtn = this.$('#sysCopy');

    const lock = (locked) => {
      if (btn) btn.disabled = locked;
      if (copyBtn) copyBtn.disabled = locked;
    };

    lock(true);
    if (btn) btn.textContent = 'Uppdaterar…';
    if (statusEl) { statusEl.textContent = 'Testar API…'; statusEl.className = 'pill'; }

    const started = performance.now();

    try {
      const { callApi } = pickApiHelpers();
      if (!callApi) throw new Error('api.js saknar callApi/api-funktion');

      const sample = await callApi('getCurrent', {});
      const ms = Math.round(performance.now() - started);

      if (statusEl) {
        statusEl.textContent = `OK – API svarar (${ms} ms)`;
        statusEl.className = 'pill ok';
      }

      this.$('#dbgRemote').textContent = JSON.stringify({ httpOk: true, ms, sample }, null, 2);
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = 'Fel – API svarar inte';
        statusEl.className = 'pill err';
      }
      this.$('#dbgRemote').textContent = JSON.stringify({ httpOk: false, error: String(e?.message || e) }, null, 2);
    } finally {
      lock(false);
      if (btn) btn.textContent = 'Uppdatera';
      this.update();
      this.updateThemeUI();
    }
  }

  async copyStatus() {
    const statusEl = this.$('#sysStatus');

    const payload = {
      local: safeJson(this.$('#dbgLocal')?.textContent),
      remote: safeJson(this.$('#dbgRemote')?.textContent)
    };
    const text = JSON.stringify(payload, null, 2);

    // Grey out while copying
    const btn = this.$('#sysCopy');
    if (btn) { btn.disabled = true; btn.textContent = 'Kopierar…'; }

    try {
      await navigator.clipboard.writeText(text);
      if (statusEl) { statusEl.textContent = 'Kopierat'; statusEl.className = 'pill ok'; }
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
      if (statusEl) { statusEl.textContent = 'Kopierat'; statusEl.className = 'pill ok'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Kopiera status'; }
    }

    function safeJson(s){
      try { return JSON.parse(s || 'null'); } catch { return s || null; }
    }
  }
}

customElements.define('film-system', FilmSystem);
