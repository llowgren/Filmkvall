// Filmkväll – api.js
// All backendkommunikation. Token hanteras här – ALDRIG i UI.

export const API_URL = 'https://script.google.com/macros/s/PASTE_DIN_WEBAPP_URL_HÄR/exec';

// ✅ Fast token – committas och används av frontend
// Måste matcha Script Property API_TOKEN i Apps Script
const API_TOKEN = 'filmkvall_v1_9f3d2a7c_2b1e_47d2_bcf2_4c8b1d3e6a91';

async function parseJsonResponse(res){
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')){
    const txt = await res.text().catch(()=> '');
    throw new Error('Backend svarade inte JSON: ' + txt.slice(0,120));
  }
  return res.json();
}

export async function apiCall(action, payload = {}) {
  // Global debug buffer (för UI-panelen)
  const dbg = (window.__FILMKVALL_DEBUG__ = window.__FILMKVALL_DEBUG__ || []);
  const push = (obj) => {
    try {
      dbg.push({ t: new Date().toISOString(), ...obj });
      // håll bufferten rimlig
      if (dbg.length > 200) dbg.splice(0, dbg.length - 200);
    } catch {}
  };

  // Bygg body som "form-urlencoded" för att undvika CORS-preflight
  const bodyObj = {
    action,
    token: API_TOKEN,
    ...payload,
  };

  // Apps Script + form-encoded är oftast snällast
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(bodyObj)) {
    if (v === undefined) continue;
    // Om någon payload är ett objekt/array: skicka som JSON-sträng
    if (v && typeof v === "object") body.set(k, JSON.stringify(v));
    else body.set(k, String(v));
  }

  push({ kind: "request", action, url: API_URL, payload: bodyObj });

  let res;
  let text = "";
  try {
    res = await fetch(API_URL, {
      method: "POST",
      // VIKTIGT: Ingen application/json-header -> ingen preflight i många fall
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      cache: "no-store",
      body: body.toString(),
    });

    text = await res.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    push({
      kind: "response",
      action,
      status: res.status,
      ok: res.ok,
      data,
      raw: data ? undefined : text?.slice(0, 2000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` :: ${text.slice(0, 180)}` : ""}`);
    }

    if (!data || typeof data !== "object") {
      throw new Error(`Bad JSON from backend: ${text ? text.slice(0, 180) : "(empty)"}`);
    }

    return data;
  } catch (err) {
    push({
      kind: "error",
      action,
      message: String(err),
      status: res?.status,
      raw: text?.slice(0, 2000),
    });
    throw err;
  }
}

  const j = await parseJsonResponse(res);
  if (!j || j.ok !== true){
    throw new Error(j?.error || 'API error');
  }
  return j;
}
