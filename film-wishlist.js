// film-wishlist.js
import { api } from './api.js';

customElements.define('film-wishlist', class extends HTMLElement {
  connectedCallback() {
    this.renderLoading();
    this.load();
  }

  renderLoading() {
    this.innerHTML = `
      <div class="card">
        <h3>Önskelista</h3>
        <div class="muted">Laddar…</div>
      </div>`;
  }

  async load() {
    try {
      const data = await api('getWishlist');
      this.innerHTML = `
        <div class="card">
          <h3>Önskelista</h3>
          <pre style="white-space:pre-wrap">${JSON.stringify(data, null, 2)}</pre>
        </div>`;
    } catch (e) {
      this.innerHTML = `
        <div class="card">
          <h3>Önskelista</h3>
          <div class="err">Kunde inte ladda</div>
        </div>`;
    }
  }
});