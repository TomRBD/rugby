import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { FournisseurSession } from './lib/session';
import { FournisseurToasts } from './composants/ui';
import { appliquerTheme } from './lib/theme';
import './styles.css';

appliquerTheme();
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js');
}

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <BrowserRouter>
      <FournisseurToasts>
        <FournisseurSession>
          <App />
        </FournisseurSession>
      </FournisseurToasts>
    </BrowserRouter>
  </StrictMode>,
);
