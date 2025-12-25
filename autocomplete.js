/* Filmkväll – autocomplete.js
 * TMDb-autocomplete för inputs med ac-<id> listor.
 */
import { tmdbSearchMovies } from './lookup.js';

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function debounce(fn, ms=250){
  let t;
  return (...args)=>{
    clearTimeout(t);
    t = setTimeout(()=>fn(...args), ms);
  };
}

function hideAc(id){
  const box = document.getElementById(`ac-${id}`);
  if(box){ box.style.display = 'none'; box.innerHTML = ''; }
}

function showAc(id, items, onPick){
  const box = document.getElementById(`ac-${id}`);
  if(!box) return;

  if(!items.length){ hideAc(id); return; }

  box.innerHTML = items.map((x,i)=>`
    <div class="ac-item" data-i="${i}">
      <div><strong>${escapeHtml(x.title)}</strong> <span class="ac-muted">${escapeHtml(x.year)}</span></div>
    </div>
  `).join('');

  box.style.display = 'block';

  box.querySelectorAll('.ac-item').forEach(el=>{
    const pickHandler = (ev)=>{
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      const i = Number(el.getAttribute('data-i'));
      onPick(items[i]);
      hideAc(id);
    };
    el.addEventListener('pointerdown', pickHandler, {passive:false});
    el.addEventListener('touchstart', pickHandler, {passive:false});
    el.addEventListener('click', pickHandler);
  });
}

export function bindAutocomplete(id){
  const input = document.getElementById(id);
  const box = document.getElementById(`ac-${id}`);
  if(!input || !box) return;

  let composing = false;
  input.addEventListener('compositionstart', ()=>{ composing = true; });
  input.addEventListener('compositionend',   ()=>{ composing = false; });

  const doSearch = debounce(async ()=>{
    if(composing) return;
    if(document.activeElement !== input) return;

    const q = (input.value || '').trim();
    if(q.length < 3){ hideAc(id); return; }

    const hits = await tmdbSearchMovies(q, 8);

    if(document.activeElement !== input) return;

    showAc(id, hits, (pick)=>{
      input.value = pick.year ? `${pick.title} (${pick.year})` : pick.title;
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
    });
  }, 380);

  input.addEventListener('input', doSearch);
  input.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') hideAc(id); });

  input.addEventListener('blur', ()=> setTimeout(()=>hideAc(id), 150));
}

// Stäng autocomplete vid klick utanför
document.addEventListener('click', (e)=>{
  if (e.target?.closest?.('.ac-wrap')) return;
  ['w1','w2','w3','w4','w5','suggested'].forEach(hideAc);
});
