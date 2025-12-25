/* Filmkväll – ui.js
 * UI: render + bindningar. Innehåller DOM, men ingen hemlig config.
 */

import { Cache, pendingCount, updatePendingBadge } from './state.js';
import { api, apiSWR, enqueueWrite } from './api.js';
import { smartLookup, getStreamingInfo, imdbUrlFrom } from './lookup.js';

/* ===== Konfiguration (kan senare flyttas till config.js) ===== */
export const PEOPLE = ['Hannah','Maria','Tuva','Alva','Lars'];

/* ===== Helpers ===== */
const $  = (s)=>document.querySelector(s);
const escapeHtml = (s)=> String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const round1 = (x)=>Math.round((Number(x)||0)*10)/10;

export function setStatus(ok, msg){
  const el = $('#apiStatus');
  if(!el) return;
  const base = (ok?'OK – ':'Fel – ') + msg;
  const n = pendingCount();
  el.textContent = base + (n ? ` (${n} i kö)` : '');
  el.className = 'pill ' + (ok ? 'ok' : 'err');
  updatePendingBadge();
}

export function setSuggestedEditable(isEditable){
  const el = $('#suggested');
  if(!el) return;
  el.readOnly = !isEditable;
  el.placeholder = isEditable ? 'Skriv film här om listan är tom…' : '';
}

/* ===== OMDb/TMDb render ===== */
export async function renderTitleInfo(containerId, data, query, opts={}){
  const withStreaming = (opts.withStreaming !== false);
  const el = document.getElementById(containerId);
  if(!el) return;

  if(!data){
    el.innerHTML = `<div style="color:var(--muted)">Hittade inget för: ${escapeHtml(query||'')}</div>`;
    return;
  }

  const title  = escapeHtml(data.Title || '');
  const year   = escapeHtml(data.Year || '');
  const rating = escapeHtml(data.imdbRating || '-');
  const link   = imdbUrlFrom(data);
  const poster = (data.Poster && data.Poster !== 'N/A')
    ? `<img src="${data.Poster}" alt="poster" loading="lazy" decoding="async">`
    : '';

  // Streaming – lazy med cache
  let streamingHtml = '';
  if(withStreaming && data.imdbID){
    const cacheKey = `wm_sources_${data.imdbID}`;
    const cached = Cache.get(cacheKey)?.data || null;

    const buildPills = (options)=>{
      if(!options || !options.length){
        return `<div style="margin-top:6px; color:var(--muted); font-size:12px">Inget abonnemang hittades just nu.</div>`;
      }
      const pills = options.map(opt=>{
        const label = [opt.service, opt.quality?` ${opt.quality}`:'', opt.region?` · ${opt.region}`:''].join('');
        const href = opt.link ? `href="${opt.link}" target="_blank" rel="noopener"` : '';
        return `<a ${href} class="pill" style="text-decoration:none">${escapeHtml(label)} (ingår)</a>`;
      }).join('');

      return `
        <div class="streaming-wrap" data-imdb="${escapeHtml(data.imdbID)}">
          <strong>Tillgängligt i abonnemang (globalt):</strong>
          <div class="streaming-row collapsed">${pills}</div>
          <button type="button" class="streaming-toggle" style="display:none">…</button>
        </div>`;
    };

    if(cached){
      streamingHtml = buildPills(cached);
    }else{
      streamingHtml = `
        <div class="streaming-wrap" data-imdb="${escapeHtml(data.imdbID)}">
          <strong>Tillgängligt i abonnemang (globalt):</strong>
          <div style="margin-top:6px; color:var(--muted); font-size:12px">(klicka för att hämta)</div>
          <button type="button" class="streaming-toggle" style="display:inline-block">…</button>
        </div>`;
    }
  }

  el.innerHTML = `
    ${poster}
    <div>
      <strong>${title}</strong>${year?` (${year})`:''}<br>
      IMDb ${rating}${link?` — <a href="${link}" target="_blank" rel="noopener">Öppna på IMDb</a>`:''}
      ${streamingHtml}
    </div>`;

  // Toggle + lazy fetch
  const wrap = el.querySelector('.streaming-wrap');
  const row = el.querySelector('.streaming-row');
  const toggle = el.querySelector('.streaming-toggle');

  if(wrap && toggle){
    const imdbID = wrap.getAttribute('data-imdb') || '';

    const ensureToggleVisibility = (r)=>{
      if(!r) return;
      requestAnimationFrame(()=>{
        const needs = r.scrollHeight > r.clientHeight + 2;
        toggle.style.display = needs ? 'inline-block' : 'none';
        toggle.textContent = r.classList.contains('collapsed') ? '…' : 'visa färre';
      });
    };

    if(row){
      ensureToggleVisibility(row);
      toggle.addEventListener('click', ()=>{
        const collapsed = row.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '…' : 'visa färre';
      });
      return;
    }

    // klicka för att hämta
    toggle.addEventListener('click', async ()=>{
      if(!imdbID) return;
      toggle.disabled = true;
      toggle.textContent = 'hämtar…';
      const options = await getStreamingInfo(imdbID);

      const html = (options && options.length)
        ? (()=>{
            const pills = options.map(opt=>{
              const label = [opt.service, opt.quality?` ${opt.quality}`:'', opt.region?` · ${opt.region}`:''].join('');
              const href = opt.link ? `href="${opt.link}" target="_blank" rel="noopener"` : '';
              return `<a ${href} class="pill" style="text-decoration:none">${escapeHtml(label)} (ingår)</a>`;
            }).join('');
            return `<div class="streaming-row collapsed">${pills}</div>`;
          })()
        : `<div style="margin-top:6px; color:var(--muted); font-size:12px">Inget abonnemang hittades just nu.</div>`;

      // ta bort hint
      const hint = wrap.querySelector('div');
      // hint är första div efter strong i "klicka för att hämta"-läget
      // men vi låter den ligga kvar om den inte matchar.
      if(hint && hint.textContent?.includes('klicka')) hint.remove();

      wrap.insertAdjacentHTML('beforeend', html);
      const newRow = wrap.querySelector('.streaming-row');
      if(!newRow){ toggle.remove(); return; }

      toggle.disabled = false;
      toggle.textContent = '…';
      ensureToggleVisibility(newRow);

      toggle.onclick = ()=>{
        const collapsed = newRow.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '…' : 'visa färre';
      };
    });
  }
}

