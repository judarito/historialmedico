import React from 'react';
import { RuntimeDiagnosticsScreen } from './RuntimeDiagnosticsScreen';
import {
  captureException,
  getDiagnosticsReport,
  normalizeError,
  type RuntimeDiagnosticsReport,
} from '../services/runtimeDiagnostics';

interface State {
  hasError: boolean;
  error:    string;
  stack:    string;
  report:   RuntimeDiagnosticsReport | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: '', stack: '', report: null };

  static getDerivedStateFromError(error: unknown): State {
    const normalized = normalizeError(error);
    return {
      hasError: true,
      error: normalized.message,
      stack: normalized.stack,
      report: null,
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught:', error);
    console.error('[ErrorBoundary] componentStack:', info.componentStack);
    void captureException('ErrorBoundary.componentDidCatch', error, {
      markBootFailed: true,
      extra: { componentStack: info.componentStack },
    }).then(async () => {
      const report = await getDiagnosticsReport();
      this.setState({ report });
    });
  }

  reset = () => this.setState({ hasError: false, error: '', stack: '', report: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    const fallbackReport: RuntimeDiagnosticsReport = {
      boot: null,
      entries: [
        {
          id: 'error_boundary_fallback',
          at: new Date().toISOString(),
          severity: 'error',
          source: 'ErrorBoundary',
          message: this.state.error,
          stack: this.state.stack,
        },
      ],
    };

    return (
      <RuntimeDiagnosticsScreen
        title="Error de la aplicacion"
        subtitle="La app capturo una excepcion de React. Comparte este reporte para revisar la causa."
        report={this.state.report ?? fallbackReport}
        primaryLabel="Reintentar"
        onPrimaryPress={this.reset}
      />
    );
  }
}
