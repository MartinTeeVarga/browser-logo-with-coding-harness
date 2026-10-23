import { validateLogo } from './runtime.js';
self.onmessage = ({ data }) => {
  try {
    validateLogo(data.source);
    self.postMessage({ valid: true });
  } catch (error) {
    self.postMessage({ valid: false, error: error.message || String(error), code: error.code });
  }
};
