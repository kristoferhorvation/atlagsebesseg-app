import '@fontsource-variable/inter';
import { toCssVariables } from '@atlagsebesseg/design-tokens';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './sw/register';
import './styles.css';

// a dizájn-tokenek egyetlen forrásból (a natív app ugyanezt importálja)
const tokens = document.createElement('style');
tokens.textContent = `:root{${toCssVariables()}}`;
document.head.prepend(tokens);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker();
