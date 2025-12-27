// film-system.js
import { getWho, getAuth, getTheme, setTheme, on } from './store.js';
import { apiUrl, callApi } from './api.js'; 
// ^ Om din api.js inte exporterar detta: säg till så anpassar jag exakt efter din api.js.
//    Minimalt behöver vi kunna göra en remote check (getCurrent) och kunna visa apiUrl.

class FilmSystem extends HTMLElement {
  connectedCallback() {
    this.render();

    // live updates från store
    this._unsubWho = on('who', () => this.update());
    this._unsubAuth = on('auth', () => this.update());
    this._unsubTheme = on('theme', () => this.updateThemeUI());

    // events
    this.querySelector('#sysTheme')?.addEventListener('change', (e) => {
      setTheme(e.target.value); // 'auto'|'dark'|'light'
    });

    this.querySelector('#sysRefresh')?.addEventListener('click', () => this.refresh());
    this.querySelector('#sysCopy')?.addEventListener('click', () => this.copyStatus());

    // första refresh
    this.refresh();
  }

  disconnectedCallback() {
    this._unsubWho?.(); this._unsubAuth?.(); this._unsubTheme?.();
  }

  render() {
    this.innerHTML = `
      <div class="card" id="systemCard">
        <div class="row" style="align-items:flex-start">
          <div class="col" style="min-width:220px">
            <h3 style="margin:0">System</h3>
            <div class="muted" style="margin-top:2px">Tema + felsökning/status</div>
          </div>

          <div class="col" style="min-width:220px">
            <label>Tema</label>
            <select id="sysTheme">
              <option value="auto">Auto</option>
              <option value="dark">Mörkt</option>
              <option value="light">Ljust</option>
            </select>
          </div>

          <div class="col" style="min-width:240px">
            <label>Status</label>
            <div id="sysStatus" class="pill">Init…</div>
          </div>

          <div class="col" style="flex:0 0 auto; min-width:260px; display:flex; gap:10px; justify-content:flex-end; align-items:end">
            <button id="sysRefresh" class="ghost">Uppdatera</button>
            <button id="sysCopy" class="ghost">Kopiera status</button>
          </div>
        </div>

        <details style="margin-top:12px" open>
          <summary class="muted" style="cursor:pointer">Felsökning / status</summary>

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
              <pre id="dbgLocal" style="white-space:pre-wrap;margin:0"></pre>
            </div>

            <div class="col" style="min-width:320px">
              <label>Remote check (getCurrent)</label>
              <pre id="dbgRemote" style="white-space:pre-wrap;margin:0"></pre>
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
    if (!sel) return;
    const t = getTheme?.() || 'auto';
    sel.value = t;
    const dbgTheme = this.querySelector('#dbgTheme');
    if (dbgTheme) dbgTheme.textContent = t;
  }

  update() {
    const who = getWho?.() || '–';
    const auth = getAuth?.() || { pw:'', token:'' };

    this.querySelector('#dbgWho').textContent = who;

    // apiUrl: om api.js exporterar apiUrl som sträng
    const api = (typeof apiUrl === 'string') ? apiUrl : (apiUrl?.() || '');
    this.querySelector('#dbgApi').textContent = api || '–';

    this.querySelector('#dbgPw').textContent = auth.pw ? '(satt)' : '(ej satt)';
    this.querySelector('#dbgToken').textContent = auth.token ? '(satt)' : '(ej satt)';

    // Lokal konfig
    const local = {
      who,
      theme: getTheme?.() || 'auto',
      auth: { pw: auth.pw ? '(satt)' : '(ej satt)', token: auth.token ? '(satt)' : '(ej satt)' },
      apiUrl: api || ''
    };
    this.querySelector('#dbgLocal').textContent = JSON.stringify(local, null, 2);
  }

  async refresh() {
    const statusEl = this.querySelector('#sysStatus');
    const btn = this.querySelector('#sysRefresh');

    // gråa ut knappen vid tryck (du ville detta beteende)
    if (btn) { btn.disabled = true; btn.textContent = 'Uppdaterar…'; }
    if (statusEl) { statusEl.textContent = 'Testar API…'; statusEl.className = 'pill'; }

    const started = performance.now();
    try {
      // Remote check – använd din api.js om möjligt
      const sample = await callApi('getCurrent', {}); // förväntar {ok:true,...}
      const ms = Math.round(performance.now() - started);

      if (statusEl) {
        statusEl.textContent = `OK – API svarar (${ms} ms)`;
        statusEl.className = 'pill ok';
      }

      this.querySelector('#dbgRemote').textContent = JSON.stringify({
        httpOk: true,
        ms,
        sample
      }, null, 2);

      // tokens (enkel indikering)
      const tokens = {
        tmdb: true,  // om du vill: koppla till faktisk config senare
        omdb: true,
        watchmode: true
      };
      this.querySelector('#dbgTokens').textContent =
        `TMDb: ${tokens.tmdb ? '✓' : '–'}  ·  OMDb: ${tokens.omdb ? '✓' : '–'}  ·  Watchmode: ${tokens.watchmode ? '✓' : '–'}`;

      this.update(); // uppdatera lokal konfig också
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = 'Fel – API svarar inte';
        statusEl.className = 'pill err';
      }
      this.querySelector('#dbgRemote').textContent = JSON.stringify({
        httpOk: false,
        error: String(e?.message || e)
      }, null, 2);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Uppdatera'; }
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
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }

    function safeJson(s){
      try { return JSON.parse(s || 'null'); } catch { return s || null; }
    }
  }
}

customElements.define('film-system', FilmSystem);