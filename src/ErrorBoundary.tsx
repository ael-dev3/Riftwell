import { Component, type ErrorInfo, type ReactNode } from 'react';

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Riftwell interface error', error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page-main">
        <section className="empty-state" role="alert">
          <h1>Something didn’t load.</h1>
          <p>
            Refresh to return to Riftwell. Your saved preview stays in this
            browser.
          </p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Refresh Riftwell
          </button>
        </section>
      </main>
    );
  }
}
