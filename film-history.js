import { api } from './api.js';

customElements.define('film-history', class extends HTMLElement {
  connectedCallback() { this.load(); }

  async load(){
    this.innerHTML = `<div class="card"><h3>Historik</h3><div class="muted">Laddar…</div></div>`;
    try{
      const j = await api('getHistory', { limit: 10 });
      this.innerHTML = `
        <div class="card">
          <h3>Historik (senaste 10)</h3>
          <pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify(j, null, 2))}</pre>
        </div>`;
    }catch(e){
      this.innerHTML = `<div class="card"><h3>Historik</h3><div class="err">Fel</div></div>`;
    }
  }
});

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }