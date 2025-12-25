/* Filmkväll – api.js
 * Backend-anrop + SWR-cache.
 * - Skickar auth i POST-body (inte i URL)
 * - Inga UI-fält för token/lösenord
 *
 * OBS om “hemligheter”:
 * På en statisk sida (GitHub Pages) kan en token aldrig bli helt hemlig –
 * den går alltid att läsa i nätverk/JS-kod. Den här lösningen handlar därför
 * om att användaren slipper mata in något, inte om “perfekt säkerhet”.
 */

import { Cache } from "./state.js";

// ===== Backend (Apps Script Web App URL) =====
// OBS: behåll /exec.
export const API_BASE = "https://script.google.com/macros/s/AKfycby82y98CZDZc4d9tSdyi-dovoHf84sx4LC0RLQ-SosU44_BlNPzhsqWhqkNHU5Vsw7hrA/exec";

// ===== Auth (osynligt för användaren) =====
// Prioritet:
// 1) localStorage (för enkel rotation utan commit)
// 2) fallback-konstant (för att sidan ska funka direkt)
const AUTH_STORAGE_KEY = "filmkvall_api_token_v1"; // token

// ✅ “Bara funka”-läge:
// Sätt API_TOKEN i Script Properties i Apps Script till exakt samma värde.
// (Byt gärna till ett långt slumpat värde när allt fungerar.)
const TOKEN_FALLBACK = "Look4fun";

function readLocal(key){
  try { return String(localStorage.getItem(key) || "").trim(); } catch { return ""; }
}

function getAuth(){
  const token = readLocal(AUTH_STORAGE_KEY) || TOKEN_FALLBACK;
  return { token: token || "" };
}

export function setAuthToken(token){
  try { localStorage.setItem(AUTH_STORAGE_KEY, String(token || "").trim()); } catch {}
}

// ===== Low-level request =====
export async function api(action, params = {}, { timeoutMs = 15000 } = {}){
  const { token } = getAuth();

  const body = {
    action,
    ...(token ? { token } : {}),
    ...params,
  };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try{
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: ac.signal,
    });

    // Apps Script kan ibland svara 302/HTML vid fel deploy/access
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();

    if (!ct.includes("application/json")){
      // Försök ändå parse:a om servern satte fel content-type
      try { return JSON.parse(text); } catch {
        return {
          ok:false,
          error:`Non-JSON response (${res.status}). Check Web App deploy/access.`,
          raw:text.slice(0,300)
        };
      }
    }

    return JSON.parse(text);
  } catch (e){
    const msg = (e && e.name === "AbortError")
      ? "Request timeout"
      : (e && e.message) ? e.message : String(e);
    return { ok:false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

// ===== SWR (stale-while-revalidate) =====
export async function fetchJsonSWR({ key, action, params = {}, maxAgeMs = 30_000, onFresh, fingerprint }){
  const cached = Cache.get(key);
  const now = Date.now();

  if (cached?.data){
    if (!cached.savedAt || (now - cached.savedAt) > maxAgeMs) refresh();
    return cached.data;
  }

  const data = await api(action, params);
  Cache.set(key, { savedAt: Date.now(), data, fp: safeFp(data) });
  return data;

  function safeFp(x){
    try{
      if (typeof fingerprint === "function") return String(fingerprint(x));
    }catch(_){ }
    try{
      if (x == null) return "null";
      if (typeof x !== "object") return String(x);
      if (Array.isArray(x)) return `a:${x.length}`;
      if ("rows" in x && Array.isArray(x.rows)){
        const r = x.rows;
        const last = r[0] || r[r.length-1] || {};
        return `rows:${r.length}:${last["Datum"]||""}:${last["Film"]||""}`;
      }
      return `o:${Object.keys(x).length}`;
    }catch(_){
      return "x";
    }
  }

  async function refresh(){
    try{
      const fresh = await api(action, params);
      const fpNew = safeFp(fresh);
      const fpOld = cached?.fp ?? safeFp(cached?.data);
      Cache.set(key, { savedAt: Date.now(), data: fresh, fp: fpNew });
      if (fpOld !== fpNew) onFresh?.(fresh);
    }catch(_){ }
  }
}

// Bekväm wrapper
export function apiSWR(action, params, { cacheKey, maxAgeMs, onFresh, fingerprint } = {}){
  return fetchJsonSWR({
    key: cacheKey || `api_${action}`,
    action,
    params,
    maxAgeMs: maxAgeMs ?? 30_000,
    onFresh,
    fingerprint,
  });
}