/* ===== Renders ===== */
export function renderTops(tops){
  const el = $('#tops');
  if(!el) return;

  if(tops?.ok){
    const films = (tops.bestFilms||[]).map(x=>
      `<div class="pill">${escapeHtml(x.film)} — <strong>${escapeHtml(x.avg)}</strong> <span class="muted">(${escapeHtml(x.who)})</span></div>`
    ).join('') || '–';

    const pickers = (tops.bestPickers||[]).map(x=>
      `<div class="pill">${escapeHtml(x.who)} — <strong>${escapeHtml(x.avg)}</strong> <span class="muted">(${escapeHtml(x.n)} filmer)</span></div>`
    ).join('') || '–';

    el.innerHTML = `<div class="row"><div class="col"><label>Bästa filmer</label>${films}</div><div class="col"><label>Bästa väljare</label>${pickers}</div></div>`;
  }else{
    el.innerHTML = '<div class="muted">Kunde inte hämta topplistor.</div>';
  }
}

export function renderHistory(hist){
  const el = $('#history');
  if(!el) return;

  if(hist?.ok){
    const rows = (hist.rows||[]).map(r=>{
      const nums = PEOPLE.map(p=>Number(r[p])||0).filter(x=>x>0);
      const avg = nums.length? round1(nums.reduce((a,b)=>a+b,0)/nums.length) : '-';
      const per = PEOPLE.map(p=>`${p}: ${r[p]||'-'}`).join(' • ');
      return `<div class="pill" style="display:block;margin:6px 0;padding:10px 12px">
        <strong>${escapeHtml(r['Film']||'–')}</strong> — ${escapeHtml(r['Datum']||'')}
        <span class="muted"> (val: ${escapeHtml(r['Vem valde']||'-')}, Snitt: ${escapeHtml(avg)})</span><br/>
        <span class="muted">${escapeHtml(per)}</span></div>`;
    }).join('');
    el.innerHTML = rows || 'Tomt.';
  }else{
    el.innerHTML = '<div class="muted">Kunde inte hämta historik.</div>';
  }
}

