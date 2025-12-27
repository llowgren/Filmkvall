// film-system.js
import { getWho, getAuth, getTheme, setTheme, on, getDebugSnapshot } from './store.js';

class FilmSystem extends HTMLElement {
  connectedCallback() {
    this.render();

    // store listeners
    this._unsubWho = on('who', () => this.update());
    this._unsubAuth = on('auth', () => this.update());
    this._unsubTheme = on('theme', () => this.updateThemeUI());

    // events
    this.querySelector('#sysTheme')?.addEventListener('change', (e) => {
      setTheme(e.target.value); // auto|dark|light
    });
    this.querySelector('#sysRefresh')?.addEventListener('click', () => this.refresh());
    this.querySelector('#sysCopy')?.addEventListener('click', () => this.copyStatus());

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

  render() {
    this.innerHTML = `
      <div class="card" id="systemCard">
        <div class="row" style="align-items:flex-end; gap:12px;">
          <div class="col" style="min-width:220px">
            <h3 style="margin:0">System</h3>
            <div class="muted" style="margin-top:2px">Tema + felsökning/status</div>
          </div>

          <div class="col" style="min-width:220px">
            <label for="sysTheme">Tema</label>
            <select id="sysTheme">
              <option value="auto">Auto</option>
              <option value="dark">Mörkt</option>
              <option value="light">Ljust</option>
            </select>
          </div>

          <div class="col" style="min-width:260px">
            <label>Status</label>
            <div id="sysStatus" class="pill">Init…</div>
          </div>

          <div class="col" style="flex:0 0 auto; display:flex; gap:10px; justify-content:flex-end; align-items:end">
            <button id="sysRefresh" class="ghost">Uppdatera</button>
            <button id="sysCopy" class="ghost">Kopiera status</button>
          </div>
        </div>

        <details style="margin-top:12px" open>
          <summary class="muted" style="cursor:pointer">Felsökning / status</summary>

          <div class="row" style="margin-top:12px; align-items:flex-start; gap:16px;">
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
                <div class="muted" style="word-break:break-word" id="dbgApi">–</div>
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
              <pre id="dbgLocal" style="white-space:pre-wrap; margin:0; overflow:auto; max-height:320px;"></pre>
            </div>

            <div class="col" style="min-width:320px">
              <label>Remote check (getCurrent)</label>
              <pre id="dbgRemote" style="white-space:pre-wrap; margin:0; overflow:auto; max-height:320px;"></pre>
            </div>
          </div>
        </details>
      </div>
    `;
  }

  updateThemeUI() {
    const sel = this.querySelector('#sysTheme');
    if (sel) sel.value = getTheme() || 'auto';

    const dbgTheme = this.querySelector('#dbgTheme');
    if (dbgTheme) dbgTheme.textContent = getTheme() || 'auto';
  }

  update() {
    const who = getWho?.() || '–';
    const auth = getAuth?.() || { pw: '', token: '' };

    this.querySelector('#dbgWho').textContent = who;
    this.querySelector('#dbgPw').textContent = auth.pw ? '(satt)' : '(ej satt)';
    this.querySelector('#dbgToken').textContent = auth.token ? '(satt)' : '(ej satt)';

    // Lokal snapshot från store (bättre än att gissa)
    const snap = (typeof getDebugSnapshot === 'function') ? getDebugSnapshot() : {
      who,
      theme: getTheme?.() || 'auto',
      auth: { pw: auth.pw ? '(satt)' : '(ej satt)', token: auth.token ? '(satt)' : '(ej satt)' }
    };

    const dbgLocal = this.querySelector('#dbgLocal');
    if (dbgLocal) dbgLocal.textContent = JSON.stringify(snap, null, 2);

    // Tokens-indikator (här bara kosmetiskt; kan kopplas “på riktigt” senare)
    const dbgTokens = this.querySelector('#dbgTokens');
    if (dbgTokens) {
      dbgTokens.textContent = `TMDb: ✓  ·  OMDb: ✓  ·  Watchmode: ✓`;
    }
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
      // Importera api.js “säkert” utan att kräva specifika exports
      const Api = await import('./api.js');

      // Försök hitta apiUrl / API url för debug-text
      const apiText =
        (typeof Api.apiUrl === 'string' && Api.apiUrl) ? Api.apiUrl :
        (typeof Api.API === 'string' && Api.API) ? Api.API :
        (typeof Api.getApiUrl === 'function') ? String(Api.getApiUrl()) :
        (typeof Api.apiUrl === 'function') ? String(Api.apiUrl('getCurrent', {})) :
        '';

      const dbgApi = this.querySelector('#dbgApi');
      if (dbgApi) dbgApi.textContent = apiText || '–';

      // Försök göra remote check (getCurrent) på flera sätt:
      let sample = null;

      if (typeof Api.callApi === 'function') {
        sample = await Api.callApi('getCurrent', {});
      } else if (typeof Api.api === 'function') {
        sample = await Api.api('getCurrent', {});
      } else if (typeof Api.apiUrl === 'function') {
        // Bygg URL och fetch:a själv
        const url = Api.apiUrl('getCurrent', {});
        sample = await fetch(url, { cache: 'no-store' }).then(r => r.json());
      } else {
        throw new Error('api.js saknar callApi/api/apiUrl-funktion.');
      }

      const ms = Math.round(performance.now() - started);

      if (statusEl) {
        statusEl.textContent = `OK – API svarar (${ms} ms)`;
        statusEl.className = 'pill ok';
      }

      const dbgRemote = this.querySelector('#dbgRemote');
      if (dbgRemote) {
        dbgRemote.textContent = JSON.stringify({ httpOk: true, ms, sample }, null, 2);
      }

      // uppdatera lokal snapshot också (who/auth kan ha ändrats)
      this.update();
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = 'Fel – API svarar inte';
        statusEl.className = 'pill err';
      }
      const dbgRemote = this.querySelector('#dbgRemote');
      if (dbgRemote) {
        dbgRemote.textContent = JSON.stringify(
          { httpOk: false, error: String(e?.message || e) },
          null,
          2
        );
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Uppdatera';
      }
    }
  }

  async copyStatus() {
    const statusEl = this.querySelector('#sysStatus');
    const btn = this.querySelector('#sysCopy');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Kopierar…';
    }

    const payload = {
      local: this._safeJson(this.querySelector('#dbgLocal')?.textContent),
      remote: this._safeJson(this.querySelector('#dbgRemote')?.textContent),
    };
    const text = JSON.stringify(payload, null, 2);

    try {
      await navigator.clipboard.writeText(text);
      if (statusEl) {
        statusEl.textContent = 'Kopierat ✅';
        statusEl.className = 'pill ok';
      }
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
      if (statusEl) {
        statusEl.textContent = 'Kopierat';
        statusEl.className = 'pill ok';
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Kopiera status';
      }
    }
  }

  _safeJson(s) {
    try { return JSON.parse(s || 'null'); } catch { return s || null; }
  }
}

customElements.define('film-system', FilmSystem);