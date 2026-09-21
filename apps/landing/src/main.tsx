import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

import '@factory-vision/ui/fv/fonts.css';
import '@factory-vision/ui/tokens.css';
import '@factory-vision/ui/fv/palette.css';
import '@factory-vision/ui/fv/table-header.css';
import '@factory-vision/ui/fv/mirror-fixes.css';
import './landing.css';
import { bootstrapSiteConfig } from './site-config';

// Analytics and Search Console verification are configured from the internal
// console, not baked into the bundle.
void bootstrapSiteConfig();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
