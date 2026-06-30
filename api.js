import { getAuth } from './store.js';
import { getApiUrl } from './film-login.js';

export async function api(action, params = {}) {
  const { token, pw } = getAuth();
  const API_URL = getApiUrl();

  if (!API_URL) throw new Error('API URL saknas');

  const qs = new URLSearchParams({
    action,
    ...(pw ? { pw } : {}),
    ...params
  });

  const r = await fetch(`${API_URL}?${qs}`, { cache: 'no-store' });
  return r.json();
}

export async function apiPost(action, params = {}) {
  const { pw } = getAuth();
  const API_URL = getApiUrl();

  if (!API_URL) throw new Error('API URL saknas');

  const body = new URLSearchParams({
    action,
    ...(pw ? { pw } : {}),
    ...params
  });

  const r = await fetch(API_URL, {
    method: 'POST',
    body,
    cache: 'no-store'
  });
  return r.json();
}
