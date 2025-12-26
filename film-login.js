// film-login.js
// Central source of truth for API URL, authentication, and external API tokens

import { setAuth } from '../store.js';

// ================================
// CONFIG (centralised here on purpose)
// ================================

// Backend Web App URL (Google Apps Script)
const API_URL = '__API_URL__';

// Authentication towards backend (legacy pw and/or token)
const AUTH = {
  pw: 'Look4fun',
  token: '__TOKEN__'
};

// External movie data providers
const TOKENS = {
  tmdb: 'e207103e8a03559e4be5970b8c899122',
  omdb: 'b6f3e48',
  watchmode: '6fs0TqcE6LrZttIvVKKJ1Heg97B161Ay1HntH9Vq'
};

// ================================
// Public API (used by other modules)
// ================================

// Used by api.js
export function getApiUrl() {
  return API_URL;
}

// Used by lookup / wishlist / now modules
export function getMovieTokens() {
  return { ...TOKENS };
}

// ================================
// Initialization
// ================================

// Write auth once on load so all modules can read from store
setAuth(AUTH);
