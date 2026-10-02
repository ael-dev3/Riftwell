import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ConnectedApp from './connected/ConnectedApp';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {import.meta.env.VITE_APP_MODE === 'connected' ? (
        <ConnectedApp />
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
