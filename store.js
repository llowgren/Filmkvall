// store.js
const listeners = new Map();

const state = {
  who: localStorage.getItem('film_who') || 'Maria',
  auth: {
    token: localStorage.getItem('film_token') || '',
    pw: localStorage.getItem('film_pw') || ''
  }
};

export function getWho(){ return state.who; }
export function setWho(who){
  state.who = who;
  localStorage.setItem('film_who', who);
  emit('who', who);
}

export function getAuth(){ return {...state.auth}; }
export function setAuth(auth){
  state.auth = { ...state.auth, ...auth };
  if ('token' in auth) localStorage.setItem('film_token', state.auth.token || '');
  if ('pw' in auth) localStorage.setItem('film_pw', state.auth.pw || '');
  emit('auth', getAuth());
}

export function on(key, fn){
  if(!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return ()=>listeners.get(key)?.delete(fn);
}

function emit(key, val){
  for(const fn of (listeners.get(key) || [])){
    try{ fn(val); }catch(_){}
  }
}