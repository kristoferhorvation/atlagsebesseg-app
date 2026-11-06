import '@fontsource-variable/inter';
import { toCssVariables } from '@atlagsebesseg/design-tokens';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initCaptcha } from './captcha';
import { registerServiceWorker } from './sw/register';
import { trackAppHeight } from './sw/standalone';
import './styles.css';

// a dizájn-tokenek egyetlen forrásból (a natív app ugyanezt importálja)
const tokens = document.createElement('style');
tokens.textContent = `:root{${toCssVariables()}}`;
document.head.prepend(tokens);

trackAppHeight();
initCaptcha();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker(() => document.documentElement.dataset.busy === '1');
