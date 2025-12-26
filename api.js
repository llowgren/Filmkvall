// api.js
import { getAuth } from './store.js';

export const API_URL = 'DIN_WEBAPP_URL_HÄR'; // samma som innan

export async function api(action, params = {}){
  const { token, pw } = getAuth();

  // Just nu kör vi “som idag” (GET + pw). Sen kan vi byta till POST/token.
  const qs = new URLSearchParams({ action, ...(pw ? { pw } : {}), ...params });
  const url = `${API_URL}?${qs.toString()}`;

  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json();
  return j;
}