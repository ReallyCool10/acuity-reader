import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

// Stylesheet entry point. Without this import Vite emits no CSS bundle at all,
// and every utility class in the app silently does nothing.
import './App.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Acuity Reader encountered an error">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
