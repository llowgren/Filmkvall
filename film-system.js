// film-system.js
// System + felsökning (tema + status)

import { getWho, on as onStore, getAuth } from './store.js';
import { getApiUrl, getMovieTokens } from './film-login.js';

class FilmSystem extends HTMLElement {
  constructor(){
    super();
    this.attachShadow({ mode:'open' });
    this._unsubs = [];
    this._statusTimer = null;
  }

  connectedCallback(){
    this.render();

    // Bind UI
    this.shadowRoot.getElementById('theme')?.addEventListener('change', ()=>this.onThemeChange());
    this.shadowRoot.getElementById('refreshStatus')?.addEventListener('click', ()=>this.refreshStatus({flash:true}));
    this.shadowRoot.getElementById('copyStatus')?.addEventListener('click', ()=>this.copyStatus());

    // Apply theme once on load
    this.initTheme();

    // Subscribe to store changes
    this._unsubs.push(onStore('who', ()=>this.updateLocalStatus()));
    this._unsubs.push(onStore('auth', ()=>this.updateLocalStatus()));

    this.updateLocalStatus();
    this.refreshStatus({flash:false});

    // Auto-refresh status every ~60s (very light)
    this._statusTimer = setInterval(()=>this.refreshStatus({flash:false, quiet:true}), 60_000);
  }

  disconnectedCallback(){
    this._unsubs.forEach(fn=>{ try{ fn(); }catch(_){} });
    this._unsubs = [];
    if(this._statusTimer) clearInterval(this._statusTimer);
  }

  // ----------------------------
  // Theme
  // ----------------------------

  initTheme(){
    const sel = this.shadowRoot.getElementById('theme');
    const saved = localStorage.getItem('film_theme') || 'auto';
    if(sel) sel.value = saved;
    this.applyTheme(saved);

    // React to OS theme changes when in auto
    this._mqlLight = window.matchMedia?.('(prefers-color-scheme: light)');
    const onChange = ()=>{
      const cur = localStorage.getItem('film_theme') || 'auto';
      if(cur === 'auto') this.applyTheme('auto');
    };
    this._mqlLight?.addEventListener?.('change', onChange);
    this._mqlLight?.addListener?.(onChange);
  }

  onThemeChange(){
    const sel = this.shadowRoot.getElementById('theme');
    const val = sel?.value || 'auto';
    localStorage.setItem('film_theme', val);
    this.applyTheme(val);
  }

  applyTheme(mode){
    const root = document.documentElement;
    let effective = mode;
    if(mode === 'auto'){
      const isLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches;
      effective = isLight ? 'light' : 'dark';
    }

    if(effective === 'light') root.setAttribute('data-theme','light');
    else root.removeAttribute('data-theme');

    // Helps form controls on iOS
    root.style.colorScheme = (effective === 'light') ? 'light' : 'dark';
  }

  // ----------------------------
  // Status
  // ----------------------------

  updateLocalStatus(){
    const who = getWho();
    const auth = getAuth();
    const apiUrl = getApiUrl();
    const tokens = getMovieTokens();

    this.shadowRoot.getElementById('whoVal').textContent = who || '–';
    this.shadowRoot.getElementById('apiUrlVal').textContent = apiUrl || '–';
    this.shadowRoot.getElementById('pwVal').textContent = auth?.pw ? '(satt)' : '(saknas)';
    this.shadowRoot.getElementById('tokenVal').textContent = auth?.token ? '(satt)' : '(saknas)';

    this.shadowRoot.getElementById('tmdbVal').textContent = tokens?.tmdb ? '✓' : '–';
    this.shadowRoot.getElementById('omdbVal').textContent = tokens?.omdb ? '✓' : '–';
    this.shadowRoot.getElementById('watchmodeVal').textContent = tokens?.watchmode ? '✓' : '–';

    // keep raw JSON for copy
    this._localSnapshot = {
      who,
      apiUrl,
      auth: {
        pw: auth?.pw ? '(satt)' : '(saknas)',
        token: auth?.token ? '(satt)' : '(saknas)'
      },
      tokens: {
        tmdb: !!tokens?.tmdb,
        omdb: !!tokens?.omdb,
        watchmode: !!tokens?.watchmode
      }
    };

    const rawEl = this.shadowRoot.getElementById('rawLocal');
    if(rawEl) rawEl.textContent = JSON.stringify(this._localSnapshot, null, 2);
  }

