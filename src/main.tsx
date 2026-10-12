import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

// The reader's serif, bundled rather than fetched from Google Fonts: a stylesheet
// from the web in <head> held up the first paint on a slow network, the reader
// fell back to Georgia offline, and every launch sent a request to Google.
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';

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
