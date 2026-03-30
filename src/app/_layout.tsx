import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, ErrorUtils } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { NotificationService } from '../services/notifications';
import { RuntimeDiagnosticsScreen } from '../components/RuntimeDiagnosticsScreen';
import { Colors } from '../theme';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  beginBootSession,
  captureException,
  clearDiagnostics,
  getBootSnapshot,
  getDiagnosticsReport,
  getLatestErrorEntry,
  markBootReady,
  markBootStep,
  subscribeToRuntimeErrors,
  type RuntimeDiagnosticsReport,
} from '../services/runtimeDiagnostics';
import { supabaseInitError } from '../services/supabase';

// Captura errores JS no capturados (p.ej. promesas sin catch en release)
if (ErrorUtils) {
  const prev = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error(`[GlobalError] isFatal=${isFatal}`, error);
    void captureException('GlobalErrorHandler', error, { isFatal, markBootFailed: true });
    if (__DEV__) {
      prev?.(error, isFatal);
    }
  });
}

const globalScope = globalThis as typeof globalThis & {
  __runtimeUnhandledRejectionHandlerInstalled__?: boolean;
  onunhandledrejection?: ((event: unknown) => void) | null;
};

if (!globalScope.__runtimeUnhandledRejectionHandlerInstalled__) {
  const prevUnhandledRejection = globalScope.onunhandledrejection;
  globalScope.onunhandledrejection = (event) => {
    const reason = (event as { reason?: unknown } | undefined)?.reason ?? event;
    void captureException('UnhandledPromiseRejection', reason, {
      markBootFailed: true,
      extra: { event: 'onunhandledrejection' },
    });
    prevUnhandledRejection?.(event);
  };
  globalScope.__runtimeUnhandledRejectionHandlerInstalled__ = true;
}

export default function RootLayout() {
  const { init, initialized, session } = useAuthStore();
  const bootRunId = useRef(0);
  const [report, setReport] = useState<RuntimeDiagnosticsReport | null>(null);
  const [showBlockingDiagnostics, setShowBlockingDiagnostics] = useState(false);
  const [showPreviousDiagnostics, setShowPreviousDiagnostics] = useState(false);

  async function refreshDiagnostics() {
    const nextReport = await getDiagnosticsReport();
    setReport(nextReport);
    return nextReport;
  }

  async function runBootSequence() {
    const runId = ++bootRunId.current;
    setShowBlockingDiagnostics(false);

    try {
      const previousBoot = await getBootSnapshot();
      if (runId !== bootRunId.current) return;

      if (previousBoot && previousBoot.status !== 'ready') {
        const previousReport = await getDiagnosticsReport();
        const previousError = getLatestErrorEntry(previousReport);
        if (runId !== bootRunId.current) return;
        if (previousError) {
          setReport(previousReport);
          setShowPreviousDiagnostics(true);
        } else {
          setShowPreviousDiagnostics(false);
        }
      } else {
        setShowPreviousDiagnostics(false);
      }

      await beginBootSession('RootLayout:mount');
      await markBootStep('RootLayout:boot:start');

      if (supabaseInitError) {
        throw supabaseInitError;
      }

      await markBootStep('RootLayout:auth:init:start');
      await init();
      await markBootStep('RootLayout:auth:init:done');
    } catch (error) {
      await captureException('RootLayout.runBootSequence', error, { markBootFailed: true });
      if (runId !== bootRunId.current) return;
      await refreshDiagnostics();
      setShowBlockingDiagnostics(true);
    }
  }

  useEffect(() => {
    void runBootSequence();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRuntimeErrors(() => {
      void refreshDiagnostics().then(() => {
        setShowBlockingDiagnostics(true);
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!initialized) return;
    void markBootStep(session ? 'RootLayout:initialized:session' : 'RootLayout:initialized:guest');
    if (!showBlockingDiagnostics) {
      void markBootReady(session ? 'RootLayout:ready:session' : 'RootLayout:ready:guest');
    }
  }, [initialized, session?.user?.id, showBlockingDiagnostics]);

  useEffect(() => {
    if (session) {
      void (async () => {
        try {
          await markBootStep('RootLayout:notifications:start');
          await NotificationService.registerForPushNotifications();
          await markBootStep('RootLayout:notifications:done');
        } catch (error) {
          await captureException('RootLayout.notifications', error);
          await refreshDiagnostics();
        }
      })();
    }
  }, [session?.user?.id]);

  const blockingError = getLatestErrorEntry(report);
  const previousError = getLatestErrorEntry(report);

  if (report && showBlockingDiagnostics && blockingError) {
    return (
      <RuntimeDiagnosticsScreen
        title="Error de arranque"
        subtitle="La app detecto un fallo en tiempo de ejecucion. Comparte este reporte para revisar la causa exacta."
        report={report}
        primaryLabel="Reintentar arranque"
        onPrimaryPress={() => {
          void clearDiagnostics();
          setReport(null);
          setShowBlockingDiagnostics(false);
          setShowPreviousDiagnostics(false);
          void runBootSequence();
        }}
        secondaryLabel={initialized ? 'Ocultar reporte' : undefined}
        onSecondaryPress={initialized ? () => setShowBlockingDiagnostics(false) : undefined}
      />
    );
  }

  if (report && showPreviousDiagnostics && previousError) {
    return (
      <RuntimeDiagnosticsScreen
        title="Se detecto un fallo previo"
        subtitle="La ultima sesion no termino bien. Este reporte ayuda a saber en que paso se cayo la app."
        report={report}
        primaryLabel="Continuar"
        onPrimaryPress={() => setShowPreviousDiagnostics(false)}
        secondaryLabel="Limpiar diagnostico"
        onSecondaryPress={() => {
          void clearDiagnostics();
          setReport(null);
          setShowPreviousDiagnostics(false);
        }}
      />
    );
  }

  if (!initialized) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
          <StatusBar style="light" backgroundColor={Colors.background} />
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={Colors.background} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(app)" />
        </Stack>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
