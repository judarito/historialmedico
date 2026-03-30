import { supabase } from './supabase';

const MAX_FALLBACK_ROWS = 300;

export interface GlobalSearchFallbackResult {
  result_type: string;
  filter_category: string;
  result_id: string;
  member_id: string;
  member_name: string;
  title: string;
  subtitle: string;
  date_ref: string | null;
  navigation_id?: string | null;
}

export interface HistoryLocalSearchResult {
  result_type: string;
  result_id: string;
  title: string;
  subtitle: string;
  date_ref: string | null;
}

interface FamilyMemberSearchRow {
  id: string;
  first_name: string;
  last_name: string | null;
  eps_name: string | null;
  relationship: string | null;
  created_at: string;
}

interface MedicalVisitSearchRow {
  id: string;
  family_member_id: string;
  visit_date: string | null;
  diagnosis: string | null;
  reason_for_visit: string | null;
  doctor_name: string | null;
  specialty: string | null;
  institution_name: string | null;
  notes: string | null;
  voice_note_text: string | null;
}

interface PrescriptionSearchRow {
  id: string;
  family_member_id: string;
  medical_visit_id: string | null;
  medication_name: string;
  presentation: string | null;
  dose_amount: number | string | null;
  dose_unit: string | null;
  frequency_text: string | null;
  instructions: string | null;
  start_at: string | null;
}

interface MedicalTestSearchRow {
  id: string;
  family_member_id: string;
  medical_visit_id: string | null;
  test_name: string;
  category: string | null;
  notes: string | null;
  ordered_at: string | null;
}

interface MedicalDocumentSearchRow {
  id: string;
  family_member_id: string;
  medical_visit_id: string | null;
  document_type: string;
  title: string | null;
  extracted_text: string | null;
  captured_at: string | null;
  created_at: string;
}

interface HistorySearchVisit {
  id: string;
  visit_date: string | null;
  diagnosis: string | null;
  reason_for_visit: string | null;
  doctor_name: string | null;
  specialty: string | null;
  institution_name: string | null;
  notes: string | null;
}

interface HistorySearchPrescription {
  id: string;
  medical_visit_id?: string | null;
  medication_name: string;
  presentation?: string | null;
  frequency_text?: string | null;
  instructions?: string | null;
  dose_amount?: number | string | null;
  dose_unit?: string | null;
  start_at: string | null;
}

