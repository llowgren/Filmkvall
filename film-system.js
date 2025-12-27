// film-system.js
// System-kort: tema + felsökning/status
// Viktigt: vi importerar api.js som namespace (*) så att filen INTE kraschar
// om api.js ändrar export-namn. Då laddas komponenten alltid.

import { getWho, getAuth, getTheme, setTheme, on, getDebugSnapshot } from './store.js';
import * as Api from './api.js';

function pickApiUrl() {
  // Försök hitta en sträng eller funktion i api.js utan att anta exakt namn.
  const candidates = [
    Api.apiUrl,
    Api.API_URL,
    Api.API,
    Api.getApiUrl,
    Api.getURL,
    Api.url,
  ];

  for (const c of candidates) {
    try {
      if (typeof c === 'string' && c) return c;
      if (typeof c === 'function') {
        const v = c();
        if (typeof v === 'string' && v) return v;
      }
    } catch {}
  }
  return '';
}

async function callApiSafe(action, params = {}) {
  // Försök hitta en fungerande API-funktion.
  const fns = [
    Api.callApi,
    Api.api,
    Api.request,
    Api.fetchApi,
  ].filter(Boolean);

  for (const fn of fns) {
    if (typeof fn !== 'function') continue;
    try {
      return await fn(action, params);
    } catch (e) {
      // prova nästa
    }
  }

  // Fallback: om apiUrl finns så kan vi göra enkel GET (kräver att api.js inte behövs)
  const base = pickApiUrl();
  if (!base) throw new Error('api.js saknar callApi/api och ingen apiUrl hittades');

  const a = getAuth?.() || { pw: '', token: '' };
  const qs = new URLSearchParams({ action, ...params });
  // Om er backend kräver pw/token i querystring, lägg dem här.
  // (I er äldre kod användes pw; token används ibland.)
  if (a.pw) qs.set('pw', a.pw);
  if (a.token) qs.set('token', a.token);

  const url = base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`;
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json();
  return j;
}

class FilmSystem extends HTMLElement {
  connectedCallback() {
    this.render();

    this._unsubWho = on('who', () => this.update());
    this._unsubAuth = on('auth', () => this.update());
    this._unsubTheme = on('theme', () => this.updateThemeUI());

    this.querySelector('#sysTheme')?.addEventListener('change', (e) => {
      setTheme(e.target.value); // 'auto'|'dark'|'light'
      // setTheme() applicerar direkt till DOM via store.applyThemeToDom().
      // Detta extra steg är bara för att göra UI stabilt.
      this.updateThemeUI();
    });

    this.querySelector('#sysRefresh')?.addEventListener('click', () => this.refresh());
    this.querySelector('#sysCopy')?.addEventListener('click', () => this.copyStatus());

    this.refresh();
  }

  disconnectedCallback() {
    this._unsubWho?.();
    this._unsubAuth?.();
    this._unsubTheme?.();
  }

  render() {
    this.innerHTML = `
      <div class="card" id="systemCard">
        <style>
          /* Lokala layout-fixar så System inte "spricker" på smal skärm */
          #systemCard .sys-top{
            display:flex;
            gap:16px;
            align-items:flex-start;
            flex-wrap:wrap;
          }
          #systemCard .sys-title{min-width:200px; flex:1 1 220px;}
          #systemCard .sys-theme{min-width:200px; flex:0 0 220px;}
          #systemCard .sys-status{min-width:220px; flex:1 1 260px;}
          #systemCard .sys-actions{flex:1 1 220px; display:flex; gap:10px; justify-content:flex-end; align-items:flex-end;}
          #systemCard .sys-actions button{white-space:nowrap;}
          #systemCard pre{background:var(--input); border:1px solid var(--border); border-radius:12px; padding:12px; overflow:auto;}
          #systemCard details > summary{list-style:none;}
          #systemCard details > summary::-webkit-details-marker{display:none;}
          #systemCard .summaryRow{display:flex; align-items:center; gap:8px;}
          #systemCard .chev{display:inline-block; width:18px; text-align:center; opacity:.7;}
          #systemCard details[open] .chev{transform:rotate(90deg)}
        </style>

        <div class="sys-top">
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

        <details style="margin-top:12px" open>
          <summary class="muted" style="cursor:pointer">
            <span class="summaryRow"><span class="chev">▶</span><span>Felsökning / status</span></span>
          </summary>

          <div class="row" style="margin-top:12px; align-items:flex-start">
            <div class="col" style="min-width:260px">
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

            <div class="col" style="min-width:320px">
              <label>Lokal konfig</label>
              <pre id="dbgLocal" style="margin:0"></pre>
            </div>

            <div class="col" style="min-width:320px">
              <label>Remote check (getCurrent)</label>
              <pre id="dbgRemote" style="margin:0"></pre>
            </div>
          </div>
        </details>
      </div>
    `;

    this.update();
    this.updateThemeUI();
  }

  updateThemeUI() {
    const sel = this.querySelector('#sysTheme');
    if (sel) sel.value = getTheme?.() || 'auto';

    const dbgTheme = this.querySelector('#dbgTheme');
    if (dbgTheme) dbgTheme.textContent = getTheme?.() || 'auto';
  }

  update() {
    const who = getWho?.() || '–';
    const auth = getAuth?.() || { pw: '', token: '' };

    this.querySelector('#dbgWho').textContent = who;

    const api = pickApiUrl();
    const dbgApi = this.querySelector('#dbgApi');
    if (dbgApi) dbgApi.textContent = api || '–';

    const dbgPw = this.querySelector('#dbgPw');
    if (dbgPw) dbgPw.textContent = auth.pw ? '(satt)' : '(ej satt)';

    const dbgToken = this.querySelector('#dbgToken');
    if (dbgToken) dbgToken.textContent = auth.token ? '(satt)' : '(ej satt)';

    const snap = (typeof getDebugSnapshot === 'function') ? getDebugSnapshot() : {
      who,
      theme: getTheme?.() || 'auto',
      auth: { pw: auth.pw ? '(satt)' : '', token: auth.token ? '(satt)' : '' }
    };

    const local = {
      ...snap,
      apiUrl: api || ''
    };

    const pre = this.querySelector('#dbgLocal');
    if (pre) pre.textContent = JSON.stringify(local, null, 2);
  }

  async refresh() {
    const statusEl = this.querySelector('#sysStatus');
    const btn = this.querySelector('#sysRefresh');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Uppdaterar…';
    }
    if (statusEl) {
      statusEl.textContent = 'Testar API…';
      statusEl.className = 'pill';
    }

    const started = performance.now();
    try {
      const sample = await callApiSafe('getCurrent', {});
      const ms = Math.round(performance.now() - started);

      if (statusEl) {
        statusEl.textContent = `OK – API svarar (${ms} ms)`;
        statusEl.className = 'pill ok';
      }

      const pre = this.querySelector('#dbgRemote');
      if (pre) {
        pre.textContent = JSON.stringify({ httpOk: true, ms, sample }, null, 2);
      }

      // Tokens: vi markerar bara om nycklarna finns i api.js (ingen hemlighet visas)
      const tokens = {
        tmdb: Boolean(Api.TMDB_KEY || Api.tmdbKey),
        omdb: Boolean(Api.OMDB_KEY || Api.omdbKey),
        watchmode: Boolean(Api.WATCHMODE_KEY || Api.watchmodeKey)
      };
      const tokEl = this.querySelector('#dbgTokens');
      if (tokEl) {
        tokEl.textContent = `TMDb: ${tokens.tmdb ? '✓' : '–'}  ·  OMDb: ${tokens.omdb ? '✓' : '–'}  ·  Watchmode: ${tokens.watchmode ? '✓' : '–'}`;
      }

      this.update();
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = 'Fel – API svarar inte';
        statusEl.className = 'pill err';
      }
      const pre = this.querySelector('#dbgRemote');
      if (pre) {
        pre.textContent = JSON.stringify({ httpOk: false, error: String(e?.message || e) }, null, 2);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Uppdatera';
      }
    }
  }

  async copyStatus() {
    const payload = {
      local: safeJson(this.querySelector('#dbgLocal')?.textContent),
      remote: safeJson(this.querySelector('#dbgRemote')?.textContent)
    };
    const text = JSON.stringify(payload, null, 2);

    try {
      await navigator.clipboard.writeText(text);
      const statusEl = this.querySelector('#sysStatus');
      if (statusEl) {
        statusEl.textContent = 'Kopierat ✅';
        statusEl.className = 'pill ok';
        setTimeout(() => this.refresh(), 400);
      }
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }

    function safeJson(s) {
      try { return JSON.parse(s || 'null'); } catch { return s || null; }
    }
  }
}

customElements.define('film-system', FilmSystem);
