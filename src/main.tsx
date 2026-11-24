import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import { App } from './App';
import './style.css';

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && new URLSearchParams(location.search).has('calibrate')) {
  void import('./Calibration').then(({ Calibration }) => root.render(<React.StrictMode><Calibration /></React.StrictMode>));
} else root.render(<React.StrictMode><App /></React.StrictMode>);
