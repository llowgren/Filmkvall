// film-wishlist.js
import { api } from './api.js';
import { getWho, on } from './store.js';

customElements.define('film-wishlist', class extends HTMLElement {
  connectedCallback() {
    this.render();
    this.unsubWho = on('who', () => this.load());
    this.load();
  }

  disconnectedCallback() {
    this.unsubWho?.();
  }

  render() {
    this.innerHTML = `
      <div class="card">
        <div class="row" style="align-items:end; gap:12px">
          <div class="col">
            <h3 style="margin:0">Önskelista</h3>
            <div class="muted" style="font-size:13px">
              Person: <span id="wlWho">–</span>
            </div>
          </div>
          <div class="col" style="flex:0 0 auto">
            <button id="wlReload" class="ghost">Hämta</button>
          </div>
        </div>

        <pre id="wlOut" style="white-space:pre-wrap;margin:10px 0 0">Laddar…</pre>
      </div>
    `;

    this.querySelector('#wlReload')?.addEventListener('click', () => this.load());
  }

  async load() {
    const who = getWho();
    const whoEl = this.querySelector('#wlWho');
    const out = this.querySelector('#wlOut');

    if (whoEl) whoEl.textContent = who || '–';
    if (!out) return;

    out.textContent = 'Laddar…';

    try {
      const j = await api('getWishlist', { person: who });
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