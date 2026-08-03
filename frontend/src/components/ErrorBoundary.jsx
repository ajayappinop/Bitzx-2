import { Component } from "react";

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("IBO render error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-surface text-ink flex items-center justify-center p-8">
          <div className="max-w-lg rounded-2xl border border-red-500/40 bg-surface-card p-8">
            <h1 className="text-xl font-bold text-red-400 mb-3">Page failed to load</h1>
            <p className="text-ink-muted text-sm mb-4">
              The site hit a JavaScript error. Try a hard refresh (Ctrl+F5). If this
              continues, contact support with the message below.
            </p>
            <pre className="text-xs text-ink-accent whitespace-pre-wrap break-words bg-surface p-4 rounded-lg border border-line">
              {this.state.error?.message || String(this.state.error)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
