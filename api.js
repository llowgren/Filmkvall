/* ===== Filmkväll api.js =====
 * Mål:
 * - Skicka auth-token i POST-body (JSON), inte i URL.
 * - Fungerar med code.gs som har getParams_() och (valfritt) ENFORCE_POST=1.
 * - Inga hemligheter i repo: token/nycklar lagras lokalt i webbläsaren.
 */

(function(){
  'use strict';

  // ===== Konfiguration =====
  // Förväntat: state.js sätter window.FILMKVALL_CONFIG. Om inte, kör fallback.
  const CFG = window.FILMKVALL_CONFIG || {};

  // Obs: Lägg gärna API_URL i state.js så index.html inte behöver uppdateras vid ny deploy.
  const API_URL = String(CFG.API_URL || window.API || '').trim();

  // ===== Lokal lagring =====
  const Storage = {
    get(key, fallback=null){
      try{ const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch{ return fallback; }
    },
    set(key, value){
      try{ localStorage.setItem(key, JSON.stringify(value)); } catch(_){ }
    },
    getStr(key, fallback=''){
      try{ const v = localStorage.getItem(key); return v == null ? fallback : String(v); }
      catch{ return fallback; }
    },
    setStr(key, value){
      try{ localStorage.setItem(key, String(value ?? '')); } catch(_){ }
    }
  };

  // Standard-nycklar (kan override:as i state.js)
  const KEY_TOKEN = CFG.STORAGE_TOKEN_KEY || 'film_token';

  function getToken(){
    // Token kan komma från:
    // 1) localStorage (primärt)
    // 2) pwInput i UI (om användaren just skriver)
    const ui = document.getElementById('pwInput');
    const uiVal = ui ? String(ui.value || '').trim() : '';
    if(uiVal) return uiVal;
    return Storage.getStr(KEY_TOKEN, '').trim();
  }

  function persistTokenFromUI(){
    const ui = document.getElementById('pwInput');
    if(!ui) return;
    const v = String(ui.value || '').trim();
    if(v) Storage.setStr(KEY_TOKEN, v);
  }

  // ===== Core request (POST JSON) =====
  async function request(action, params={}, opts={}){
    if(!API_URL) throw new Error('API_URL saknas');

    const timeoutMs = Number(opts.timeoutMs || 15000);
    const controller = new AbortController();
    const t = setTimeout(()=>controller.abort(), timeoutMs);

    const token = (action === 'ping') ? (getToken() || undefined) : getToken();
    const payload = Object.assign({}, params || {}, { action });
    if(token) payload.token = token;

    try{
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal: controller.signal
      });

      // Apps Script kan ibland svara 200 med text som inte är JSON vid fel.
      const text = await res.text();
      let json;
      try{ json = text ? JSON.parse(text) : null; }
      catch(_){
        throw new Error(`Ogiltigt JSON-svar (${res.status}): ${text.slice(0,200)}`);
      }

      // Normalisera: om HTTP != ok men JSON finns
      if(!res.ok){
        const msg = (json && json.error) ? String(json.error) : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      return json;
    } finally {
      clearTimeout(t);
    }
  }

  // ===== Enkel cache (för SWR) =====
  const Cache = {
    get(key){ return Storage.get(key, null); },
    set(key, value){ Storage.set(key, value); },
    del(key){ try{ localStorage.removeItem(key); }catch(_){ } }
  };

  // SWR: returnera cache direkt, refresh i bakgrunden, kalla onFresh när fingerprint ändras.
  async function fetchJsonSWR({ key, action, params, maxAgeMs=30000, onFresh, fingerprint }){
    const cached = Cache.get(key);
    const now = Date.now();

    const safeFp = (x)=>{
      try{ return typeof fingerprint === 'function' ? String(fingerprint(x)) : JSON.stringify(x).slice(0,5000); }
      catch(_){ return 'x'; }
    };

    const refresh = async ()=>{
      try{
        const fresh = await request(action, params);
        const fpNew = safeFp(fresh);
        const fpOld = cached?.fp ?? safeFp(cached?.data);
        Cache.set(key, { savedAt: Date.now(), data: fresh, fp: fpNew });
        if(fpOld !== fpNew) onFresh?.(fresh);
      }catch(_){ }
    };

    if(cached?.data){
      if(!cached.savedAt || (now - cached.savedAt) > maxAgeMs) refresh();
      return cached.data;
    }

    const data = await request(action, params);
    Cache.set(key, { savedAt: Date.now(), data, fp: safeFp(data) });
    return data;
  }

  // ===== Save-queue (offline/latensvänligt) =====
  const SaveQueue = {
    key: CFG.STORAGE_QUEUE_KEY || 'filmkvall_savequeue_v1',
    read(){ return Cache.get(this.key) || []; },
    write(q){ Cache.set(this.key, q); },
    enqueue(job){
      const q = this.read();
      q.push({ ...job, ts: Date.now() });
      this.write(q);
      window.FilmApi?.events?.emit?.('queue:changed', { n: q.length });
    },
    async flush(flusher){
      const q = this.read();
      if(!q.length) return;
      const remaining = [];

      for(let i=0;i<q.length;i++){
        const job = q[i];
        try{
          await flusher(job);
        }catch(e){
          remaining.push(job, ...q.slice(i+1));
          this.write(remaining);
          window.FilmApi?.events?.emit?.('queue:changed', { n: remaining.length });
          throw e;
        }
      }

      this.write([]);
      window.FilmApi?.events?.emit?.('queue:changed', { n: 0 });
    }
  };

  let flushTimer = null;
  function scheduleFlush(flusher, delayMs=700){
    clearTimeout(flushTimer);
    flushTimer = setTimeout(async ()=>{
      try{
        await SaveQueue.flush(flusher);
      }catch(_){ }
    }, delayMs);
  }

  async function sendJobToServer(job){
    const { action, payload } = job;
    const j = await request(action, payload || {});
    if(!j?.ok) throw new Error(j?.error || action);
    return j;
  }

  function enqueueAndSync(action, payload){
    // Om användaren nyss skrev token i UI: spara lokalt så kommande POST fungerar.
    persistTokenFromUI();
    SaveQueue.enqueue({ action, payload });
    scheduleFlush(sendJobToServer, 700);
  }

  function pendingCount(){
    return (SaveQueue.read() || []).length;
  }

  // ===== Minimal event-bus (för ui.js status/badge) =====
  const events = {
    _m: new Map(),
    on(name, fn){
      const arr = this._m.get(name) || [];
      arr.push(fn);
      this._m.set(name, arr);
    },
    emit(name, payload){
      const arr = this._m.get(name) || [];
      for(const fn of arr){ try{ fn(payload); }catch(_){ } }
    }
  };

  // ===== Exponera API =====
  window.FilmApi = {
    request,
    fetchJsonSWR,
    Cache,
    SaveQueue,
    enqueueAndSync,
    scheduleFlush,
    sendJobToServer,
    pendingCount,
    getToken,
    persistTokenFromUI,
    events
  };

  // Flush när vi kommer online/visas
  window.addEventListener('online', ()=>scheduleFlush(sendJobToServer, 200));
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'visible') scheduleFlush(sendJobToServer, 200);
  });

})();
