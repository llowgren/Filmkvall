/* Filmkväll – lookup.js
 * Filmdatakällor: TMDb (sök), OMDb (detaljer), Watchmode (streaming)
 * Innehåller ingen UI-kod – bara fetch + normalisering + cache
 */

import { Cache } from './state.js';

/* ===== API-nycklar (lägg i localStorage, inte i repo) =====
 * localStorage keys:
 *  - filmkvall_tmdb_key
 *  - filmkvall_omdb_key
 *  - filmkvall_watchmode_key
 */
function getKey_(lsKey){
  try{ return (localStorage.getItem(lsKey) || '').trim(); }
  catch{ return ''; }
}

const TMDB_URL = 'https://api.themoviedb.org/3';
const OMDB_URL = 'https://www.omdbapi.com/';

/* ===== Helpers ===== */
export function imdbUrlFrom(data){
  return data?.imdbID ? `https://www.imdb.com/title/${data.imdbID}/` : '';
}

function normLite(s){
  return String(s||'').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9åäö\s:!?.\-]/g,'')
    .trim();
}

async function getMetaCached(key, fetcher, ttlMs){
  const cached = Cache.get(key);
  const now = Date.now();
  if(cached?.data && cached.savedAt && (now - cached.savedAt) < ttlMs) return cached.data;
  const data = await fetcher();
  Cache.set(key, { savedAt: now, data });
  return data;
}

/* ===== TMDb ===== */
export async function tmdbSearchMovies(query, limit=8){
  const TMDB_KEY = getKey_('filmkvall_tmdb_key');
  if(!TMDB_KEY || !query) return [];

  const url = `${TMDB_URL}/search/movie?api_key=${encodeURIComponent(TMDB_KEY)}&language=sv-SE&include_adult=false&query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { cache:'no-store' }).catch(()=>null);
  if(!r || !r.ok) return [];
  const j = await r.json().catch(()=>null);
  const res = Array.isArray(j?.results) ? j.results : [];

  return res.slice(0, limit).map(it=>({
    title: it.title || it.original_title || '',
    year: (it.release_date||'').slice(0,4) || '',
    tmdbId: it.id,
    posterPath: it.poster_path || ''
  }));
}

async function tmdbSearchMovieBest(query){
  const hits = await tmdbSearchMovies(query, 10);
  if(!hits.length) return null;

  const qn = normLite(query);
  const scored = hits.map(it=>{
    const tn = normLite(it.title);
    let score = 0;
    if(tn === qn) score = 100;
    else if(tn.startsWith(qn)) score = 80;
    else if(tn.includes(qn)) score = 60;
    // Svag bonus om vi har år i query och träffens år matchar
    const m = String(query).match(/\((\d{4})\)\s*$/);
    if(m && it.year && it.year === m[1]) score += 10;
    return { score, it };
  }).sort((a,b)=>b.score-a.score);

  return scored[0].it;
}

async function tmdbExternalIds(movieId){
  const TMDB_KEY = getKey_('filmkvall_tmdb_key');
  if(!TMDB_KEY || !movieId) return null;
  const url = `${TMDB_URL}/movie/${movieId}/external_ids?api_key=${encodeURIComponent(TMDB_KEY)}`;
  const r = await fetch(url, { cache:'no-store' }).catch(()=>null);
  if(!r || !r.ok) return null;
  return r.json().catch(()=>null);
}

async function tmdbLookup(query){
  const hit = await tmdbSearchMovieBest(query);
  if(!hit) return null;

  let imdbID = '';
  try{
    const ids = await tmdbExternalIds(hit.tmdbId);
    imdbID = ids?.imdb_id || '';
  }catch{}

  // TMDb poster w92
  const poster = hit.posterPath ? `https://image.tmdb.org/t/p/w92${hit.posterPath}` : 'N/A';

  return {
    Title: hit.title || '',
    Year: hit.year || '',
    Poster: poster,
    imdbID,
    imdbRating: '-'
  };
}

