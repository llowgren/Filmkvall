/* Filmkväll – state.js
 * Klient-state, cache, guards och offline-kö
 * Innehåller INGEN DOM-rendering och INGA direkta API-anrop
 */

/* ===== Lokal cache (localStorage wrapper) ===== */
export const Cache = {
  get(key){
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  },
  set(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  del(key){
    try { localStorage.removeItem(key); } catch {}
  }
};

/* ===== Offline / bakgrunds-kö ===== */
export const SaveQueue = {
  key: 'filmkvall_savequeue_v1',

  read(){ return Cache.get(this.key) || []; },
  write(q){ Cache.set(this.key, q); },

  enqueue(job){
    const q = this.read();
    q.push({ ...job, ts: Date.now() });
    this.write(q);
  },

  async flush(flusher){
    const q = this.read();
    if(!q.length) return;

    const remaining = [];
    for(let i=0;i<q.length;i++){
      const job = q[i];
      try{
        await flusher(job);
      }catch(e){
        remaining.push(job, ...q.slice(i+1));
        this.write(remaining);
        throw e;
      }
    }
    this.write([]);
  }
};

let flushTimer = null;
export function scheduleFlush(flusher, delayMs=700){
  clearTimeout(flushTimer);
  flushTimer = setTimeout(()=>SaveQueue.flush(flusher).catch(()=>{}), delayMs);
}

export function pendingCount(){
  return (SaveQueue.read() || []).length;
}

/* ===== Natt-spar-skydd (dubbel-save guard) ===== */
export const NightSaveGuard = {
  storageKey: 'filmkvall_lastNightSave_v1',

  getLocalDateISO(){
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  normFilm(s){
    return String(s||'').trim().toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/\s+/g,' ');
  },

  snapshot({ who, film, scores, comment }){
    const dateISO = this.getLocalDateISO();
    const key = `${dateISO}::${who}::${this.normFilm(film)}`;

    return {
      key,
      scoresHash: JSON.stringify(scores||{}),
      commentHash: String(comment||'')
    };
  },

  read(){
    try{ return JSON.parse(localStorage.getItem(this.storageKey) || 'null'); }
    catch{ return null; }
  },

  write(obj){
    try{ localStorage.setItem(this.storageKey, JSON.stringify(obj)); }catch{}
  },

  shouldBlock(currentSnap){
    const last = this.read();
    if(!last) return false;
    return last.key === currentSnap.key
      && last.scoresHash === currentSnap.scoresHash
      && last.commentHash === currentSnap.commentHash;
  },

  markSaved(snap){
    this.write({ ...snap, savedAt: Date.now() });
  }
};

/* ===== Små helpers ===== */
export function todayISO(){
  return NightSaveGuard.getLocalDateISO();
}
