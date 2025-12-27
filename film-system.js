<!-- index.html (rensad: store äger temat, ingen theme-bridge här) -->
<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Filmkväll</title>

  <link rel="icon" type="image/png" href="Logo.PNG">
  <meta property="og:title" content="Filmkväll">
  <meta property="og:type" content="website">
  <meta property="og:image" content="Logo.PNG">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:image" content="Logo.PNG">

  <link rel="stylesheet" href="./styles.css">
</head>

<body>
  <div class="wrap">
    <header class="hero">
      <img id="logoImg" src="Logo.PNG" alt="Filmkväll logotyp" class="hero-logo" />
      <h1 class="hero-title">Filmkväll</h1>
      <div class="muted hero-version">Kodversion: <span id="appVersion">–</span></div>
    </header>

    <!-- Modules in visual order -->
    <film-login></film-login>
    <film-now></film-now>
    <film-wishlist></film-wishlist>
    <film-tops></film-tops>
    <film-history></film-history>
    <film-system></film-system>
  </div>

  <script type="module">
    // Viktigt: store först (applyThemeToDom körs direkt i store.js)
    await import('./store.js');

    // Login (skriver who/auth i store)
    await import('./film-login.js');

    // API (läser auth/apiUrl)
    await import('./api.js');

    // UI modules
    await import('./film-now.js');
    await import('./film-wishlist.js');
    await import('./film-tops.js');
    await import('./film-history.js');
    await import('./film-system.js');

    // Version stamp
    const verEl = document.getElementById('appVersion');
    if (verEl) verEl.textContent = document.lastModified || '–';
  </script>
</body>
</html>


<!-- film-system.js (layout + mörkt/ljust ska följa CSS-variabler i styles.css) -->
<script type="module">
import { getWho, getAuth, getTheme, setTheme, on, getDebugSnapshot } from './store.js';
import { callApi, getApiUrl, getTokenFlags } from './api.js';

