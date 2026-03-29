import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../../theme';

interface DatePickerFieldProps {
  label: string;
  value: string;           // ISO date string YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  error?: string;
  maximumDate?: Date;
  minimumDate?: Date;
  withTime?: boolean;      // include time picker (for visit_date)
}

function toDisplayDate(iso: string, withTime?: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  if (withTime) {
    return d.toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isoFromDate(d: Date, withTime?: boolean): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!withTime) return date;
  return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DatePickerField({
  label, value, onChange, placeholder, error,
  maximumDate, minimumDate, withTime,
}: DatePickerFieldProps) {
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<'date' | 'time'>('date');

  const currentDate = value ? new Date(value) : new Date();

  function handleChange(_event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShow(false);
    if (!selected) return;

    if (withTime && mode === 'date') {
      // On Android, after picking the date, open the time picker
      onChange(isoFromDate(selected, withTime));
      if (Platform.OS === 'android') {
        setMode('time');
        setShow(true);
      }
    } else {
      onChange(isoFromDate(selected, withTime));
      if (Platform.OS === 'ios') setShow(false);
      setMode('date');
    }
  }

  function openPicker() {
    setMode('date');
    setShow(true);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.button, error ? styles.buttonError : null]}
        onPress={openPicker}
        activeOpacity={0.7}
      >
        <Ionicons
          name="calendar-outline"
          size={18}
          color={Colors.textSecondary}
          style={styles.icon}
        />
        <Text style={[styles.value, !value && styles.placeholder]}>
          {value ? toDisplayDate(value, withTime) : (placeholder ?? 'Selecciona una fecha')}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
      {!!error && <Text style={styles.error}>{error}</Text>}

      {show && (
        <DateTimePicker
          value={currentDate}
          mode={mode}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleChange}
          maximumDate={maximumDate}
          minimumDate={minimumDate}
          locale="es-CO"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 52,
  },
  buttonError: { borderColor: Colors.alert },
  icon: { marginRight: Spacing.sm },
  value: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.base,
  },
  placeholder: { color: Colors.textMuted },
  error: {
    color: Colors.alert,
    fontSize: Typography.xs,
    marginTop: 2,
  },
});
