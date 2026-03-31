import type { Database } from '../types/database.types';
import { toStoredIso } from './date';

type MedicalVisitUpdate = Database['public']['Tables']['medical_visits']['Update'];

export interface ExtractedVisitVitalsInput {
  weight_kg?: number | string | null;
  height_cm?: number | string | null;
  temperature_c?: number | string | null;
  blood_pressure?: string | null;
  heart_rate?: number | string | null;
}

export interface ExtractedVisitDataInput {
  visit_date?: string | null;
  doctor_name?: string | null;
  specialty?: string | null;
  institution_name?: string | null;
  reason_for_visit?: string | null;
  diagnosis?: string | null;
  notes?: string | null;
  general_instructions?: string | null;
  vitals?: ExtractedVisitVitalsInput | null;
}

export interface NormalizedExtractedVisitVitals {
  weight_kg: number | null;
  height_cm: number | null;
  temperature_c: number | null;
  blood_pressure: string | null;
  heart_rate: number | null;
}

export interface NormalizedExtractedVisitData {
  visit_date: string | null;
  doctor_name: string | null;
  specialty: string | null;
  institution_name: string | null;
  reason_for_visit: string | null;
  diagnosis: string | null;
  notes: string | null;
  vitals: NormalizedExtractedVisitVitals;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(',', '.');
  if (!cleaned) return null;

  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function mergeNotes(values: Array<string | null>): string | null {
  const unique = values.filter(Boolean).filter((value, index, array) => array.indexOf(value) === index) as string[];
  return unique.length > 0 ? unique.join('\n\n') : null;
}

export function normalizeExtractedVisitData(
  input?: ExtractedVisitDataInput | null
): NormalizedExtractedVisitData {
  const vitals = input?.vitals ?? null;

  return {
    visit_date: normalizeText(input?.visit_date),
    doctor_name: normalizeText(input?.doctor_name),
    specialty: normalizeText(input?.specialty),
    institution_name: normalizeText(input?.institution_name),
    reason_for_visit: normalizeText(input?.reason_for_visit),
    diagnosis: normalizeText(input?.diagnosis),
    notes: mergeNotes([
      normalizeText(input?.notes),
      normalizeText(input?.general_instructions),
    ]),
    vitals: {
      weight_kg: normalizeNumber(vitals?.weight_kg),
      height_cm: normalizeNumber(vitals?.height_cm),
      temperature_c: normalizeNumber(vitals?.temperature_c),
      blood_pressure: normalizeText(vitals?.blood_pressure),
      heart_rate: normalizeNumber(vitals?.heart_rate),
    },
  };
}

export function hasMeaningfulVisitData(input?: ExtractedVisitDataInput | NormalizedExtractedVisitData | null): boolean {
  const data = normalizeExtractedVisitData(input as ExtractedVisitDataInput | null | undefined);

  return Boolean(
    data.visit_date ||
    data.doctor_name ||
    data.specialty ||
    data.institution_name ||
    data.reason_for_visit ||
    data.diagnosis ||
    data.notes ||
    data.vitals.weight_kg != null ||
    data.vitals.height_cm != null ||
    data.vitals.temperature_c != null ||
    data.vitals.blood_pressure ||
    data.vitals.heart_rate != null
  );
}

function shouldUseDateTime(rawDate: string | null): boolean {
  return Boolean(rawDate && /T\d{2}:\d{2}/.test(rawDate));
}

export function buildMedicalVisitUpdate(
  input?: ExtractedVisitDataInput | NormalizedExtractedVisitData | null,
  options: { includeVisitDate?: boolean } = {}
): MedicalVisitUpdate {
  const data = normalizeExtractedVisitData(input as ExtractedVisitDataInput | null | undefined);
  const update: MedicalVisitUpdate = {};

  if (options.includeVisitDate && data.visit_date) {
    const visitDateIso = toStoredIso(data.visit_date, shouldUseDateTime(data.visit_date));
    if (visitDateIso) update.visit_date = visitDateIso;
  }

  if (data.doctor_name) update.doctor_name = data.doctor_name;
  if (data.specialty) update.specialty = data.specialty;
  if (data.institution_name) update.institution_name = data.institution_name;
  if (data.reason_for_visit) update.reason_for_visit = data.reason_for_visit;
  if (data.diagnosis) update.diagnosis = data.diagnosis;
  if (data.notes) update.notes = data.notes;
  if (data.vitals.weight_kg != null) update.weight_kg = data.vitals.weight_kg;
  if (data.vitals.height_cm != null) update.height_cm = data.vitals.height_cm;
  if (data.vitals.temperature_c != null) update.temperature_c = data.vitals.temperature_c;
  if (data.vitals.blood_pressure) update.blood_pressure = data.vitals.blood_pressure;
  if (data.vitals.heart_rate != null) update.heart_rate = data.vitals.heart_rate;

  return update;
}

export function getVisitReviewItems(data?: ExtractedVisitDataInput | NormalizedExtractedVisitData | null): Array<{ label: string; value: string }> {
  const normalized = normalizeExtractedVisitData(data as ExtractedVisitDataInput | null | undefined);
  return [
    normalized.doctor_name && { label: 'Médico', value: normalized.doctor_name },
    normalized.specialty && { label: 'Especialidad', value: normalized.specialty },
    normalized.institution_name && { label: 'Institución', value: normalized.institution_name },
    normalized.reason_for_visit && { label: 'Motivo', value: normalized.reason_for_visit },
    normalized.diagnosis && { label: 'Diagnóstico', value: normalized.diagnosis },
    normalized.notes && { label: 'Observaciones', value: normalized.notes },
  ].filter(Boolean) as Array<{ label: string; value: string }>;
}

export function getVitalsReviewItems(data?: ExtractedVisitDataInput | NormalizedExtractedVisitData | null): Array<{ label: string; value: string }> {
  const normalized = normalizeExtractedVisitData(data as ExtractedVisitDataInput | null | undefined);
  return [
    normalized.vitals.weight_kg != null && { label: 'Peso', value: `${normalized.vitals.weight_kg} kg` },
    normalized.vitals.height_cm != null && { label: 'Talla', value: `${normalized.vitals.height_cm} cm` },
    normalized.vitals.temperature_c != null && { label: 'Temperatura', value: `${normalized.vitals.temperature_c} °C` },
    normalized.vitals.blood_pressure && { label: 'Presión', value: normalized.vitals.blood_pressure },
    normalized.vitals.heart_rate != null && { label: 'Frecuencia', value: `${normalized.vitals.heart_rate} lpm` },
  ].filter(Boolean) as Array<{ label: string; value: string }>;
}
