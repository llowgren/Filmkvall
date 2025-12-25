/* Filmkväll – api.js
 * All kommunikation med backend (Google Apps Script)
 * Innehåller inga UI-bindningar
 */

import { Cache, SaveQueue, scheduleFlush } from './state.js';

/* ===== Konfiguration ===== */
export const API_URL = 'https://script.google.com/macros/s/AKfycby82y98CZDZc4d9tSdyi-dovoHf84sx4LC0RLQ-SosU44_BlNPzhsqWhqkNHU5Vsw7hrA/exec';

// ⚠️ Tillfälligt – ersätts senare av token/session
export const API_PASSWORD = '__SET_VIA_ENV_OR_LOCAL_ONLY__';

/* ===== Helpers ===== */
const qs = (o)=> new URLSearchParams(o).toString();

function apiUrl(action, params={}){
  return `${API_URL}?${qs({ action, pw: API_PASSWORD, ...params })}`;
}

async function rawApi(action, params={}){
  const r = await fetch(apiUrl(action, params), { cache:'no-store' });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ===== Publik API ===== */
export async function api(action, params={}){
  const j = await rawApi(action, params);
  if(!j?.ok) throw new Error(j?.error || action);
  return j;
}

/* ===== SWR-cache (stale-while-revalidate) ===== */
export async function apiSWR(action, params, { cacheKey, maxAgeMs=30_000, fingerprint, onFresh } = {}){
  const url = apiUrl(action, params);
  const cached = Cache.get(cacheKey);
  const now = Date.now();

  if(cached?.data){
    if(!cached.savedAt || (now - cached.savedAt) > maxAgeMs){
      refresh();
    }
    return cached.data;
  }

  const data = await rawApi(action, params);
  Cache.set(cacheKey, { savedAt: Date.now(), data, fp: safeFp(data) });
  return data;

  function safeFp(x){
    try{
      if(typeof fingerprint === 'function') return String(fingerprint(x));
      if(!x || typeof x !== 'object') return String(x);
      if(Array.isArray(x)) return `a:${x.length}`;
      return `o:${Object.keys(x).length}`;
    }catch{ return 'x'; }
  }

  async function refresh(){
    try{
      const fresh = await rawApi(action, params);
      const fpNew = safeFp(fresh);
      const fpOld = cached?.fp ?? safeFp(cached?.data);

      Cache.set(cacheKey, { savedAt: Date.now(), data: fresh, fp: fpNew });
      if(fpOld !== fpNew) onFresh?.(fresh);
    }catch{}
  }
}

/* ===== Köad skrivning (offline-tålig) ===== */
export function enqueueWrite(action, payload){
  SaveQueue.enqueue({ action, payload });
  scheduleFlush(sendJobToServer, 700);
}

async function sendJobToServer(job){
  const { action, payload } = job;
  await api(action, payload || {});
}
