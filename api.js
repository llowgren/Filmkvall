// Filmkväll – api.js
// All backendkommunikation. Token hanteras här – ALDRIG i UI.

export const API_URL = 'https://script.google.com/macros/s/AKfycby82y98CZDZc4d9tSdyi-dovoHf84sx4LC0RLQ-SosU44_BlNPzhsqWhqkNHU5Vsw7hrA/exec';

// ⚠️ Säkerhetsnotis: detta är en hemlighet. Lägger ni den i ett publikt repo kan vem som helst anropa er backend.
const API_TOKEN = 'filmkvall_v1_9f3d2a7c_2b1e_47d2_bcf2_4c8b1d3e6a91';

function toFormBody(obj){
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue;
    if (v && typeof v === 'object') body.set(k, JSON.stringify(v));
    else body.set(k, String(v));
  }
  return body.toString();
}

export async function apiCall(action, payload = {}) {
  const bodyObj = { action, token: API_TOKEN, ...payload };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    cache: 'no-store',
    body: toFormBody(bodyObj),
  });

  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0,180)}`);
  if (!data || typeof data !== 'object') throw new Error(`Bad JSON from backend: ${text.slice(0,180)}`);
  if (data.ok !== true) throw new Error(data.error || 'API error');

  return data;
}