import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App';
import { getDesktopApiBaseUrl, isDesktopApp } from './lib/desktop';
import { AuthProvider } from './state/auth';
import './styles.css';

declare global {
  interface Window {
    __patrolFrontendLastError?: string;
    __patrolFrontendLastErrorStack?: string;
  }
}

function rememberFrontendError(value: unknown): void {
  const message = value instanceof Error ? value.message : String(value ?? 'Unknown frontend error');
  const stack = value instanceof Error ? value.stack ?? message : message;
  window.__patrolFrontendLastError = message;
  window.__patrolFrontendLastErrorStack = stack;
  console.error('[frontend-error]', stack);
}

window.addEventListener('error', (event) => {
  rememberFrontendError(event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  rememberFrontendError(event.reason);
});

function chooseRouter(): typeof BrowserRouter {
  if (isDesktopApp() || window.location.protocol === 'file:') {
    return HashRouter;
  }

  return BrowserRouter;
}

class FrontendErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    rememberFrontendError(error);
  }

  render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="frontend-diagnostics-shell">
        <div className="frontend-diagnostics-card">
          <p className="eyebrow">Frontend Error</p>
          <h1>Patrol Evidence Platform could not finish loading</h1>
          <p className="muted-text">
            The desktop screen started, but React hit an error before it could render the setup wizard or dashboard.
          </p>
          <div className="frontend-diagnostics-grid">
            <div className="frontend-diagnostics-item">
              <span>Current route</span>
              <strong>{window.location.href}</strong>
            </div>
            <div className="frontend-diagnostics-item">
              <span>API base URL</span>
              <strong>{getDesktopApiBaseUrl() ?? 'Not detected'}</strong>
            </div>
            <div className="frontend-diagnostics-item">
              <span>Desktop bridge detected</span>
              <strong>{isDesktopApp() ? 'Yes' : 'No'}</strong>
            </div>
          </div>
          <div className="frontend-diagnostics-log">
            <strong>Error message</strong>
            <pre>{this.state.error.message}</pre>
          </div>
          <div className="frontend-diagnostics-log">
            <strong>Stack</strong>
            <pre>{this.state.error.stack ?? 'No stack available'}</pre>
          </div>
        </div>
      </div>
    );
  }
}

const Router = chooseRouter();

console.info(
  `[frontend-bootstrap] protocol=${window.location.protocol} href=${window.location.href} router=${
    Router === HashRouter ? 'hash' : 'browser'
  } desktop=${isDesktopApp()} api=${getDesktopApiBaseUrl() ?? 'unknown'}`,
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FrontendErrorBoundary>
      <Router>
        <AuthProvider>
          <App />
        </AuthProvider>
      </Router>
    </FrontendErrorBoundary>
  </React.StrictMode>,
);
