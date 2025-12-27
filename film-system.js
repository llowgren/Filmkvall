// ================================
// film-system.js
// System + felsökning/status
// - Tema styrs via store.setTheme()
// - Visar lokal config + remote check
// ================================

import { getApiUrl, getMovieTokens } from './film-login.js';
import { api } from './api.js';
import {
  getWho,
  on,
  getTheme,
  setTheme,
  getAuth,
  getDebugSnapshot,
} from './store.js';

class FilmSystem extends HTMLElement {
  constructor(){
    super();
    this._unsubs = [];
    this._lastPingMs = null;
  }

  connectedCallback(){
    this.innerHTML = `
      <section class="card" id="systemCard">
        <div class="row" style="align-items:center; gap:12px">
          <div class="col" style="min-width:240px">
            <h3 style="margin:0">System</h3>
            <div class="muted" style="font-size:12px">Tema + felsökning/status</div>
          </div>

          <div class="col" style="min-width:220px">
            <label for="sysTheme">Tema</label>
            <select id="sysTheme">
              <option value="auto">Auto</option>
              <option value="dark">Mörkt</option>
              <option value="light">Ljust</option>
            </select>
          </div>

          <div class="col" style="min-width:220px">
            <label>Status</label>
            <div id="sysStatus" class="pill">Init…</div>
          </div>

          <div class="col" style="min-width:220px; display:flex; justify-content:flex-end; gap:10px; align-items:flex-end">
            <button id="sysRefresh" class="ghost">Uppdatera</button>
            <button id="sysCopy" class="ghost">Kopiera status</button>
          </div>
        </div>

        <details style="margin-top:12px" open>
          <summary class="muted" style="cursor:pointer">Felsökning / status</summary>
          <div class="row" style="margin-top:12px">
            <div class="col" style="min-width:320px">
              <div id="sysLeft"></div>
            </div>
            <div class="col" style="min-width:320px">
              <label>Lokal config</label>
              <pre id="sysLocal" style="white-space:pre-wrap; margin:0"></pre>
            </div>
            <div class="col" style="min-width:320px">
              <label>Remote check (getCurrent)</label>
              <pre id="sysRemote" style="white-space:pre-wrap; margin:0"></pre>
            </div>
          </div>
        </details>
      </section>
    `;

    // init UI
    const themeSel = this.querySelector('#sysTheme');
    themeSel.value = getTheme();

    themeSel.addEventListener('change', ()=>{
      // Source of truth: store
      setTheme(themeSel.value);
      // Keep UI snappy
      themeSel.blur?.();
    });

    this.querySelector('#sysRefresh').addEventListener('click', ()=>this.refresh());
    this.querySelector('#sysCopy').addEventListener('click', ()=>this.copyStatus());

    // react to store changes
    this._unsubs.push(on('who', ()=>this.renderLocal()));
    this._unsubs.push(on('auth', ()=>this.renderLocal()));
    this._unsubs.push(on('theme', ()=>{
      // store keeps real value in getTheme(); reflect
      themeSel.value = getTheme();
      this.renderLocal();
    }));

    this.renderLocal();
    this.refresh();
  }

  disconnectedCallback(){
    for(const u of this._unsubs) try{ u(); }catch(_){ }
    this._unsubs = [];
  }

  setStatus(ok, msg){
    const el = this.querySelector('#sysStatus');
    if(!el) return;
    el.className = `pill ${ok ? 'ok' : 'err'}`;
    el.textContent = msg;
  }

  renderLocal(){
    const who = getWho();
    const apiUrl = getApiUrl();
    const auth = getAuth();
    const tokens = getMovieTokens();

    const left = this.querySelector('#sysLeft');
    if(left){
      left.innerHTML = `
        <div class="row" style="gap:16px">
          <div class="col" style="min-width:240px">
            <label>Användare</label>
            <div><strong>${escapeHtml(who || '—')}</strong></div>
          </div>
          <div class="col" style="min-width:240px">
            <label>API</label>
            <div style="word-break:break-all">${escapeHtml(apiUrl || '—')}</div>
          </div>
        </div>
        <div class="row" style="gap:16px; margin-top:8px">
          <div class="col" style="min-width:240px">
            <label>Auth pw</label>
            <div>${auth?.pw ? '(satt)' : '(saknas)'}</div>
          </div>
          <div class="col" style="min-width:240px">
            <label>Auth token</label>
            <div>${auth?.token ? '(satt)' : '(saknas)'}</div>
          </div>
        </div>
        <div class="row" style="gap:16px; margin-top:8px">
          <div class="col" style="min-width:240px">
            <label>TMDb</label>
            <div>${tokens?.tmdb ? '✓' : '—'}</div>
          </div>
          <div class="col" style="min-width:240px">
            <label>OMDb</label>
            <div>${tokens?.omdb ? '✓' : '—'}</div>
          </div>
          <div class="col" style="min-width:240px">
            <label>Watchmode</label>
            <div>${tokens?.watchmode ? '✓' : '—'}</div>
          </div>
        </div>
      `;
    }

    // pretty local snapshot
    const snap = getDebugSnapshot();
    const localPre = this.querySelector('#sysLocal');
    if(localPre) localPre.textContent = JSON.stringify(snap, null, 2);
  }

