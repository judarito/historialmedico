import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Clipboard,
} from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../theme';

interface State {
  hasError: boolean;
  error:    string;
  stack:    string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: '', stack: '' };

  static getDerivedStateFromError(error: unknown): State {
    const e = error instanceof Error ? error : new Error(String(error));
    return { hasError: true, error: e.message, stack: e.stack ?? '' };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught:', error);
    console.error('[ErrorBoundary] componentStack:', info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: '', stack: '' });

  copy = () => {
    const text = `ERROR: ${this.state.error}\n\nSTACK:\n${this.state.stack}`;
    Clipboard.setString(text);
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Error de la aplicación</Text>
        <Text style={styles.subtitle}>Copia este mensaje y compártelo para diagnóstico:</Text>

        <ScrollView style={styles.box} contentContainerStyle={styles.boxContent}>
          <Text style={styles.errorMsg}>{this.state.error}</Text>
          {!!this.state.stack && (
            <Text style={styles.stack}>{this.state.stack}</Text>
          )}
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnCopy} onPress={this.copy}>
            <Text style={styles.btnCopyText}>Copiar error</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnRetry} onPress={this.reset}>
            <Text style={styles.btnRetryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.xl,
    paddingTop: 60,
  },
  title: {
    color: '#E85D4A',
    fontSize: Typography.lg,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    marginBottom: Spacing.md,
  },
  box: {
    flex: 1,
    backgroundColor: '#1A0A0A',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#E85D4A44',
    marginBottom: Spacing.lg,
  },
  boxContent: {
    padding: Spacing.md,
  },
  errorMsg: {
    color: '#E85D4A',
    fontSize: Typography.sm,
    fontWeight: '600',
    marginBottom: Spacing.md,
    fontFamily: 'monospace',
  },
  stack: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  btnCopy: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnCopyText: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: '600',
  },
  btnRetry: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  btnRetryText: {
    color: '#fff',
    fontSize: Typography.sm,
    fontWeight: '600',
  },
});
