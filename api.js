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

export async function apiCall(action, payload = {}){
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      action,
      token: API_TOKEN,
      ...payload
    })
  });

  const j = await parseJsonResponse(res);
  if (!j || j.ok !== true){
    throw new Error(j?.error || 'API error');
  }
  return j;
}
