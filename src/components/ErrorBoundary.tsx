import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RotateCcw, Home } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
  actionLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled render error caught by ErrorBoundary:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  handleReload = () => {
    window.location.reload();
  };

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const {
      fallbackTitle = 'Something went wrong',
      fallbackMessage = 'An unexpected render error occurred. You can return to your library or reload.',
      onReset,
      actionLabel,
    } = this.props;

    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center text-[var(--color-text)] bg-[var(--color-bg)]/80 backdrop-blur-md">
        <div className="max-w-md w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/90 p-6 shadow-xl backdrop-blur-lg">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-400">
            <AlertCircle className="h-6 w-6 stroke-[2]" />
          </div>

          <h2 className="text-lg font-semibold tracking-tight text-[var(--color-text)]">
            {fallbackTitle}
          </h2>

          <p className="mt-2 text-sm text-[var(--color-muted)] leading-relaxed">
            {this.state.error?.message || fallbackMessage}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {onReset && (
              <button
                type="button"
                onClick={this.handleReset}
                className="flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 px-4 py-2 text-sm font-medium transition-colors border border-white/10 active:scale-95"
              >
                <Home className="h-4 w-4" />
                {actionLabel || 'Return to Library'}
              </button>
            )}

            <button
              type="button"
              onClick={this.handleReload}
              className="flex items-center gap-2 rounded-xl bg-blue-600/80 hover:bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors active:scale-95 shadow-sm"
            >
              <RotateCcw className="h-4 w-4" />
              Reload View
            </button>
          </div>

          {this.state.error?.stack && (
            <details className="mt-4 text-left">
              <summary className="cursor-pointer text-xs text-[var(--color-muted)] hover:underline">
                View technical details
              </summary>
              <pre className="mt-2 max-h-36 overflow-auto rounded-lg bg-black/40 p-2.5 text-[11px] font-mono text-neutral-400 leading-tight">
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
