import { api } from './api.js';

customElements.define('film-tops', class extends HTMLElement {
  connectedCallback() { this.load(); }

  async load(){
    this.innerHTML = `<div class="card"><h3>Topplistor</h3><div class="muted">Laddar…</div></div>`;
    try{
      const j = await api('getTops', { limit: 5 });
      this.innerHTML = `
        <div class="card">
          <h3>Topplistor (topp 5)</h3>
          <pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify(j, null, 2))}</pre>
        </div>`;
    }catch(e){
      this.innerHTML = `<div class="card"><h3>Topplistor</h3><div class="err">Fel</div></div>`;
    }
  }
});

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }