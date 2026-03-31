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
import {
  formatCalendarDate,
  formatDateTimeLabel,
  formatInputValue,
  parseDateValue,
} from '../../utils';

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
  return withTime ? formatDateTimeLabel(iso) : formatCalendarDate(iso);
}

export function DatePickerField({
  label, value, onChange, placeholder, error,
  maximumDate, minimumDate, withTime,
}: DatePickerFieldProps) {
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<'date' | 'time'>('date');
  const [draftDate, setDraftDate] = useState<Date | null>(null);

  const currentDate = draftDate ?? parseDateValue(value) ?? new Date();

  function handleChange(event: DateTimePickerEvent, selected?: Date) {
    if (event.type === 'dismissed') {
      setShow(false);
      setMode('date');
      setDraftDate(null);
      return;
    }

    if (!selected) return;

    if (withTime && mode === 'date' && Platform.OS === 'android') {
      setDraftDate(selected);
      if (Platform.OS === 'android') {
        setMode('time');
        setShow(true);
      }
    } else {
      const nextDate =
        withTime && mode === 'time' && draftDate
          ? new Date(
              draftDate.getFullYear(),
              draftDate.getMonth(),
              draftDate.getDate(),
              selected.getHours(),
              selected.getMinutes(),
              0,
              0
            )
          : selected;

      onChange(formatInputValue(nextDate, withTime));
      setShow(false);
      setDraftDate(null);
      setMode('date');
    }
  }

  function openPicker() {
    setDraftDate(parseDateValue(value));
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
