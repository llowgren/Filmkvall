// store.js
// Minimal global state + pub/sub. Login owns "who" and auth; other modules consume.

const listeners = new Map(); // key -> Set<fn>

const state = {
  who: (localStorage.getItem('film_who') || 'Maria').trim(),
  auth: {
    token: localStorage.getItem('film_token') || '',
    pw: localStorage.getItem('film_pw') || ''
  }
};

// ---------- WHO (login controls) ----------
export function getWho() {
  return state.who;
}

export function setWho(who) {
  const next = (who || '').trim();
  if (!next || next === state.who) return;

  state.who = next;
  try { localStorage.setItem('film_who', state.who); } catch {}
  emit('who', state.who);
}

// ---------- AUTH (login controls) ----------
export function getAuth() {
  // return copy to prevent accidental mutation
  return { ...state.auth };
}

export function setAuth(partial) {
  const patch = partial || {};
  const next = {
    token: ('token' in patch) ? (patch.token || '') : state.auth.token,
    pw:    ('pw'    in patch) ? (patch.pw    || '') : state.auth.pw
  };

  // no-op if unchanged
  if (next.token === state.auth.token && next.pw === state.auth.pw) return;

  state.auth = next;

  try {
    if ('token' in patch) localStorage.setItem('film_token', state.auth.token);
    if ('pw' in patch)    localStorage.setItem('film_pw', state.auth.pw);
  } catch {}

  emit('auth', getAuth());
}

// ---------- PUB/SUB ----------
export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);

  // return unsubscribe
  return () => {
    try { listeners.get(key)?.delete(fn); } catch {}
  };
}

function emit(key, value) {
  const subs = listeners.get(key);
  if (!subs || subs.size === 0) return;

  for (const fn of subs) {
    try { fn(value); } catch {}
  }
}