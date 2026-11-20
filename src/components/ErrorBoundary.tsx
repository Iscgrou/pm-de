import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unexpected rendering error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#111827] border border-red-500/30 rounded-lg p-6 space-y-4">
            <h1 className="text-lg font-display font-semibold text-red-400">
              Emergency UI Recovery Boundary
            </h1>
            <p className="text-sm text-slate-300">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-[#D4A853] text-slate-950 hover:bg-[#e1b968] transition-colors"
            >
              Reload Command Deck
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