/* ===== OMDb ===== */
export async function omdbLookup(query){
  const OMDB_KEY = getKey_('filmkvall_omdb_key');
  if(!OMDB_KEY || !query) return null;

  let q = String(query).trim();
  let year = null;
  const mYear = q.match(/\((\d{4})\)$/);
  if(mYear){ year = mYear[1]; q = q.replace(/\s*\(\d{4}\)\s*$/,''); }

  // Direkt imdb-id
  const tt = (q.match(/tt\d{7,}/i) || q.match(/imdb\.com\/title\/(tt\d+)/i));
  if(tt){
    const id = (tt[1] || tt[0]).replace(/^.*(tt\d+).*$/,'$1');
    const r = await fetch(`${OMDB_URL}?apikey=${OMDB_KEY}&i=${id}&plot=short`, { cache:'no-store' }).catch(()=>null);
    const j = r ? await r.json().catch(()=>null) : null;
    if(j && j.Response !== 'False') return j;
    return null;
  }

  // Försök exakt titel
  try{
    const r1 = await fetch(`${OMDB_URL}?apikey=${OMDB_KEY}&t=${encodeURIComponent(q)}${year?`&y=${year}`:''}&type=movie&plot=short`, { cache:'no-store' });
    const j1 = await r1.json();
    if(j1 && j1.Response !== 'False') return j1;
  }catch{}

  // Fallback: search
  try{
    const r2 = await fetch(`${OMDB_URL}?apikey=${OMDB_KEY}&s=${encodeURIComponent(q)}&type=movie`, { cache:'no-store' });
    const j2 = await r2.json();
    if(j2 && j2.Response !== 'False' && Array.isArray(j2.Search) && j2.Search.length){
      const nq = normLite(q);
      const scored = j2.Search
        .map(it=>({ it, nt:normLite(it.Title), y:it.Year }))
        .map(o=>{
          let score = 0;
          if(o.nt === nq) score = 3;
          else if(o.nt.startsWith(nq)) score = 2;
          else if(o.nt.includes(nq)) score = 1;
          if(year && String(o.y) === String(year)) score += 0.5;
          return { score, it:o.it };
        })
        .sort((a,b)=>b.score-a.score);

      return scored[0]?.it ? await omdbLookup(scored[0].it.Title) : null;
    }
  }catch{}

  return null;
}

/* ===== Smart lookup (TMDb först, sedan OMDb) ===== */
export async function smartLookup(query){
  if(!query) return null;
  const q = String(query).trim();
  const cacheKey = `smartLookup_v1_${normLite(q)}`;

  return getMetaCached(cacheKey, async ()=>{
    // Om query redan är imdb-id/länk: gå direkt på OMDb
    if(/\btt\d{7,}\b/i.test(q) || /imdb\.com\/title\/tt\d+/i.test(q)){
      const om = await omdbLookup(q);
      if(om) return om;
    }

    const tm = await tmdbLookup(q);
    if(tm){
      if(tm.imdbID) return tm;
      const tryOm = await omdbLookup(`${tm.Title} (${tm.Year||''})`);
      return tryOm || tm;
    }

    return await omdbLookup(q);
  }, 30*24*3600_000);
}

/* ===== Watchmode (streaming) ===== */
const _wmIdCache = new Map();

async function wmTitleIdFromImdb(imdbID){
  const WATCHMODE_KEY = getKey_('filmkvall_watchmode_key');
  if(!WATCHMODE_KEY || !imdbID) return null;

  try{
    const u1 = `https://api.watchmode.com/v1/find/?apiKey=${WATCHMODE_KEY}&source=imdb&external_id=${encodeURIComponent(imdbID)}`;
    let r = await fetch(u1, { cache:'no-store' }).catch(()=>null);
    if(r?.ok){
      const j = await r.json().catch(()=>null);
      if(j?.title_id) return j.title_id;
    }

    const u2 = `https://api.watchmode.com/v1/search/?apiKey=${WATCHMODE_KEY}&search_field=imdb_id&search_value=${encodeURIComponent(imdbID)}`;
    r = await fetch(u2, { cache:'no-store' }).catch(()=>null);
    if(r?.ok){
      const j = await r.json().catch(()=>null);
      const hit = Array.isArray(j?.title_results)
        ? j.title_results.find(t => String(t.imdb_id) === String(imdbID))
        : null;
      if(hit?.id) return hit.id;
    }
  }catch{}

  return null;
}

async function getWmIdCached(imdbID){
  if(_wmIdCache.has(imdbID)) return _wmIdCache.get(imdbID);
  const id = await wmTitleIdFromImdb(imdbID);
  _wmIdCache.set(imdbID, id);
  return id;
}

export async function getStreamingInfo(imdbID){
  const WATCHMODE_KEY = getKey_('filmkvall_watchmode_key');
  if(!WATCHMODE_KEY || !imdbID) return null;

  return getMetaCached(`wm_sources_${imdbID}`, async ()=>{
    try{
      const wmId = await getWmIdCached(imdbID);
      if(!wmId) return null;

      const url = `https://api.watchmode.com/v1/title/${wmId}/sources/?apiKey=${WATCHMODE_KEY}`;
      const res = await fetch(url, { cache:'no-store' }).catch(()=>null);
      if(!res?.ok) return null;

      const data = await res.json().catch(()=>null);
      if(!Array.isArray(data)) return null;

      const seen = new Set();
      const normalizeName = s => String(s || '')
        .replace(/\s*\(with Ads\)$/i, '')
        .replace(/\s+HD$/i, '')
        .trim();

      const filtered = data
        .filter(s => s.type === 'sub' && s.name)
        .map(s => ({
          service: normalizeName(s.name),
          quality: (s.format === '4K' || s.format === 'HD') ? s.format : '',
          region: s.region || '',
          link: s.web_url || ''
        }))
        .filter(s => {
          const k = `${s.service}|${s.quality}|${s.region}`;
          if(seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a,b)=>(a.service+a.region+a.quality).localeCompare(b.service+b.region+b.quality));

      return filtered.length ? filtered : null;
    }catch{
      return null;
    }
  }, 7*24*3600_000);
}