interface HistorySearchTest {
  id: string;
  medical_visit_id?: string | null;
  test_name: string;
  category?: string | null;
  notes?: string | null;
  ordered_at: string | null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesQuery(query: string, values: Array<string | null | undefined>): boolean {
  return values.some((value) => normalizeText(value).includes(query));
}

function byDateDesc<T extends { date_ref: string | null }>(a: T, b: T): number {
  const left = b.date_ref ? new Date(b.date_ref).getTime() : 0;
  const right = a.date_ref ? new Date(a.date_ref).getTime() : 0;
  return left - right;
}

function dedupeResults<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function memberName(member?: FamilyMemberSearchRow): string {
  if (!member) return 'Miembro';
  return [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || 'Miembro';
}

function documentLabel(documentType: string | null | undefined): string {
  if (!documentType) return 'Documento';
  return documentType.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function prescriptionSubtitle(row: {
  dose_amount?: number | string | null;
  dose_unit?: string | null;
  frequency_text?: string | null;
  presentation?: string | null;
}): string {
  const dose =
    row.dose_amount != null
      ? `${row.dose_amount}${row.dose_unit ? ` ${row.dose_unit}` : ''}`.trim()
      : '';
  return [dose, row.frequency_text, row.presentation].filter(Boolean).join(' · ');
}

export async function searchGlobalFallback(query: string, limit = 40): Promise<GlobalSearchFallbackResult[]> {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const [membersRes, visitsRes, prescriptionsRes, testsRes, documentsRes] = await Promise.all([
    supabase
      .from('family_members')
      .select('id, first_name, last_name, eps_name, relationship, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(MAX_FALLBACK_ROWS),
    supabase
      .from('medical_visits')
      .select('id, family_member_id, visit_date, diagnosis, reason_for_visit, doctor_name, specialty, institution_name, notes, voice_note_text')
      .is('deleted_at', null)
      .order('visit_date', { ascending: false })
      .limit(MAX_FALLBACK_ROWS),
    supabase
      .from('prescriptions')
      .select('id, family_member_id, medical_visit_id, medication_name, presentation, dose_amount, dose_unit, frequency_text, instructions, start_at')
      .order('created_at', { ascending: false })
      .limit(MAX_FALLBACK_ROWS),
    supabase
      .from('medical_tests')
      .select('id, family_member_id, medical_visit_id, test_name, category, notes, ordered_at')
      .order('created_at', { ascending: false })
      .limit(MAX_FALLBACK_ROWS),
    supabase
      .from('medical_documents')
      .select('id, family_member_id, medical_visit_id, document_type, title, extracted_text, captured_at, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_FALLBACK_ROWS),
  ]);

  if (membersRes.error) throw membersRes.error;
  if (visitsRes.error) throw visitsRes.error;
  if (prescriptionsRes.error) throw prescriptionsRes.error;
  if (testsRes.error) throw testsRes.error;
  if (documentsRes.error) throw documentsRes.error;

  const members = (membersRes.data as FamilyMemberSearchRow[] | null) ?? [];
  const visits = (visitsRes.data as MedicalVisitSearchRow[] | null) ?? [];
  const prescriptions = (prescriptionsRes.data as PrescriptionSearchRow[] | null) ?? [];
  const tests = (testsRes.data as MedicalTestSearchRow[] | null) ?? [];
  const documents = (documentsRes.data as MedicalDocumentSearchRow[] | null) ?? [];

  const membersById = new Map(members.map((member) => [member.id, member]));
  const docVisitIds = [...new Set(documents.map((document) => document.medical_visit_id).filter(Boolean))] as string[];
  const activeDocVisitIds = new Set<string>();

  if (docVisitIds.length > 0) {
    const { data: activeVisits } = await supabase
      .from('medical_visits')
      .select('id')
      .in('id', docVisitIds)
      .is('deleted_at', null);

    for (const visit of activeVisits ?? []) {
      if (visit.id) activeDocVisitIds.add(visit.id);
    }
  }

  const results: GlobalSearchFallbackResult[] = [];

  for (const member of members) {
    if (!matchesQuery(normalizedQuery, [member.first_name, member.last_name, member.eps_name, member.relationship])) continue;

    const title = memberName(member);
    results.push({
      result_type: 'member',
      filter_category: 'member',
      result_id: member.id,
      member_id: member.id,
      member_name: title,
      title,
      subtitle: member.eps_name ?? member.relationship ?? '',
      date_ref: member.created_at,
    });
  }

  for (const visit of visits) {
    const diagnosisMatch = matchesQuery(normalizedQuery, [
      visit.diagnosis,
      visit.reason_for_visit,
      visit.institution_name,
      visit.notes,
      visit.voice_note_text,
    ]);
    const doctorMatch = matchesQuery(normalizedQuery, [visit.doctor_name]);
    const specialtyMatch = matchesQuery(normalizedQuery, [visit.specialty]);

    if (!diagnosisMatch && !doctorMatch && !specialtyMatch) continue;

    const member = membersById.get(visit.family_member_id);
    const title = doctorMatch
      ? (visit.doctor_name ?? visit.diagnosis ?? visit.reason_for_visit ?? 'Consulta')
      : specialtyMatch
        ? (visit.specialty ?? visit.diagnosis ?? visit.reason_for_visit ?? 'Consulta')
        : (visit.diagnosis ?? visit.reason_for_visit ?? 'Consulta');
    const subtitle = doctorMatch
      ? (visit.institution_name ?? visit.specialty ?? '')
      : specialtyMatch
        ? (visit.doctor_name ?? visit.institution_name ?? '')
        : (visit.doctor_name ?? visit.institution_name ?? '');

    results.push({
      result_type: 'visit',
      filter_category: doctorMatch ? 'doctor' : specialtyMatch ? 'specialist' : 'diagnosis',
      result_id: visit.id,
      member_id: visit.family_member_id,
      member_name: memberName(member),
      title,
      subtitle,
      date_ref: visit.visit_date,
      navigation_id: visit.id,
    });
  }

  for (const prescription of prescriptions) {
    if (!matchesQuery(normalizedQuery, [
      prescription.medication_name,
      prescription.presentation,
      prescription.frequency_text,
      prescription.instructions,
      prescription.dose_unit,
    ])) continue;

    const member = membersById.get(prescription.family_member_id);
    results.push({
      result_type: 'medication',
      filter_category: 'medication',
      result_id: prescription.id,
      member_id: prescription.family_member_id,
      member_name: memberName(member),
      title: prescription.medication_name,
      subtitle: prescriptionSubtitle(prescription),
      date_ref: prescription.start_at,
    });
  }

  for (const test of tests) {
    if (!matchesQuery(normalizedQuery, [test.test_name, test.category, test.notes])) continue;

    const member = membersById.get(test.family_member_id);
    results.push({
      result_type: 'test',
      filter_category: 'test',
      result_id: test.id,
      member_id: test.family_member_id,
      member_name: memberName(member),
      title: test.test_name,
      subtitle: test.category ?? '',
      date_ref: test.ordered_at,
    });
  }

  for (const document of documents) {
    if (document.medical_visit_id && !activeDocVisitIds.has(document.medical_visit_id)) continue;
    if (!matchesQuery(normalizedQuery, [document.title, document.extracted_text, document.document_type])) continue;

    const member = membersById.get(document.family_member_id);
    results.push({
      result_type: 'document',
      filter_category: 'document',
      result_id: document.id,
      member_id: document.family_member_id,
      member_name: memberName(member),
      title: document.title ?? documentLabel(document.document_type),
      subtitle: documentLabel(document.document_type),
      date_ref: document.captured_at ?? document.created_at,
      navigation_id: document.medical_visit_id,
    });
  }

  return dedupeResults(results, (item) => `${item.result_type}:${item.result_id}`)
    .sort(byDateDesc)
    .slice(0, limit);
}

export function searchMemberHistoryLocal(params: {
  query: string;
  visits: HistorySearchVisit[];
  prescriptions: HistorySearchPrescription[];
  tests: HistorySearchTest[];
}): HistoryLocalSearchResult[] {
  const normalizedQuery = normalizeText(params.query);
  if (!normalizedQuery) return [];

  const visitById = new Map(params.visits.map((visit) => [visit.id, visit]));
  const results: HistoryLocalSearchResult[] = [];

  for (const visit of params.visits) {
    if (!matchesQuery(normalizedQuery, [
      visit.diagnosis,
      visit.reason_for_visit,
      visit.doctor_name,
      visit.specialty,
      visit.institution_name,
      visit.notes,
    ])) continue;

    results.push({
      result_type: 'visit',
      result_id: visit.id,
      title: visit.diagnosis ?? visit.reason_for_visit ?? '(sin diagnostico)',
      subtitle: visit.doctor_name ?? visit.institution_name ?? '',
      date_ref: visit.visit_date,
    });
  }

  for (const prescription of params.prescriptions) {
    if (!matchesQuery(normalizedQuery, [
      prescription.medication_name,
      prescription.presentation,
      prescription.frequency_text,
      prescription.instructions,
      prescription.dose_unit,
    ])) continue;

    const linkedVisit = prescription.medical_visit_id
      ? visitById.get(prescription.medical_visit_id)
      : null;

    if (linkedVisit) {
      results.push({
        result_type: 'visit',
        result_id: linkedVisit.id,
        title: linkedVisit.diagnosis ?? linkedVisit.reason_for_visit ?? '(sin diagnostico)',
        subtitle: `Medicamento: ${prescription.medication_name}`,
        date_ref: linkedVisit.visit_date,
      });
      continue;
    }

    results.push({
      result_type: 'medication',
      result_id: prescription.id,
      title: prescription.medication_name,
      subtitle: prescriptionSubtitle(prescription),
      date_ref: prescription.start_at,
    });
  }

  for (const test of params.tests) {
    if (!matchesQuery(normalizedQuery, [test.test_name, test.category, test.notes])) continue;

    const linkedVisit = test.medical_visit_id
      ? visitById.get(test.medical_visit_id)
      : null;

    if (linkedVisit) {
      results.push({
        result_type: 'visit',
        result_id: linkedVisit.id,
        title: linkedVisit.diagnosis ?? linkedVisit.reason_for_visit ?? '(sin diagnostico)',
        subtitle: `Examen: ${test.test_name}`,
        date_ref: linkedVisit.visit_date,
      });
      continue;
    }

    results.push({
      result_type: 'test',
      result_id: test.id,
      title: test.test_name,
      subtitle: test.category ?? '',
      date_ref: test.ordered_at,
    });
  }

  return dedupeResults(results, (item) => `${item.result_type}:${item.result_id}`)
    .sort(byDateDesc);
}