class FilmSystem extends HTMLElement {
  connectedCallback() {
    this.render();

    this._unsubWho = on('who', () => this.updateLocal());
    this._unsubAuth = on('auth', () => this.updateLocal());
    this._unsubTheme = on('theme', () => this.updateThemeUI());

    this.querySelector('#sysTheme')?.addEventListener('change', (e) => {
      setTheme(e.target.value);
      // UI uppdateras via store-event
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
    // OBS: undvik inline-färger. Använd era globala klasser (card/row/col/pill/muted).
    // Inline här är bara layout (gap/min-width) och ska inte påverka tema.

    this.innerHTML = `
      <div class="card" id="systemCard">
        <div class="row sys-top">
          <div class="col sys-title">
            <h3 style="margin:0">System</h3>
            <div class="muted" style="margin-top:2px">Tema + felsökning/status</div>
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
            <div id="sysStatus" class="pill">Init…</div>
          </div>

          <div class="col sys-actions">
            <button id="sysRefresh" class="ghost">Uppdatera</button>
            <button id="sysCopy" class="ghost">Kopiera status</button>
          </div>
        </div>

        <details class="sys-details" style="margin-top:12px">
          <summary class="muted" style="cursor:pointer">Felsökning / status</summary>

          <div class="row" style="margin-top:12px; align-items:flex-start; gap:12px">
            <div class="col" style="min-width:240px">
              <div class="row" style="gap:12px">
                <div class="col" style="min-width:110px">
                  <label>Användare</label>
                  <div><strong id="dbgWho">–</strong></div>
                </div>
                <div class="col" style="min-width:110px">
                  <label>Tema</label>
                  <div><strong id="dbgTheme">–</strong></div>
                </div>
              </div>

              <div style="margin-top:10px">
                <label>API</label>
                <div class="muted" style="word-break:break-all" id="dbgApi">–</div>
              </div>

              <div class="row" style="margin-top:10px; gap:12px">
                <div class="col" style="min-width:110px">
                  <label>Auth pw</label>
                  <div id="dbgPw">(ej satt)</div>
                </div>
                <div class="col" style="min-width:110px">
                  <label>Auth token</label>
                  <div id="dbgToken">(ej satt)</div>
                </div>
              </div>

              <div style="margin-top:10px">
                <label>Tokens</label>
                <div class="muted" id="dbgTokens">–</div>
              </div>
            </div>

            <div class="col" style="min-width:280px">
              <label>Lokal konfig</label>
              <pre id="dbgLocal" class="sys-pre"></pre>
            </div>

            <div class="col" style="min-width:280px">
              <label>Remote check (getCurrent)</label>
              <pre id="dbgRemote" class="sys-pre"></pre>
            </div>
          </div>
        </details>
      </div>
    `;

    // Säkerställ att systemet alltid får rätt theme-val i dropdown
    this.updateThemeUI();
    this.updateLocal();
  }

  updateThemeUI() {
    const t = getTheme() || 'auto';
    const sel = this.querySelector('#sysTheme');
    if (sel && sel.value !== t) sel.value = t;
    const dbgTheme = this.querySelector('#dbgTheme');
    if (dbgTheme) dbgTheme.textContent = t;
  }

  updateLocal() {
    const who = getWho() || '–';
    const auth = getAuth() || { pw:'', token:'' };

    this.querySelector('#dbgWho').textContent = who;

    const api = (typeof getApiUrl === 'function') ? (getApiUrl() || '') : '';
    this.querySelector('#dbgApi').textContent = api || '–';

    this.querySelector('#dbgPw').textContent = auth.pw ? '(satt)' : '(ej satt)';
    this.querySelector('#dbgToken').textContent = auth.token ? '(satt)' : '(ej satt)';

    const snap = (typeof getDebugSnapshot === 'function')
      ? getDebugSnapshot()
      : { who, theme: getTheme(), auth: { pw: auth.pw ? '(satt)' : '', token: auth.token ? '(satt)' : '' } };

    const local = {
      ...snap,
      apiUrl: api || ''
    };

    const pre = this.querySelector('#dbgLocal');
    if (pre) pre.textContent = JSON.stringify(local, null, 2);

    const tokens = (typeof getTokenFlags === 'function') ? getTokenFlags() : { tmdb:null, omdb:null, watchmode:null };
    const tokEl = this.querySelector('#dbgTokens');
    if (tokEl) tokEl.textContent =
      `TMDb: ${tokens.tmdb === true ? '✓' : tokens.tmdb === false ? '–' : '?'}  ·  ` +
      `OMDb: ${tokens.omdb === true ? '✓' : tokens.omdb === false ? '–' : '?'}  ·  ` +
      `Watchmode: ${tokens.watchmode === true ? '✓' : tokens.watchmode === false ? '–' : '?'}`;
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
      const sample = await callApi('getCurrent', {});
      const ms = Math.round(performance.now() - started);

      if (statusEl) {
        statusEl.textContent = `OK – API svarar (${ms} ms)`;
        statusEl.className = 'pill ok';
      }

      const pre = this.querySelector('#dbgRemote');
      if (pre) pre.textContent = JSON.stringify({ httpOk: true, ms, sample }, null, 2);

      this.updateLocal();
    } catch (e) {
      if (statusEl) {
        statusEl.textContent = 'Fel – API svarar inte';
        statusEl.className = 'pill err';
      }
      const pre = this.querySelector('#dbgRemote');
      if (pre) pre.textContent = JSON.stringify({ httpOk: false, error: String(e?.message || e) }, null, 2);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Uppdatera';
      }
    }
  }

  async copyStatus() {
    const local = this.querySelector('#dbgLocal')?.textContent || '';
    const remote = this.querySelector('#dbgRemote')?.textContent || '';
    const payload = { local: safeJson(local), remote: safeJson(remote) };
    const text = JSON.stringify(payload, null, 2);

    const statusEl = this.querySelector('#sysStatus');
    const btn = this.querySelector('#sysCopy');

    // gråa ut lite vid tryck
    if (btn) { btn.disabled = true; btn.textContent = 'Kopierar…'; }

    try {
      await navigator.clipboard.writeText(text);
      if (statusEl) {
        statusEl.textContent = 'Kopierat';
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
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Kopiera status'; }
    }

    function safeJson(s){
      try { return JSON.parse(s || 'null'); } catch { return s || null; }
    }
  }
}

customElements.define('film-system', FilmSystem);
</script>


<!-- styles.css: lägg till (eller flytta till styles.css om du vill slippa inline-layout) -->
<style>
  /* System header ska inte “hamna utanför” */
  .sys-top{ align-items:flex-start; gap:12px; }
  .sys-title{ min-width:220px; }
  .sys-theme{ min-width:200px; }
  .sys-status{ min-width:240px; }
  .sys-actions{ flex:0 0 auto; display:flex; gap:10px; justify-content:flex-end; align-items:flex-end; min-width:220px; margin-left:auto; }

  /* Pre ska följa tema via variabler (inga hårdkodade färger) */
  .sys-pre{
    margin:0;
    white-space:pre-wrap;
    padding:10px 12px;
    border-radius:10px;
    border:1px solid var(--border);
    background:var(--input);
    color:var(--text);
    max-width:100%;
    overflow:auto;
  }

  @media (max-width:760px){
    .sys-actions{ width:100%; justify-content:flex-start; }
  }
</style>
