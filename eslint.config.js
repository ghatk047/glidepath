// Shared lint config lives in tools/eslint-config (FND-02). Packages pick this file up
// automatically (ESLint searches upward), so they need no config of their own.
import config from './tools/eslint-config/src/index.js';

export default config;
