// film-system.js
import { getWho, getAuth, getTheme, setTheme, on } from './store.js';
import { api } from './api.js';
import { getApiUrl } from './film-login.js';

class FilmSystem extends HTMLElement {
  connectedCallback() {
    this.render();

    this._unsubWho   = on('who',   () => this.updateLocal());
    this._unsubAuth  = on('auth',  () => this.updateLocal());
    this._unsubTheme = on('theme', () => this.updateThemeUI());

    this.querySelector('#sysTheme')?.addEventListener('change', e => {
      setTheme(e.target.value);
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
      <div class="card">
        <div class="row sys-top">
          <div class="col sys-title">
            <h3>System</h3>
            <div class="muted">Tema + felsökning/status</div>
          </div>

          <div class="col sys-theme">
            <label>Tema</label>
            <select id="sysTheme">
              <option value="auto">Auto</option>
              <option value="dark">Mörkt</option>
              <option value="light">Ljust</option>
            </select>
          </div>

          <div class="col sys-status">
            <label>Status</label>
            <div id="sysStatus" class="pill">–</div>
          </div>

          <div class="col sys-actions">
            <button id="sysRefresh" class="ghost">Uppdatera</button>
            <button id="sysCopy" class="ghost">Kopiera status</button>
          </div>
        </div>

        <details style="margin-top:12px">
          <summary class="muted">Felsökning / status</summary>

          <div class="row" style="margin-top:12px; gap:12px">
            <div class="col" style="min-width:220px">
              <label>Användare</label>
              <strong id="dbgWho">–</strong>

              <label style="margin-top:8px">Tema</label>
              <strong id="dbgTheme">–</strong>

              <label style="margin-top:8px">API</label>
              <div class="muted" id="dbgApi">–</div>

              <label style="margin-top:8px">Auth</label>
              <div id="dbgAuth">–</div>
            </div>

            <div class="col" style="min-width:300px">
              <label>Lokal konfig</label>
              <pre id="dbgLocal" class="sys-pre"></pre>
            </div>

            <div class="col" style="min-width:300px">
              <label>Remote check (getCurrent)</label>
              <pre id="dbgRemote" class="sys-pre"></pre>
            </div>
          </div>
        </details>
      </div>
    `;

    this.updateThemeUI();
    this.updateLocal();
  }

  updateThemeUI() {
    const t = getTheme();
    const sel = this.querySelector('#sysTheme');
    if (sel) sel.value = t;
    this.querySelector('#dbgTheme').textContent = t;
  }

  updateLocal() {
    const who = getWho();
    const auth = getAuth();
    const apiUrl = getApiUrl?.() || '';

    this.querySelector('#dbgWho').textContent = who;
    this.querySelector('#dbgApi').textContent = apiUrl || '–';
    this.querySelector('#dbgAuth').textContent =
      `pw: ${auth.pw ? '(satt)' : '–'}, token: ${auth.token ? '(satt)' : '–'}`;

    this.querySelector('#dbgLocal').textContent = JSON.stringify({
      who,
      theme: getTheme(),
      auth: {
        pw: auth.pw ? '(satt)' : '',
        token: auth.token ? '(satt)' : ''
      },
      apiUrl
    }, null, 2);
  }

  async refresh() {
    const status = this.querySelector('#sysStatus');
    const btn = this.querySelector('#sysRefresh');

    btn.disabled = true;
    status.textContent = 'Testar API…';

    const t0 = performance.now();
    try {
      const sample = await api('getCurrent');
      const ms = Math.round(performance.now() - t0);

      status.textContent = `OK – API svarar (${ms} ms)`;
      status.className = 'pill ok';

      this.querySelector('#dbgRemote').textContent =
        JSON.stringify({ ms, sample }, null, 2);
    } catch (e) {
      status.textContent = 'Fel – API svarar inte';
      status.className = 'pill err';

      this.querySelector('#dbgRemote').textContent =
        JSON.stringify({ error: String(e) }, null, 2);
    } finally {
      btn.disabled = false;
    }
  }

  async copyStatus() {
    const text = JSON.stringify({
      local: this.querySelector('#dbgLocal')?.textContent,
      remote: this.querySelector('#dbgRemote')?.textContent
    }, null, 2);

    try {
      await navigator.clipboard.writeText(text);
      this.querySelector('#sysStatus').textContent = 'Kopierat';
    } catch {}
  }
}

customElements.define('film-system', FilmSystem);