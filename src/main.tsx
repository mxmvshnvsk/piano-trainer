import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import { App } from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