/* ===== Data loaders ===== */
export function applyCurrent(cur){
  if(!cur?.ok) return;

  $('#nextName').value = cur.next || '';

  const suggestedEl = $('#suggested');
  if(suggestedEl){
    const serverSuggestion = (cur.suggestion || '').trim();
    const userTyped = !suggestedEl.readOnly && (suggestedEl.value||'').trim().length > 0;
    if(!userTyped){
      suggestedEl.value = serverSuggestion;
      setSuggestedEditable(serverSuggestion.length === 0);
    }else{
      setSuggestedEditable(true);
    }
  }

  if(cur.scores){
    for(const p of PEOPLE){
      const el = document.getElementById(`s-${p}`);
      if(el) el.value = cur.scores[p] ?? '';
    }
  }
}

export async function loadAll(){
  try{
    const now = new Date().toLocaleTimeString('sv-SE', {hour:'2-digit', minute:'2-digit'});

    const cur = await apiSWR('getCurrent', {}, {
      cacheKey:'api_getCurrent_v1',
      maxAgeMs: 20_000,
      fingerprint: (j)=> `${j?.ok?'1':'0'}|${j?.next||''}|${j?.suggestion||''}|${PEOPLE.map(p=>j?.scores?.[p]??'').join(',')}`,
      onFresh: (fresh)=>applyCurrent(fresh)
    });
    applyCurrent(cur);

    const tops = await apiSWR('getTops', {limit:5}, {
      cacheKey:'api_getTops_v1_5',
      maxAgeMs: 5*60_000,
      fingerprint: (j)=>{
        const bf = (j?.bestFilms||[]).map(x=>`${x.film}:${x.avg}:${x.who}`).join('|');
        const bp = (j?.bestPickers||[]).map(x=>`${x.who}:${x.avg}:${x.n}`).join('|');
        return `${j?.ok?'1':'0'}|${bf}|${bp}`;
      },
      onFresh: (fresh)=>renderTops(fresh)
    });
    renderTops(tops);

    const hist = await apiSWR('getHistory', {limit:10}, {
      cacheKey:'api_getHistory_v1_10',
      maxAgeMs: 60_000,
      fingerprint: (j)=>{
        const r = j?.rows || [];
        const last = r[0] || r[r.length-1] || {};
        return `${j?.ok?'1':'0'}|${r.length}|${last['Datum']||''}|${last['Film']||''}`;
      },
      onFresh: (fresh)=>renderHistory(fresh)
    });
    renderHistory(hist);

    // suggested meta
    const q = $('#suggested')?.value || '';
    const data = await smartLookup(q);
    await renderTitleInfo('suggested-info', data, q, {withStreaming:true});

    setStatus(true, `API svarar – uppdaterat ${now}`);
  }catch(e){
    console.error(e);
    setStatus(false, 'Fel vid laddning');
  }
}

/* ===== Write actions ===== */
export function saveScoresPatch(patch){
  enqueueWrite('saveScores', { scores: JSON.stringify(patch) });
}

export function saveWishlist(body){
  enqueueWrite('saveWishlist', body);
}

export function skipNext(){
  enqueueWrite('skipNext', {});
}

export function saveNight({who, film, comment}){
  enqueueWrite('saveNight', { who, film, comment });
}
