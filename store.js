// store.js
// Minimal global state + pub/sub. Login owns "who" and auth; other modules consume.
// Plus: global theme setting (auto/dark/light) that affects the whole page.

const listeners = new Map(); // key -> Set<fn>

const state = {
  who: (localStorage.getItem('film_who') || 'Maria').trim(),
  auth: {
    token: localStorage.getItem('film_token') || '',
    pw: localStorage.getItem('film_pw') || ''
  },
  theme: (localStorage.getItem('film_theme') || 'auto').trim() // 'auto' | 'dark' | 'light'
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

// ---------- THEME (system controls) ----------
export function getTheme() {
  return state.theme || 'auto';
}

export function setTheme(theme) {
  const next = (theme || 'auto').trim();
  const allowed = new Set(['auto', 'dark', 'light']);
  const normalized = allowed.has(next) ? next : 'auto';

  if (normalized === state.theme) return;

  state.theme = normalized;
  try { localStorage.setItem('film_theme', state.theme); } catch {}

  applyThemeToDom();
  emit('theme', state.theme);
}

// Apply theme to <html> so ALL modules/styles respond.
// dark is default (no attribute), light sets data-theme="light"
export function applyThemeToDom() {
  const root = document.documentElement;
  const mode = resolveThemeMode(state.theme);

  if (mode === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');

  // Helps form controls match theme
  root.style.colorScheme = (mode === 'light') ? 'light' : 'dark';
}

function resolveThemeMode(sel) {
  if (sel === 'light') return 'light';
  if (sel === 'dark') return 'dark';
  // auto
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// Listen for OS theme changes when user selected auto
let _mql;
try {
  _mql = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    if ((state.theme || 'auto') === 'auto') applyThemeToDom();
  };
  _mql.addEventListener?.('change', onChange);
  _mql.addListener?.(onChange); // Safari fallback
} catch {}

// Call once on module load so page is themed immediately
try { applyThemeToDom(); } catch {}

// ---------- DEBUG SNAPSHOT (optional helper) ----------
export function getDebugSnapshot() {
  const a = getAuth();
  return {
    who: getWho(),
    theme: getTheme(),
    auth: {
      pw: a.pw ? '(satt)' : '',
      token: a.token ? '(satt)' : ''
    }
  };
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