import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { IS_STANDALONE } from './deployment.js';
import { StandaloneApp } from './standalone/App.js';
import './styles.css';

// The networked build talks to the API; the standalone build reads hand-over
// files. They share the design system and the domain package, not the shell.
const Root = IS_STANDALONE ? StandaloneApp : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
