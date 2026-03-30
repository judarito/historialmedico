// ============================================================
// VoiceRecordButton
// Graba voz usando reconocimiento de voz nativo del dispositivo
// (expo-speech-recognition). No requiere API externa para STT.
//
// Props:
//   onTranscription(text) — llamado con el texto transcrito
//   size     — diámetro del botón (default 56)
//   style    — estilos adicionales del contenedor
//   disabled — deshabilita el botón
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Audio } from 'expo-av';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../theme';

export interface VoiceCapturePayload {
  transcription: string;
  audioUri: string | null;
}

interface Props {
  onTranscription?: (text: string) => void;
  onCapture?: (payload: VoiceCapturePayload) => void;
  size?:    number;
  style?:   ViewStyle;
  disabled?: boolean;
}

type State = 'idle' | 'recording' | 'processing';

export function VoiceRecordButton({ onTranscription, onCapture, size = 56, style, disabled }: Props) {
  const [recState, setRecState] = useState<State>('idle');
  const [seconds,  setSeconds]  = useState(0);
  const pendingText = useRef('');
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const recordingRef = useRef<Audio.Recording | null>(null);
  const audioUriRef  = useRef<string | null>(null);

  // ── Pulse while recording ────────────────────────────────────
  useEffect(() => {
    if (recState === 'recording') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.18, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [recState]);

  // ── Seconds counter ──────────────────────────────────────────
  useEffect(() => {
    if (recState === 'recording') {
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recState]);

  // ── Speech recognition events ────────────────────────────────
  useSpeechRecognitionEvent('result', (event) => {
    // Accumulate interim + final results
    const transcript = event.results?.[0]?.transcript ?? '';
    if (transcript) pendingText.current = transcript;
  });

  useSpeechRecognitionEvent('end', () => {
    void (async () => {
      const activeRecording = recordingRef.current;
      if (activeRecording) {
        try {
          await activeRecording.stopAndUnloadAsync();
          audioUriRef.current = activeRecording.getURI() ?? audioUriRef.current;
        } catch {
          // noop
        } finally {
          recordingRef.current = null;
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
          }).catch(() => {});
        }
      }

      const text = pendingText.current.trim();
      const audioUri = audioUriRef.current;
      pendingText.current = '';
      setRecState('idle');
      setSeconds(0);
      if (onCapture) {
        onCapture({ transcription: text, audioUri });
      }
      if (text && onTranscription) {
        onTranscription(text);
      }
    })();
  });

  useSpeechRecognitionEvent('error', (event) => {
    console.warn('VoiceRecordButton error:', event.error, event.message);
    pendingText.current = '';
    audioUriRef.current = null;
    const activeRecording = recordingRef.current;
    if (activeRecording) {
      activeRecording.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    }).catch(() => {});
    setRecState('idle');
    setSeconds(0);
  });

  useEffect(() => {
    return () => {
      const activeRecording = recordingRef.current;
      if (activeRecording) {
        activeRecording.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  // ── Start ────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const speechPermission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      const audioPermission = await Audio.requestPermissionsAsync();
      if (!speechPermission.granted || !audioPermission.granted) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();

      pendingText.current = '';
      audioUriRef.current = null;
      recordingRef.current = recording;
      ExpoSpeechRecognitionModule.start({
        lang:           'es-CO',
        interimResults: true,
        continuous:     false,
        maxAlternatives: 1,
      });
      setRecState('recording');
    } catch (err) {
      console.error('VoiceRecordButton start:', err);
    }
  }, []);

  // ── Stop ─────────────────────────────────────────────────────
  const stopRecording = useCallback(async () => {
    setRecState('processing');

    try {
      const activeRecording = recordingRef.current;
      if (activeRecording) {
        await activeRecording.stopAndUnloadAsync();
        audioUriRef.current = activeRecording.getURI() ?? null;
        recordingRef.current = null;
      }
    } catch (err) {
      console.warn('VoiceRecordButton stop audio:', err);
      audioUriRef.current = null;
    } finally {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => {});
      ExpoSpeechRecognitionModule.stop();
    }

    // 'end' event fires → handler above delivers the text
  }, []);

  // ── Toggle ───────────────────────────────────────────────────
  function handlePress() {
    if (disabled || recState === 'processing') return;
    if (recState === 'idle') void startRecording();
    else if (recState === 'recording') void stopRecording();
  }

  // ── Render ───────────────────────────────────────────────────
  const isRecording = recState === 'recording';
  const btnBg       = isRecording ? Colors.alert : Colors.primary;
  const iconName: any = isRecording ? 'stop' : 'mic';

  function formatTime(s: number): string {
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  return (
    <View style={[styles.wrapper, style]}>
      {isRecording && (
        <Text style={styles.timer}>{formatTime(seconds)}</Text>
      )}
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <TouchableOpacity
          style={[
            styles.btn,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: btnBg },
            disabled && styles.btnDisabled,
          ]}
          onPress={handlePress}
          activeOpacity={0.8}
          disabled={disabled}
        >
          <Ionicons name={iconName} size={size * 0.42} color="#fff" />
        </TouchableOpacity>
      </Animated.View>
      <Text style={styles.hint}>{isRecording ? 'Toca para detener' : 'Voz'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:     { alignItems: 'center', gap: 4 },
  btn:         { alignItems: 'center', justifyContent: 'center', elevation: 2, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  btnDisabled: { opacity: 0.5 },
  timer:       { color: Colors.alert, fontSize: Typography.xs, fontWeight: '700', letterSpacing: 1 },
  hint:        { color: Colors.textMuted, fontSize: 10 },
});
