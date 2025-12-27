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