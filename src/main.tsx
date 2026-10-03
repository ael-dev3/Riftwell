import React from 'react';
import ReactDOM from 'react-dom/client';
// Resolved at build time to the preview or connected application, so each
// bundle contains only the mode it serves.
import Root from '@app-root';
import ErrorBoundary from './ErrorBoundary';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
