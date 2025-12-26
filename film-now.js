// film-now.js
import { api } from './api.js';
import { getWho, on } from './store.js';

customElements.define('film-now', class extends HTMLElement {
  connectedCallback() {
    this.renderShell();
    this.unsubWho = on('who', () => this.load());
    this.load();
  }

  disconnectedCallback() {
    this.unsubWho?.();
  }

  renderShell() {
    this.innerHTML = `
      <div class="card">
        <div class="row" style="align-items:end; gap:12px">
          <div class="col">
            <h3 style="margin:0">På tur nu</h3>
            <div class="muted" style="font-size:13px">
              Inloggad: <span id="nowWho">–</span>
            </div>
          </div>
          <div class="col" style="flex:0 0 auto">
            <button id="nowReload" class="ghost">Uppdatera</button>
          </div>
        </div>

        <pre id="nowOut" style="white-space:pre-wrap;margin:10px 0 0">Laddar…</pre>
      </div>
    `;

    this.querySelector('#nowReload')?.addEventListener('click', () => this.load());
  }

  async load() {
    const who = getWho();
    const whoEl = this.querySelector('#nowWho');
    const out = this.querySelector('#nowOut');

    if (whoEl) whoEl.textContent = who || '–';
    if (!out) return;

    out.textContent = 'Laddar…';

    try {
      const j = await api('getCurrent');
      out.textContent = JSON.stringify(j, null, 2);
    } catch (e) {
      out.textContent = JSON.stringify(
        { ok: false, error: String(e?.message || e) },
        null,
        2
      );
    }
  }
});