  async refresh(){
    // ping remote cheaply via getCurrent
    const t0 = performance.now();
    try{
      const j = await api('getCurrent', {});
      const ms = Math.round(performance.now() - t0);
      this._lastPingMs = ms;
      if(j?.ok){
        this.setStatus(true, `OK – API svarar (${ms} ms)`);
      }else{
        this.setStatus(false, `Fel – ${j?.error || 'ok=false'} (${ms} ms)`);
      }
      const remotePre = this.querySelector('#sysRemote');
      if(remotePre){
        remotePre.textContent = JSON.stringify({ httpOk: true, ms, sample: j }, null, 2);
      }
    }catch(e){
      const ms = Math.round(performance.now() - t0);
      this._lastPingMs = ms;
      this.setStatus(false, `Fel – nätverk (${ms} ms)`);
      const remotePre = this.querySelector('#sysRemote');
      if(remotePre){
        remotePre.textContent = JSON.stringify({ httpOk: false, ms, error: String(e?.message || e) }, null, 2);
      }
    }
  }

  async copyStatus(){
    const snap = getDebugSnapshot();
    const remotePre = this.querySelector('#sysRemote')?.textContent || '';
    const text = [
      'Filmkväll – status',
      `who: ${snap.who}`,
      `theme: ${snap.theme}`,
      `apiUrl: ${snap.apiUrl}`,
      `auth: pw=${snap.auth?.pw ? '(satt)' : '(saknas)'} token=${snap.auth?.token ? '(satt)' : '(saknas)'}`,
      '',
      'local:',
      JSON.stringify(snap, null, 2),
      '',
      'remote:',
      remotePre,
    ].join('\n');

    try{
      await navigator.clipboard.writeText(text);
      this.setStatus(true, 'OK – status kopierad');
      setTimeout(()=>this.refresh(), 600);
    }catch(_){
      // fallback: prompt
      try{ window.prompt('Kopiera status:', text); }catch(__){}
    }
  }
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, (m)=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;',
  }[m]));
}

customElements.define('film-system', FilmSystem);



// ================================
// store.js
// Source of truth for:
// - who (Användare)
// - auth (pw/token)
// - theme (auto/dark/light)
// Applies theme globally on <html>
// ================================

const listeners = new Map();

const state = {
  who: localStorage.getItem('film_who') || 'Maria',
  theme: localStorage.getItem('film_theme') || 'auto',
  auth: {
    token: localStorage.getItem('film_token') || '',
    pw: localStorage.getItem('film_pw') || ''
  }
};

// --- WHO ---
export function getWho(){ return state.who; }
export function setWho(who){
  state.who = (who || '').trim() || 'Maria';
  localStorage.setItem('film_who', state.who);
  emit('who', state.who);
}

// --- AUTH ---
export function getAuth(){ return { ...state.auth }; }
export function setAuth(auth){
  state.auth = { ...state.auth, ...(auth || {}) };
  if ('token' in (auth || {})) localStorage.setItem('film_token', state.auth.token || '');
  if ('pw' in (auth || {})) localStorage.setItem('film_pw', state.auth.pw || '');
  emit('auth', getAuth());
}

// --- THEME ---
export function getTheme(){
  // stored preference (auto/dark/light)
  return state.theme || 'auto';
}

export function setTheme(mode){
  const m = (mode === 'light' || mode === 'dark' || mode === 'auto') ? mode : 'auto';
  state.theme = m;
  localStorage.setItem('film_theme', m);
  applyTheme();
  emit('theme', m);
}

export function applyTheme(){
  const pref = state.theme || 'auto';
  const root = document.documentElement;

  let effective = pref;
  if (pref === 'auto') {
    const isLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    effective = isLight ? 'light' : 'dark';
  }

  if (effective === 'light') {
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
  } else {
    root.removeAttribute('data-theme');
    root.style.colorScheme = 'dark';
  }

  emit('theme:effective', effective);
}

// keep auto mode in sync with OS changes
let _mql = null;
try{
  _mql = window.matchMedia?.('(prefers-color-scheme: light)') || null;
  const onChange = ()=>{ if (state.theme === 'auto') applyTheme(); };
  _mql?.addEventListener?.('change', onChange);
  _mql?.addListener?.(onChange); // safari fallback
}catch(_){ }

// --- EVENTS ---
export function on(key, fn){
  if(!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return ()=>listeners.get(key)?.delete(fn);
}

function emit(key, val){
  for(const fn of (listeners.get(key) || [])){
    try{ fn(val); }catch(_){ }
  }
}

// --- DEBUG ---
export function getDebugSnapshot(){
  return {
    who: state.who,
    theme: state.theme,
    apiUrl: null, // film-system fyller via getApiUrl(), men vi lämnar null här
    auth: {
      pw: state.auth?.pw ? '(satt)' : '',
      token: state.auth?.token ? '(satt)' : ''
    }
  };
}

// init once at module load
applyTheme();