  buildUrl(action, params={}){
    const base = getApiUrl();
    const auth = getAuth();

    const sp = new URLSearchParams();
    sp.set('action', action);

    // backend expects pw; token is optional/forward compatible
    if(auth?.pw) sp.set('pw', auth.pw);
    if(auth?.token) sp.set('token', auth.token);

    Object.entries(params || {}).forEach(([k,v])=>{
      if(v === undefined || v === null) return;
      sp.set(k, String(v));
    });

    return `${base}?${sp.toString()}`;
  }

  async refreshStatus({flash=false, quiet=false}={}){
    const pill = this.shadowRoot.getElementById('apiPill');
    if(pill && flash){
      pill.classList.add('flash');
      setTimeout(()=>pill.classList.remove('flash'), 700);
    }

    const auth = getAuth();
    const base = getApiUrl();

    // If not configured, don’t spam network.
    if(!base || !auth?.pw){
      if(pill){
        pill.className = 'pill err';
        pill.textContent = 'Fel – saknar API/pw';
      }
      return;
    }

    try{
      // Lightweight: call getCurrent to verify webapp is reachable
      const url = this.buildUrl('getCurrent');
      const t0 = performance.now();
      const res = await fetch(url, { cache:'no-store' });
      const ms = Math.round(performance.now() - t0);

      const ok = res.ok;
      let j = null;
      try{ j = await res.json(); }catch(_){ }

      const apiOk = ok && j && (j.ok === true);
      if(pill){
        pill.className = 'pill ' + (apiOk ? 'ok' : 'err');
        pill.textContent = apiOk ? `OK – API svarar (${ms} ms)` : `Fel – API svarar ej (${ms} ms)`;
      }

      const rawRemote = this.shadowRoot.getElementById('rawRemote');
      if(rawRemote) rawRemote.textContent = JSON.stringify({
        httpOk: ok,
        ms,
        sample: j
      }, null, 2);

      if(!quiet && !apiOk){
        // Keep it visible for debugging
        this.shadowRoot.getElementById('details')?.setAttribute('open','');
      }

    }catch(err){
      if(pill){
        pill.className = 'pill err';
        pill.textContent = 'Fel – nätverksproblem';
      }
      const rawRemote = this.shadowRoot.getElementById('rawRemote');
      if(rawRemote) rawRemote.textContent = JSON.stringify({ error: String(err?.message || err) }, null, 2);
      if(!quiet) this.shadowRoot.getElementById('details')?.setAttribute('open','');
    }
  }

  async copyStatus(){
    const payload = {
      local: this._localSnapshot || null,
      remoteCheck: (()=>{
        try{ return JSON.parse(this.shadowRoot.getElementById('rawRemote')?.textContent || 'null'); }
        catch{ return null; }
      })(),
      time: new Date().toISOString()
    };

    const text = JSON.stringify(payload, null, 2);
    try{
      await navigator.clipboard.writeText(text);
      const btn = this.shadowRoot.getElementById('copyStatus');
      const old = btn.textContent;
      btn.textContent = 'Kopierat';
      btn.disabled = true;
      setTimeout(()=>{ btn.textContent = old; btn.disabled = false; }, 900);
    }catch(_){
      // fallback: select text area
      const ta = this.shadowRoot.getElementById('copyFallback');
      ta.value = text;
      ta.style.display = 'block';
      ta.focus();
      ta.select();
      try{ document.execCommand('copy'); }catch(_){ }
      setTimeout(()=>{ ta.style.display = 'none'; }, 900);
    }
  }

  // ----------------------------
  // UI
  // ----------------------------

