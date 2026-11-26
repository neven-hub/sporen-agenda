import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './huisstijl/sporen-huisstijl.css';
import './stijl.css';
import App from './App';

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
