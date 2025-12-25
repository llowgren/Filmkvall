// Filmkväll – api.js
// All backendkommunikation. Token hanteras här – ALDRIG i UI.
//
// Viktigt:
// - API_URL ska vara din Web App-URL som slutar på /exec
// - API_TOKEN måste matcha Script Property API_TOKEN i Apps Script

export const API_URL = 'https://script.google.com/macros/s/AKfycby82y98CZDZc4d9tSdyi-dovoHf84sx4LC0RLQ-SosU44_BlNPzhsqWhqkNHU5Vsw7hrA/exec';

// ✅ Fast token – committas och används av frontend
// Måste matcha Script Property API_TOKEN i Apps Script
const API_TOKEN = 'filmkvall_v1_9f3d2a7c_2b1e_47d2_bcf2_4c8b1d3e6a91';

function asFormUrlEncoded(obj){
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue;
    if (v && typeof v === 'object') body.set(k, JSON.stringify(v));
    else body.set(k, String(v));
  }
  return body.toString();
}

function pushDebug(evt){
  const dbg = (window.__FILMKVALL_DEBUG__ = window.__FILMKVALL_DEBUG__ || []);
  try{
    dbg.push({ t: new Date().toISOString(), ...evt });
    if (dbg.length > 200) dbg.splice(0, dbg.length - 200);
  }catch{}
}

export async function apiCall(action, payload = {}){
  const req = { action, token: API_TOKEN, ...payload };
  const body = asFormUrlEncoded(req);

  pushDebug({ kind: 'request', action, url: API_URL, payload: req });

  let res;
  let text = '';
  try{
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      cache: 'no-store',
      body,
    });

    text = await res.text().catch(()=> '');

    let data = null;
    try{ data = text ? JSON.parse(text) : null; }catch{}

    pushDebug({
      kind: 'response',
      action,
      status: res.status,
      ok: res.ok,
      data,
      raw: data ? undefined : text.slice(0, 2000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` :: ${text.slice(0, 180)}` : ''}`);
    }

    if (!data || typeof data !== 'object') {
      throw new Error(`Bad JSON from backend: ${text ? text.slice(0, 180) : '(empty)'}`);
    }

    if (data.ok !== true) {
      throw new Error(data.error || 'API error');
    }

    return data;
  }catch(err){
    pushDebug({ kind: 'error', action, message: String(err), status: res?.status, raw: text.slice(0, 2000) });
    throw err;
  }
}