  render(){
    this.shadowRoot.innerHTML = `
      <style>
        :host{ display:block; }
        .card{ background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; margin:14px 0; }
        .row{ display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
        .col{ flex:1 1 220px; min-width:220px; }
        h3{ margin:0 0 10px; }
        label{ display:block; font-size:13px; color:var(--muted); margin:0 0 6px; }
        select{ width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--input); color:var(--text); outline:none; }
        button{ background:var(--btn); color:var(--btn-text); cursor:pointer; border:1px solid var(--border); padding:8px 12px; border-radius:999px; font-size:14px; }
        .pill{ display:inline-block; padding:8px 12px; border-radius:999px; font-size:13px; background:var(--pill-bg); border:1px solid var(--border); line-height:1.2; }
        .ok{ color:var(--ok); }
        .err{ color:var(--err); }
        .muted{ color:var(--muted); }
        .right{ margin-left:auto; }
        pre{ margin:0; white-space:pre-wrap; font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; color:var(--muted); }
        details{ margin-top:10px; }
        summary{ cursor:pointer; color:var(--muted); }
        .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        @media (max-width:720px){ .grid2{ grid-template-columns:1fr; } }
        .kv{ display:grid; grid-template-columns:140px 1fr; gap:10px; align-items:center; margin:8px 0; }
        .k{ color:var(--muted); font-size:13px; }
        .v{ font-size:13px; }
        .flash{ animation:flash 700ms ease; }
        @keyframes flash{0%{box-shadow:0 0 0 0 rgba(246,194,71,0)}40%{box-shadow:0 0 0 6px rgba(246,194,71,.25)}100%{box-shadow:0 0 0 0 rgba(246,194,71,0)}}
        textarea{ width:100%; border-radius:10px; border:1px solid var(--border); background:var(--input); color:var(--text); padding:10px 12px; display:none; }
      </style>

      <div class="card">
        <div class="row">
          <h3 style="margin:0">System</h3>
          <span class="right"></span>
          <button id="refreshStatus" type="button">Uppdatera</button>
        </div>

        <div class="row" style="margin-top:10px">
          <div class="col" style="max-width:260px">
            <label>Tema</label>
            <select id="theme">
              <option value="auto">Auto</option>
              <option value="dark">Mörkt</option>
              <option value="light">Ljust</option>
            </select>
          </div>
          <div class="col" style="min-width:260px">
            <label>Status</label>
            <div id="apiPill" class="pill muted">Init…</div>
          </div>
          <div class="col" style="min-width:160px; max-width:220px">
            <label>&nbsp;</label>
            <button id="copyStatus" type="button">Kopiera status</button>
          </div>
        </div>

        <details id="details">
          <summary>Felsökning / status</summary>
          <div class="grid2" style="margin-top:10px">
            <div>
              <div class="kv"><div class="k">Användare</div><div class="v" id="whoVal">–</div></div>
              <div class="kv"><div class="k">API</div><div class="v" id="apiUrlVal">–</div></div>
              <div class="kv"><div class="k">Auth pw</div><div class="v" id="pwVal">–</div></div>
              <div class="kv"><div class="k">Auth token</div><div class="v" id="tokenVal">–</div></div>
              <div class="kv"><div class="k">TMDb</div><div class="v" id="tmdbVal">–</div></div>
              <div class="kv"><div class="k">OMDb</div><div class="v" id="omdbVal">–</div></div>
              <div class="kv"><div class="k">Watchmode</div><div class="v" id="watchmodeVal">–</div></div>
            </div>
            <div>
              <div class="muted" style="font-size:13px; margin:0 0 6px">Lokal konfig</div>
              <pre id="rawLocal">{}</pre>
              <div class="muted" style="font-size:13px; margin:12px 0 6px">Remote check (getCurrent)</div>
              <pre id="rawRemote">{}</pre>
              <textarea id="copyFallback" rows="8" spellcheck="false"></textarea>
            </div>
          </div>
        </details>
      </div>
    `;
  }
}

customElements.define('film-system', FilmSystem);
