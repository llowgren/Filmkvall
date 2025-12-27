// store.js
// Global state + pub/sub.
// Äger: who, auth, theme och applicerar theme på <html> så ALLA moduler följer.
//
// Viktigt: Vi sätter ALLTID html[data-theme="dark"|"light"] explicit.
// Då slipper vi alla buggar kring "default = dark/light".

const listeners = new Map(); // key -> Set<fn>

const THEME_ALLOWED = new Set(['auto', 'dark', 'light']);

const state = {
  who: (localStorage.getItem('film_who') || 'Maria').trim(),
  auth: {
    token: localStorage.getItem('film_token') || '',
    pw: localStorage.getItem('film_pw') || '',
  },
  theme: (localStorage.getItem('film_theme') || 'auto').trim(), // auto|dark|light
};

// ---------- PUB/SUB ----------
export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => {
    try { listeners.get(key)?.delete(fn); } catch {}
  };
}

function emit(key, value) {
  const subs = listeners.get(key);
  if (!subs) return;
  for (const fn of subs) {
    try { fn(value); } catch {}
  }
}

// ---------- WHO ----------
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

// ---------- AUTH ----------
export function getAuth() {
  return { ...state.auth };
}

export function setAuth(partial) {
  const patch = partial || {};
  const next = {
    token: ('token' in patch) ? (patch.token || '') : state.auth.token,
    pw:    ('pw'    in patch) ? (patch.pw    || '') : state.auth.pw,
  };

  if (next.token === state.auth.token && next.pw === state.auth.pw) return;

  state.auth = next;

  try {
    if ('token' in patch) localStorage.setItem('film_token', state.auth.token);
    if ('pw' in patch)    localStorage.setItem('film_pw', state.auth.pw);
  } catch {}

  emit('auth', getAuth());
}

// ---------- THEME ----------
export function getTheme() {
  return THEME_ALLOWED.has(state.theme) ? state.theme : 'auto';
}

export function setTheme(theme) {
  const raw = String(theme || 'auto').trim();
  const next = THEME_ALLOWED.has(raw) ? raw : 'auto';
  if (next === state.theme) return;

  state.theme = next;
  try { localStorage.setItem('film_theme', state.theme); } catch {}

  applyThemeToDom();
  emit('theme', state.theme);
}

// Resolve 'auto' -> ('light'|'dark'), annars returnera valt läge
export function resolveThemeMode(sel = getTheme()) {
  if (sel === 'light') return 'light';
  if (sel === 'dark') return 'dark';
  // auto
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// Applicera på <html> så hela sidan följer (alla moduler)
export function applyThemeToDom() {
  const root = document.documentElement;
  const mode = resolveThemeMode(getTheme()); // 'light' | 'dark'

  // ✅ Explicit – ingen "default = dark/light"-gissning
  root.setAttribute('data-theme', mode);

  // Hjälper native controls (select/input) att matcha
  root.style.colorScheme = mode;
}

// OS theme change → re-apply om auto
let _mql;
try {
  _mql = window.matchMedia('(prefers-color-scheme: light)');
  const onSchemeChange = () => {
    if (getTheme() === 'auto') {
      applyThemeToDom();
      emit('theme', state.theme); // så UI som visar "auto" kan re-rendera om den vill
    }
  };
  _mql.addEventListener?.('change', onSchemeChange);
  _mql.addListener?.(onSchemeChange); // Safari fallback
} catch {}

// Kör direkt vid load så sidan är korrekt från start
try { applyThemeToDom(); } catch {}

// ---------- DEBUG ----------
export function getDebugSnapshot() {
  const a = getAuth();
  return {
    who: getWho(),
    theme: getTheme(),
    resolvedTheme: resolveThemeMode(getTheme()),
    auth: {
      pw: a.pw ? '(satt)' : '',
      token: a.token ? '(satt)' : '',
    },
  };
}