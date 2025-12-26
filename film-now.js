// film-now.js
import { api } from './api.js';

customElements.define('film-now', class extends HTMLElement {
  connectedCallback() {
    this.renderLoading();
    this.load();
  }

  renderLoading() {
    this.innerHTML = `
      <div class="card">
        <h3>På tur nu</h3>
        <div class="muted">Laddar…</div>
      </div>`;
  }

  async load() {
    try {
      const data = await api('getCurrent');
      this.innerHTML = `
        <div class="card">
          <h3>På tur nu</h3>
          <pre style="white-space:pre-wrap">${JSON.stringify(data, null, 2)}</pre>
        </div>`;
    } catch (e) {
      this.innerHTML = `
        <div class="card">
          <h3>På tur nu</h3>
          <div class="err">Kunde inte ladda</div>
        </div>`;
    }
  }
});