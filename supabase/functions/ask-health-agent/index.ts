import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMBEDDING_DIMENSION = 256;

interface RagQueueRow {
  id: string;
  tenant_id: string;
  family_id: string | null;
  family_member_id: string | null;
  visit_id: string | null;
  source_table: string;
  source_record_id: string;
  operation: "upsert" | "delete";
  status: "pending" | "processing" | "completed" | "error";
  attempts: number;
}

interface RagChunkDraft {
  chunkKey: string;
  tenantId: string;
  familyId: string;
  familyMemberId: string | null;
  visitId: string | null;
  sourceType: string;
  sourceTable: string;
  sourceRecordId: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  sourceUpdatedAt: string | null;
}

interface RagProcessQueueOptions {
  tenantId?: string | null;
  limit?: number;
}

function normalizeEmbeddingText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function buildEmbeddingFeatures(text: string): string[] {
  const normalized = normalizeEmbeddingText(text);
  if (!normalized) return [];

  const tokens = normalized.split(" ").filter((token) => token.length > 1);
  const features = [...tokens];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    features.push(`${tokens[index]}_${tokens[index + 1]}`);
  }

  const compact = normalized.replace(/\s+/g, "_");
  for (let index = 0; index < compact.length - 2; index += 1) {
    const trigram = compact.slice(index, index + 3);
    if (!trigram.includes("_")) {
      features.push(`tri:${trigram}`);
    }
  }

  return features;
}

function buildHashEmbedding(text: string, dimension = EMBEDDING_DIMENSION): number[] {
  const vector = Array.from({ length: dimension }, () => 0);
  const features = buildEmbeddingFeatures(text);

  if (features.length === 0) {
    return vector;
  }

  for (const feature of features) {
    const hash = fnv1a(feature);
    const featureIndex = hash % dimension;
    const sign = (fnv1a(`sign:${feature}`) & 1) === 0 ? 1 : -1;
    const weight = feature.startsWith("tri:")
      ? 0.25
      : feature.includes("_")
        ? 0.85
        : 1;

    vector[featureIndex] += sign * weight;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function buildEmbeddingLiteral(text: string): string {
  return `[${buildHashEmbedding(text).map((value) => Number.isFinite(value) ? value.toFixed(6) : "0").join(",")}]`;
}

type AgentIntent =
  | "recent_history"
  | "visit_summary"
  | "last_diagnosis"
  | "last_medication"
  | "active_treatments"
  | "pending_tests"
  | "last_dose"
  | "document_search"
  | "specialty_history"
  | "general_question";

interface PlannerResult {
  intent: AgentIntent;
  family_member_name: string | null;
  medication_name: string | null;
  test_name: string | null;
  specialty: string | null;
  timeframe: "this_year" | "recent" | "all" | null;
  wants_summary: boolean;
  search_terms: string[];
}

interface FamilyMemberLite {
  id: string;
  first_name: string;
  last_name: string | null;
  relationship: string | null;
}

interface RelatedVisit {
  visit_id: string;
  title: string;
  visit_date: string;
  reason: string;
}

function ragNormalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function ragFormatName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function ragFormatDateTime(value?: string | null): string | null {
  if (!value) return null;

  try {
    return new Date(value).toLocaleString("es-CO", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Bogota",
    });
  } catch {
    return value;
  }
}

function ragHumanizeKey(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function ragJsonToText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return ragNormalizeText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => ragJsonToText(item)).filter(Boolean).join("; ");
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => {
        const nestedText = ragJsonToText(nestedValue);
        return nestedText ? `${ragHumanizeKey(key)}: ${nestedText}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function ragBuildContent(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => ragNormalizeText(part))
    .filter(Boolean)
    .join("\n");
}

async function ragLoadMemberIdentity(supabase: any, memberId: string | null | undefined) {
  if (!memberId) return null;

  const { data } = await supabase
    .from("family_members")
    .select("id, first_name, last_name, relationship")
    .eq("id", memberId)
    .maybeSingle();

  return data ?? null;
}

async function ragBuildFamilyMemberChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: member } = await supabase
    .from("family_members")
    .select("id, tenant_id, family_id, first_name, last_name, relationship, birth_date, sex, blood_type, allergies, chronic_conditions, eps_name, notes, updated_at, is_active")
    .eq("id", recordId)
    .maybeSingle();

  if (!member || member.is_active === false) return [];

  const fullMemberName = ragFormatName(member.first_name, member.last_name) || "Familiar";
  const content = ragBuildContent([
    `Nombre del familiar: ${fullMemberName}`,
    member.relationship ? `Relación: ${member.relationship}` : null,
    member.birth_date ? `Fecha de nacimiento: ${member.birth_date}` : null,
    member.sex ? `Sexo: ${member.sex}` : null,
    member.blood_type ? `Tipo de sangre: ${member.blood_type}` : null,
    member.eps_name ? `EPS: ${member.eps_name}` : null,
    member.allergies ? `Alergias: ${member.allergies}` : null,
    member.chronic_conditions ? `Condiciones crónicas: ${member.chronic_conditions}` : null,
    member.notes ? `Notas: ${member.notes}` : null,
  ]);

  return [{
    chunkKey: `family_members:${member.id}:profile`,
    tenantId: member.tenant_id,
    familyId: member.family_id,
    familyMemberId: member.id,
    visitId: null,
    sourceType: "member_profile",
    sourceTable: "family_members",
    sourceRecordId: member.id,
    title: `Perfil clínico de ${fullMemberName}`,
    content,
    metadata: {
      family_member_name: fullMemberName,
      relationship: member.relationship,
      eps_name: member.eps_name,
    },
    sourceUpdatedAt: member.updated_at ?? null,
  }];
}

async function ragBuildMedicalVisitChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: visit } = await supabase
    .from("medical_visits")
    .select("id, tenant_id, family_id, family_member_id, visit_date, doctor_name, specialty, institution_name, reason_for_visit, diagnosis, notes, weight_kg, height_cm, temperature_c, blood_pressure, heart_rate, voice_note_text, status, deleted_at, updated_at")
    .eq("id", recordId)
    .maybeSingle();

  if (!visit || visit.deleted_at) return [];

  const member = await ragLoadMemberIdentity(supabase, visit.family_member_id);
  const memberName = ragFormatName(member?.first_name, member?.last_name);
  const vitals = [
    visit.weight_kg ? `peso ${visit.weight_kg} kg` : null,
    visit.height_cm ? `talla ${visit.height_cm} cm` : null,
    visit.temperature_c ? `temperatura ${visit.temperature_c} °C` : null,
    visit.blood_pressure ? `presión ${visit.blood_pressure}` : null,
    visit.heart_rate ? `frecuencia cardiaca ${visit.heart_rate}` : null,
  ].filter(Boolean).join(", ");

  const content = ragBuildContent([
    memberName ? `Familiar: ${memberName}` : null,
    visit.visit_date ? `Fecha de la visita: ${ragFormatDateTime(visit.visit_date)}` : null,
    visit.status ? `Estado de la visita: ${visit.status}` : null,
    visit.doctor_name ? `Médico: ${visit.doctor_name}` : null,
    visit.specialty ? `Especialidad: ${visit.specialty}` : null,
    visit.institution_name ? `Institución: ${visit.institution_name}` : null,
    visit.reason_for_visit ? `Motivo de consulta: ${visit.reason_for_visit}` : null,
    visit.diagnosis ? `Diagnóstico: ${visit.diagnosis}` : null,
    visit.notes ? `Notas médicas: ${visit.notes}` : null,
    visit.voice_note_text ? `Nota de voz transcrita: ${visit.voice_note_text}` : null,
    vitals ? `Signos vitales: ${vitals}` : null,
  ]);

  return [{
    chunkKey: `medical_visits:${visit.id}:summary`,
    tenantId: visit.tenant_id,
    familyId: visit.family_id,
    familyMemberId: visit.family_member_id,
    visitId: visit.id,
    sourceType: "visit_summary",
    sourceTable: "medical_visits",
    sourceRecordId: visit.id,
    title: visit.diagnosis ?? visit.reason_for_visit ?? `Visita médica ${ragFormatDateTime(visit.visit_date) ?? ""}`.trim(),
    content,
    metadata: {
      family_member_name: memberName || null,
      visit_date: visit.visit_date,
      doctor_name: visit.doctor_name,
      specialty: visit.specialty,
      status: visit.status,
    },
    sourceUpdatedAt: visit.updated_at ?? null,
  }];
}

async function ragBuildPrescriptionChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: prescription } = await supabase
    .from("prescriptions")
    .select("id, tenant_id, family_id, family_member_id, medical_visit_id, medication_name, presentation, dose_amount, dose_unit, frequency_text, interval_hours, times_per_day, duration_days, route, instructions, start_at, end_at, is_as_needed, max_daily_doses, status, updated_at")
    .eq("id", recordId)
    .maybeSingle();

  if (!prescription) return [];

  const member = await ragLoadMemberIdentity(supabase, prescription.family_member_id);
  const memberName = ragFormatName(member?.first_name, member?.last_name);
  const doseLabel = [prescription.dose_amount, prescription.dose_unit].filter(Boolean).join(" ");

  const content = ragBuildContent([
    memberName ? `Familiar: ${memberName}` : null,
    `Medicamento: ${prescription.medication_name}`,
    prescription.status ? `Estado del tratamiento: ${prescription.status}` : null,
    prescription.presentation ? `Presentación: ${prescription.presentation}` : null,
    doseLabel ? `Dosis: ${doseLabel}` : null,
    prescription.frequency_text ? `Frecuencia: ${prescription.frequency_text}` : null,
    prescription.interval_hours ? `Intervalo: cada ${prescription.interval_hours} horas` : null,
    prescription.times_per_day ? `Veces por día: ${prescription.times_per_day}` : null,
    prescription.duration_days ? `Duración: ${prescription.duration_days} días` : null,
    prescription.route ? `Vía de administración: ${prescription.route}` : null,
    prescription.instructions ? `Instrucciones: ${prescription.instructions}` : null,
    prescription.start_at ? `Inicio: ${ragFormatDateTime(prescription.start_at)}` : null,
    prescription.end_at ? `Fin: ${ragFormatDateTime(prescription.end_at)}` : null,
    prescription.is_as_needed ? "Uso según necesidad" : null,
    prescription.max_daily_doses ? `Máximo diario: ${prescription.max_daily_doses}` : null,
  ]);

  return [{
    chunkKey: `prescriptions:${prescription.id}:treatment`,
    tenantId: prescription.tenant_id,
    familyId: prescription.family_id,
    familyMemberId: prescription.family_member_id,
    visitId: prescription.medical_visit_id,
    sourceType: "prescription",
    sourceTable: "prescriptions",
    sourceRecordId: prescription.id,
    title: `Tratamiento: ${prescription.medication_name}`,
    content,
    metadata: {
      family_member_name: memberName || null,
      medication_name: prescription.medication_name,
      status: prescription.status,
      start_at: prescription.start_at,
      end_at: prescription.end_at,
    },
    sourceUpdatedAt: prescription.updated_at ?? null,
  }];
}

async function ragBuildMedicationScheduleChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: schedule } = await supabase
    .from("medication_schedules")
    .select("id, tenant_id, family_id, family_member_id, prescription_id, scheduled_at, dose_number, dose_label, status, taken_at, skipped_at, notes, updated_at")
    .eq("id", recordId)
    .maybeSingle();

  if (!schedule || schedule.status === "pending") return [];

  const { data: prescription } = await supabase
    .from("prescriptions")
    .select("id, medical_visit_id, medication_name")
    .eq("id", schedule.prescription_id)
    .maybeSingle();

  if (!prescription) return [];

  const member = await ragLoadMemberIdentity(supabase, schedule.family_member_id);
  const memberName = ragFormatName(member?.first_name, member?.last_name);
  const statusMoment = schedule.taken_at ?? schedule.skipped_at ?? schedule.scheduled_at;

  const content = ragBuildContent([
    memberName ? `Familiar: ${memberName}` : null,
    `Medicamento: ${prescription.medication_name}`,
    `Estado de la dosis: ${schedule.status}`,
    schedule.dose_label ? `Etiqueta de dosis: ${schedule.dose_label}` : null,
    schedule.dose_number ? `Número de dosis: ${schedule.dose_number}` : null,
    schedule.scheduled_at ? `Hora programada: ${ragFormatDateTime(schedule.scheduled_at)}` : null,
    schedule.taken_at ? `Hora registrada: ${ragFormatDateTime(schedule.taken_at)}` : null,
    schedule.skipped_at ? `Hora de omisión: ${ragFormatDateTime(schedule.skipped_at)}` : null,
    schedule.notes ? `Notas: ${schedule.notes}` : null,
  ]);

  return [{
    chunkKey: `medication_schedules:${schedule.id}:dose_log`,
    tenantId: schedule.tenant_id,
    familyId: schedule.family_id,
    familyMemberId: schedule.family_member_id,
    visitId: prescription.medical_visit_id ?? null,
    sourceType: "dose_log",
    sourceTable: "medication_schedules",
    sourceRecordId: schedule.id,
    title: `Registro de dosis: ${prescription.medication_name}`,
    content,
    metadata: {
      family_member_name: memberName || null,
      medication_name: prescription.medication_name,
      status: schedule.status,
      status_at: statusMoment,
    },
    sourceUpdatedAt: schedule.updated_at ?? null,
  }];
}

async function ragBuildMedicalTestChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: test } = await supabase
    .from("medical_tests")
    .select("id, tenant_id, family_id, family_member_id, medical_visit_id, test_name, category, ordered_at, scheduled_at, completed_at, due_at, status, notes, updated_at")
    .eq("id", recordId)
    .maybeSingle();

  if (!test) return [];

  const member = await ragLoadMemberIdentity(supabase, test.family_member_id);
  const memberName = ragFormatName(member?.first_name, member?.last_name);

  const content = ragBuildContent([
    memberName ? `Familiar: ${memberName}` : null,
    `Examen: ${test.test_name}`,
    test.category ? `Categoría: ${test.category}` : null,
    test.status ? `Estado: ${test.status}` : null,
    test.ordered_at ? `Ordenado el: ${ragFormatDateTime(test.ordered_at)}` : null,
    test.scheduled_at ? `Agendado para: ${ragFormatDateTime(test.scheduled_at)}` : null,
    test.due_at ? `Vence el: ${ragFormatDateTime(test.due_at)}` : null,
    test.completed_at ? `Completado el: ${ragFormatDateTime(test.completed_at)}` : null,
    test.notes ? `Notas: ${test.notes}` : null,
  ]);

  return [{
    chunkKey: `medical_tests:${test.id}:test`,
    tenantId: test.tenant_id,
    familyId: test.family_id,
    familyMemberId: test.family_member_id,
    visitId: test.medical_visit_id,
    sourceType: "medical_test",
    sourceTable: "medical_tests",
    sourceRecordId: test.id,
    title: `Examen: ${test.test_name}`,
    content,
    metadata: {
      family_member_name: memberName || null,
      test_name: test.test_name,
      status: test.status,
      due_at: test.due_at,
    },
    sourceUpdatedAt: test.updated_at ?? null,
  }];
}

async function ragBuildMedicalDocumentChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: document } = await supabase
    .from("medical_documents")
    .select("id, tenant_id, family_id, family_member_id, medical_visit_id, document_type, title, extracted_text, parsed_json, processing_status, captured_at, verified_by_user, updated_at")
    .eq("id", recordId)
    .maybeSingle();

  if (!document) return [];

  const member = await ragLoadMemberIdentity(supabase, document.family_member_id);
  const memberName = ragFormatName(member?.first_name, member?.last_name);
  const documentLabel = ragHumanizeKey(document.document_type ?? "documento");
  const baseMeta = {
    family_member_name: memberName || null,
    document_type: document.document_type,
    processing_status: document.processing_status,
    captured_at: document.captured_at,
    verified_by_user: document.verified_by_user,
  };

  const chunks: RagChunkDraft[] = [];

  if (ragNormalizeText(document.extracted_text)) {
    chunks.push({
      chunkKey: `medical_documents:${document.id}:ocr`,
      tenantId: document.tenant_id,
      familyId: document.family_id,
      familyMemberId: document.family_member_id,
      visitId: document.medical_visit_id,
      sourceType: "document_ocr",
      sourceTable: "medical_documents",
      sourceRecordId: document.id,
      title: document.title ?? `${documentLabel} OCR`,
      content: ragBuildContent([
        memberName ? `Familiar: ${memberName}` : null,
        document.captured_at ? `Capturado el: ${ragFormatDateTime(document.captured_at)}` : null,
        `Contenido OCR del documento ${documentLabel}:`,
        document.extracted_text,
      ]),
      metadata: baseMeta,
      sourceUpdatedAt: document.updated_at ?? null,
    });
  }

  const parsedText = ragJsonToText(document.parsed_json);
  if (ragNormalizeText(parsedText)) {
    chunks.push({
      chunkKey: `medical_documents:${document.id}:parsed`,
      tenantId: document.tenant_id,
      familyId: document.family_id,
      familyMemberId: document.family_member_id,
      visitId: document.medical_visit_id,
      sourceType: "document_parsed",
      sourceTable: "medical_documents",
      sourceRecordId: document.id,
      title: document.title ?? `${documentLabel} interpretado`,
      content: ragBuildContent([
        memberName ? `Familiar: ${memberName}` : null,
        document.captured_at ? `Capturado el: ${ragFormatDateTime(document.captured_at)}` : null,
        `Datos interpretados del documento ${documentLabel}:`,
        parsedText,
      ]),
      metadata: baseMeta,
      sourceUpdatedAt: document.updated_at ?? null,
    });
  }

  return chunks;
}

async function ragBuildChunksForQueueRow(supabase: any, row: RagQueueRow): Promise<RagChunkDraft[]> {
  switch (row.source_table) {
    case "family_members":
      return ragBuildFamilyMemberChunks(supabase, row.source_record_id);
    case "medical_visits":
      return ragBuildMedicalVisitChunks(supabase, row.source_record_id);
    case "medical_documents":
      return ragBuildMedicalDocumentChunks(supabase, row.source_record_id);
    case "prescriptions":
      return ragBuildPrescriptionChunks(supabase, row.source_record_id);
    case "medication_schedules":
      return ragBuildMedicationScheduleChunks(supabase, row.source_record_id);
    case "medical_tests":
      return ragBuildMedicalTestChunks(supabase, row.source_record_id);
    default:
      return [];
  }
}

async function ragEnqueueBackfillRows(supabase: any, sourceTable: string, rows: any[]): Promise<number> {
  if (rows.length === 0) return 0;

  const nowIso = new Date().toISOString();
  const payloadRows = rows
    .filter((row) => row?.id && row?.tenant_id)
    .map((row) => ({
      tenant_id: row.tenant_id,
      family_id: row.family_id ?? null,
      family_member_id: row.family_member_id ?? (sourceTable === "family_members" ? row.id : null),
      visit_id: row.medical_visit_id ?? (sourceTable === "medical_visits" ? row.id : null),
      source_table: sourceTable,
      source_record_id: row.id,
      operation: "upsert",
      status: "pending",
      attempts: 0,
      payload: { seeded: true },
      available_at: nowIso,
      locked_at: null,
      last_error: null,
      updated_at: nowIso,
    }));

  if (payloadRows.length === 0) return 0;

  const { error } = await supabase
    .from("rag_reindex_queue")
    .upsert(payloadRows, { onConflict: "source_table,source_record_id" });

  if (error) throw error;
  return payloadRows.length;
}

async function ensureTenantRagSeeded(supabase: any, tenantId: string): Promise<number> {
  const [{ count: chunkCount }, { count: queueCount }] = await Promise.all([
    supabase.from("rag_chunks").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("rag_reindex_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);

  if ((chunkCount ?? 0) > 0 || (queueCount ?? 0) > 0) {
    return 0;
  }

  const [membersRes, visitsRes, documentsRes, prescriptionsRes, schedulesRes, testsRes] = await Promise.all([
    supabase.from("family_members").select("id, tenant_id, family_id").eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("medical_visits").select("id, tenant_id, family_id, family_member_id").eq("tenant_id", tenantId),
    supabase.from("medical_documents").select("id, tenant_id, family_id, family_member_id, medical_visit_id").eq("tenant_id", tenantId),
    supabase.from("prescriptions").select("id, tenant_id, family_id, family_member_id, medical_visit_id").eq("tenant_id", tenantId),
    supabase.from("medication_schedules").select("id, tenant_id, family_id, family_member_id").eq("tenant_id", tenantId),
    supabase.from("medical_tests").select("id, tenant_id, family_id, family_member_id, medical_visit_id").eq("tenant_id", tenantId),
  ]);

  const errors = [
    membersRes.error,
    visitsRes.error,
    documentsRes.error,
    prescriptionsRes.error,
    schedulesRes.error,
    testsRes.error,
  ].filter(Boolean);

  if (errors.length > 0) throw errors[0];

  let enqueued = 0;
  enqueued += await ragEnqueueBackfillRows(supabase, "family_members", membersRes.data ?? []);
  enqueued += await ragEnqueueBackfillRows(supabase, "medical_visits", visitsRes.data ?? []);
  enqueued += await ragEnqueueBackfillRows(supabase, "medical_documents", documentsRes.data ?? []);
  enqueued += await ragEnqueueBackfillRows(supabase, "prescriptions", prescriptionsRes.data ?? []);
  enqueued += await ragEnqueueBackfillRows(supabase, "medication_schedules", schedulesRes.data ?? []);
  enqueued += await ragEnqueueBackfillRows(supabase, "medical_tests", testsRes.data ?? []);

  return enqueued;
}

async function processRagReindexQueue(supabase: any, options: RagProcessQueueOptions = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const nowIso = new Date().toISOString();

  let query = supabase
    .from("rag_reindex_queue")
    .select("id, tenant_id, family_id, family_member_id, visit_id, source_table, source_record_id, operation, status, attempts")
    .in("status", ["pending", "error"])
    .lte("available_at", nowIso)
    .order("available_at", { ascending: true })
    .limit(limit);

  if (options.tenantId) {
    query = query.eq("tenant_id", options.tenantId);
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  const summary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    deleted_chunks: 0,
    upserted_chunks: 0,
  };

  for (const row of (rows ?? []) as RagQueueRow[]) {
    summary.processed += 1;

    await supabase
      .from("rag_reindex_queue")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    try {
      const chunks = row.operation === "delete"
        ? []
        : await ragBuildChunksForQueueRow(supabase, row);

      const { data: deletedCount, error: deleteError } = await supabase.rpc("delete_rag_chunks_for_source", {
        p_source_table: row.source_table,
        p_source_record_id: row.source_record_id,
      });

      if (deleteError) throw deleteError;
      summary.deleted_chunks += Number(deletedCount ?? 0);

      for (const chunk of chunks) {
        const { error: upsertError } = await supabase.rpc("upsert_rag_chunk", {
          p_chunk_key: chunk.chunkKey,
          p_tenant_id: chunk.tenantId,
          p_family_id: chunk.familyId,
          p_family_member_id: chunk.familyMemberId,
          p_visit_id: chunk.visitId,
          p_source_type: chunk.sourceType,
          p_source_table: chunk.sourceTable,
          p_source_record_id: chunk.sourceRecordId,
          p_title: chunk.title,
          p_content: chunk.content,
          p_metadata: chunk.metadata,
          p_embedding_text: buildEmbeddingLiteral(`${chunk.title}\n${chunk.content}`),
          p_source_updated_at: chunk.sourceUpdatedAt,
          p_is_deleted: false,
        });

        if (upsertError) throw upsertError;
        summary.upserted_chunks += 1;
      }

      await supabase
        .from("rag_reindex_queue")
        .update({
          status: "completed",
          locked_at: null,
          last_error: null,
          last_processed_at: new Date().toISOString(),
          attempts: row.attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      summary.succeeded += 1;
    } catch (processError) {
      const waitMs = Math.min((row.attempts + 1) * 30_000, 15 * 60_000);
      const nextAvailableAt = new Date(Date.now() + waitMs).toISOString();
      const message = processError instanceof Error ? processError.message : "RAG reindex failed";

      await supabase
        .from("rag_reindex_queue")
        .update({
          status: "error",
          locked_at: null,
          last_error: message.slice(0, 1000),
          attempts: row.attempts + 1,
          available_at: nextAvailableAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      summary.failed += 1;
    }
  }

  return summary;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function fullName(member: Pick<FamilyMemberLite, "first_name" | "last_name">): string {
  return [member.first_name, member.last_name].filter(Boolean).join(" ").trim();
}

function clampConfidence(value: unknown, fallback = 0.35): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function cleanSearchTerm(value: string): string {
  return value.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function buildOrFilter(columns: string[], terms: Array<string | null | undefined>): string | null {
  const cleanedTerms = [...new Set(
    terms
      .map((term) => cleanSearchTerm(term ?? ""))
      .filter(Boolean)
  )].slice(0, 6);

  if (cleanedTerms.length === 0) return null;

  return cleanedTerms
    .flatMap((term) => columns.map((column) => `${column}.ilike.%${term}%`))
    .join(",");
}

function yearStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0)).toISOString();
}

function buildFallbackPlan(question: string): PlannerResult {
  const normalized = normalizeText(question);

  if (normalized.includes("ultima dosis") || normalized.includes("ultimo dosis") || normalized.includes("dosis registrada")) {
    return {
      intent: "last_dose",
      family_member_name: null,
      medication_name: null,
      test_name: null,
      specialty: null,
      timeframe: "recent",
      wants_summary: false,
      search_terms: [question],
    };
  }

  if (normalized.includes("examen") && (normalized.includes("pendiente") || normalized.includes("pendientes"))) {
    return {
      intent: "pending_tests",
      family_member_name: null,
      medication_name: null,
      test_name: null,
      specialty: null,
      timeframe: "recent",
      wants_summary: false,
      search_terms: [question],
    };
  }

  if (normalized.includes("diagnostico") || normalized.includes("diagnóstico")) {
    return {
      intent: "last_diagnosis",
      family_member_name: null,
      medication_name: null,
      test_name: null,
      specialty: null,
      timeframe: "recent",
      wants_summary: false,
      search_terms: [question],
    };
  }

  if (normalized.includes("medicamento") && normalized.includes("activo")) {
    return {
      intent: "active_treatments",
      family_member_name: null,
      medication_name: null,
      test_name: null,
      specialty: null,
      timeframe: "recent",
      wants_summary: false,
      search_terms: [question],
    };
  }

  if (normalized.includes("documento") || normalized.includes("formula") || normalized.includes("ocr")) {
    return {
      intent: "document_search",
      family_member_name: null,
      medication_name: null,
      test_name: null,
      specialty: null,
      timeframe: "all",
      wants_summary: false,
      search_terms: [question],
    };
  }

  if (normalized.includes("resume") || normalized.includes("historia medica") || normalized.includes("historia médica")) {
    return {
      intent: "visit_summary",
      family_member_name: null,
      medication_name: null,
      test_name: null,
      specialty: null,
      timeframe: "recent",
      wants_summary: true,
      search_terms: [question],
    };
  }

  return {
    intent: "general_question",
    family_member_name: null,
    medication_name: null,
    test_name: null,
    specialty: null,
    timeframe: "recent",
    wants_summary: false,
    search_terms: [question],
  };
}

async function callDeepSeekJson<T>(systemPrompt: string, userPayload: unknown, maxTokens = 500): Promise<T> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("Falta DEEPSEEK_API_KEY en los secrets de Supabase");
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("DeepSeek no devolvió contenido JSON útil");
  }

  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return JSON.parse(cleaned) as T;
}

async function planQuestion(question: string, members: FamilyMemberLite[]): Promise<PlannerResult> {
  const fallback = buildFallbackPlan(question);

  try {
    const planner = await callDeepSeekJson<PlannerResult>(
      `Eres el planner de un agente RAG de historial médico familiar.
No respondas la pregunta del usuario.
Devuelve SOLO JSON válido con este esquema:
{
  "intent": "recent_history | visit_summary | last_diagnosis | last_medication | active_treatments | pending_tests | last_dose | document_search | specialty_history | general_question",
  "family_member_name": string | null,
  "medication_name": string | null,
  "test_name": string | null,
  "specialty": string | null,
  "timeframe": "this_year" | "recent" | "all" | null,
  "wants_summary": boolean,
  "search_terms": string[]
}

Reglas:
- Si el usuario pregunta por la última vez que mandaron un medicamento, usa "last_medication".
- Si pregunta por tratamientos activos o medicamentos actuales, usa "active_treatments".
- Si pregunta por exámenes pendientes, usa "pending_tests".
- Si pregunta por la última dosis registrada, usa "last_dose".
- Si pregunta por documentos, OCR o texto extraído, usa "document_search".
- Si pide resumen o historia médica reciente, usa "visit_summary" o "recent_history".
- Usa "specialty_history" para consultas por especialidad y periodo, como pediatría este año.
- Si detectas un nombre exacto de familiar, devuélvelo en family_member_name.
- search_terms debe incluir la pregunta original y, si aplica, 2-4 términos cortos útiles para retrieval.`,
      {
        question,
        available_family_members: members.map((member) => ({
          name: fullName(member),
          relationship: member.relationship,
        })),
      },
      350,
    );

    return {
      ...fallback,
      ...planner,
      search_terms: [...new Set((planner.search_terms ?? [question]).concat(question).filter(Boolean))].slice(0, 6),
    };
  } catch (error) {
    console.warn("ask-health-agent planner fallback:", error);
    return fallback;
  }
}

function resolveMemberByRelationship(question: string, members: FamilyMemberLite[]): FamilyMemberLite | null {
  const normalized = normalizeText(question);
  const relationMap: Array<{ patterns: string[]; relationship: string }> = [
    { patterns: ["mi hijo", "hijo"], relationship: "son" },
    { patterns: ["mi hija", "hija"], relationship: "daughter" },
    { patterns: ["mi mama", "mamá", "mama"], relationship: "mother" },
    { patterns: ["mi papa", "papá", "papa"], relationship: "father" },
    { patterns: ["mi esposa", "esposa"], relationship: "spouse" },
    { patterns: ["mi esposo", "esposo"], relationship: "spouse" },
  ];

  for (const entry of relationMap) {
    if (!entry.patterns.some((pattern) => normalized.includes(normalizeText(pattern)))) {
      continue;
    }

    const related = members.filter((member) => member.relationship === entry.relationship);
    if (related.length === 1) {
      return related[0];
    }
  }

  return null;
}

function resolveFamilyMember(
  question: string,
  members: FamilyMemberLite[],
  requestedMemberId?: string | null,
  plannerName?: string | null,
) {
  const warnings: string[] = [];

  if (requestedMemberId) {
    const requested = members.find((member) => member.id === requestedMemberId);
    if (requested) {
      return { member: requested, warnings };
    }
  }

  const searchCandidates = [plannerName, question]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  for (const candidate of searchCandidates) {
    const exactMatches = members.filter((member) => normalizeText(fullName(member)) === candidate);
    if (exactMatches.length === 1) {
      return { member: exactMatches[0], warnings };
    }

    const partialMatches = members.filter((member) => {
      const name = normalizeText(fullName(member));
      return candidate.includes(name) || name.includes(candidate);
    });

    if (partialMatches.length === 1) {
      return { member: partialMatches[0], warnings };
    }
  }

  const relationshipMatch = resolveMemberByRelationship(question, members);
  if (relationshipMatch) {
    return { member: relationshipMatch, warnings };
  }

  if (plannerName) {
    warnings.push(`No pude relacionar "${plannerName}" con un familiar activo de esta familia.`);
  }

  return { member: null, warnings };
}

async function resolveTenantContext(userClient: any, userId: string) {
  const { data: profile } = await userClient
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  let tenantId = profile?.tenant_id ?? null;

  if (!tenantId) {
    const { data: membership } = await userClient
      .from("tenant_users")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    tenantId = membership?.tenant_id ?? null;
  }

  return tenantId;
}

async function fetchMembers(userClient: any): Promise<FamilyMemberLite[]> {
  const { data, error } = await userClient
    .from("family_members")
    .select("id, first_name, last_name, relationship")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as FamilyMemberLite[];
}

async function retrieveStructuredEvidence(userClient: any, plan: PlannerResult, familyMemberId: string | null) {
  const structured = {
    visits: [] as any[],
    prescriptions: [] as any[],
    tests: [] as any[],
    doses: [] as any[],
  };

  const visitIds = new Set<string>();
  const searchTerms = [plan.medication_name, plan.test_name, plan.specialty, ...plan.search_terms];

  if (plan.intent === "last_diagnosis") {
    let query = userClient
      .from("medical_visits")
      .select("id, family_member_id, visit_date, doctor_name, specialty, institution_name, reason_for_visit, diagnosis, status")
      .is("deleted_at", null)
      .not("diagnosis", "is", null)
      .order("visit_date", { ascending: false })
      .limit(3);

    if (familyMemberId) {
      query = query.eq("family_member_id", familyMemberId);
    }

    const { data } = await query;
    structured.visits = data ?? [];
    for (const visit of structured.visits) {
      if (visit.id) visitIds.add(visit.id);
    }
  }

  if (plan.intent === "last_medication" || plan.intent === "active_treatments") {
    let query = userClient
      .from("prescriptions")
      .select("id, family_member_id, medical_visit_id, medication_name, presentation, dose_amount, dose_unit, frequency_text, instructions, start_at, end_at, status, created_at")
      .order("start_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(plan.intent === "active_treatments" ? 12 : 5);

    if (familyMemberId) {
      query = query.eq("family_member_id", familyMemberId);
    }

    if (plan.intent === "active_treatments") {
      query = query.eq("status", "active");
    }

    const orFilter = buildOrFilter(
      ["medication_name", "presentation", "instructions"],
      searchTerms,
    );
    if (orFilter) {
      query = query.or(orFilter);
    }

    const { data } = await query;
    structured.prescriptions = data ?? [];

    for (const prescription of structured.prescriptions) {
      if (prescription.medical_visit_id) visitIds.add(prescription.medical_visit_id);
    }
  }

  if (plan.intent === "pending_tests") {
    let query = userClient
      .from("medical_tests")
      .select("id, family_member_id, medical_visit_id, test_name, category, status, ordered_at, scheduled_at, due_at, completed_at, notes")
      .in("status", ["pending", "scheduled"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("ordered_at", { ascending: false })
      .limit(10);

    if (familyMemberId) {
      query = query.eq("family_member_id", familyMemberId);
    }

    const orFilter = buildOrFilter(
      ["test_name", "category", "notes"],
      searchTerms,
    );
    if (orFilter) {
      query = query.or(orFilter);
    }

    const { data } = await query;
    structured.tests = data ?? [];
    for (const test of structured.tests) {
      if (test.medical_visit_id) visitIds.add(test.medical_visit_id);
    }
  }

  if (plan.intent === "last_dose") {
    let prescriptionQuery = userClient
      .from("prescriptions")
      .select("id, medical_visit_id, medication_name")
      .limit(20);

    if (familyMemberId) {
      prescriptionQuery = prescriptionQuery.eq("family_member_id", familyMemberId);
    }

    const orFilter = buildOrFilter(["medication_name", "instructions"], searchTerms);
    if (orFilter) {
      prescriptionQuery = prescriptionQuery.or(orFilter);
    }

    const { data: prescriptions } = await prescriptionQuery;
    const prescriptionRows = prescriptions ?? [];
    const prescriptionIds = prescriptionRows.map((row: any) => row.id);

    if (prescriptionIds.length > 0) {
      let doseQuery = userClient
        .from("medication_schedules")
        .select("id, prescription_id, family_member_id, scheduled_at, taken_at, skipped_at, status, notes, dose_label")
        .in("prescription_id", prescriptionIds)
        .in("status", ["taken", "late", "skipped"])
        .order("taken_at", { ascending: false, nullsFirst: false })
        .order("skipped_at", { ascending: false, nullsFirst: false })
        .order("scheduled_at", { ascending: false })
        .limit(6);

      if (familyMemberId) {
        doseQuery = doseQuery.eq("family_member_id", familyMemberId);
      }

      const { data: doses } = await doseQuery;
      const byPrescriptionId = new Map(prescriptionRows.map((row: any) => [row.id, row]));

      structured.doses = (doses ?? []).map((dose: any) => ({
        ...dose,
        prescription: byPrescriptionId.get(dose.prescription_id) ?? null,
      }));

      for (const dose of structured.doses) {
        const visitId = dose.prescription?.medical_visit_id;
        if (visitId) visitIds.add(visitId);
      }
    }
  }

  if (plan.intent === "recent_history" || plan.intent === "visit_summary" || plan.intent === "specialty_history") {
    let query = userClient
      .from("medical_visits")
      .select("id, family_member_id, visit_date, doctor_name, specialty, institution_name, reason_for_visit, diagnosis, status")
      .is("deleted_at", null)
      .order("visit_date", { ascending: false })
      .limit(plan.wants_summary ? 3 : 8);

    if (familyMemberId) {
      query = query.eq("family_member_id", familyMemberId);
    }

    if (plan.intent === "specialty_history") {
      if (plan.timeframe === "this_year") {
        query = query.gte("visit_date", yearStartIso());
      }

      const specialtyFilter = buildOrFilter(["specialty", "doctor_name", "reason_for_visit"], [plan.specialty, ...plan.search_terms]);
      if (specialtyFilter) {
        query = query.or(specialtyFilter);
      }
    }

    const { data } = await query;
    structured.visits = data ?? [];
    for (const visit of structured.visits) {
      if (visit.id) visitIds.add(visit.id);
    }
  }

  return {
    structured,
    visitIds,
  };
}

async function fetchRagEvidence(userClient: any, question: string, plan: PlannerResult, familyMemberId: string | null) {
  const queryText = [...new Set([question, ...plan.search_terms].filter(Boolean))].join(" ");
  const { data, error } = await userClient.rpc("match_rag_chunks", {
    p_query: queryText,
    p_query_embedding_text: buildEmbeddingLiteral(queryText),
    p_family_member_id: familyMemberId,
    p_limit: 10,
  });

  if (error) {
    console.warn("match_rag_chunks warning:", error.message);
    return [];
  }

  return (data ?? []).map((chunk: any) => ({
    ...chunk,
    excerpt: String(chunk.content ?? "").slice(0, 600),
  }));
}

async function fetchRelatedVisits(userClient: any, visitIds: string[]): Promise<RelatedVisit[]> {
  if (visitIds.length === 0) return [];

  const { data, error } = await userClient
    .from("medical_visits")
    .select("id, visit_date, diagnosis, reason_for_visit, doctor_name, specialty")
    .in("id", visitIds)
    .is("deleted_at", null)
    .order("visit_date", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((visit: any) => ({
    visit_id: visit.id,
    title: visit.diagnosis ?? visit.reason_for_visit ?? "Visita médica",
    visit_date: visit.visit_date,
    reason: [visit.doctor_name, visit.specialty].filter(Boolean).join(" · ") || "Ver detalle de la visita",
  }));
}

async function generateAnswer(question: string, plan: PlannerResult, familyMember: FamilyMemberLite | null, structured: any, ragChunks: any[]) {
  const hasEvidence =
    structured.visits.length > 0 ||
    structured.prescriptions.length > 0 ||
    structured.tests.length > 0 ||
    structured.doses.length > 0 ||
    ragChunks.length > 0;

  if (!hasEvidence) {
    return {
      answer: "No encontré información suficiente en el historial para responder esa pregunta con seguridad.",
      confidence: 0.18,
      warnings: ["No se encontraron datos suficientes que respalden una respuesta."],
    };
  }

  const result = await callDeepSeekJson<{
    answer?: string;
    confidence?: number;
    warnings?: string[];
  }>(
    `Eres un asistente de historial médico familiar.
Tu trabajo es responder SOLO con base en la evidencia entregada.

REGLAS ESTRICTAS:
- No inventes diagnósticos, tratamientos, dosis ni fechas.
- No recomiendes medicamentos ni cambies tratamientos.
- No des consejos médicos ni instrucciones clínicas.
- Si la evidencia no alcanza, dilo claramente.
- Diferencia entre dato confirmado y posible inferencia.
- Responde en español claro y breve.
- No menciones chunks internos, embeddings, ranking ni detalles técnicos.
- Devuelve SOLO JSON con:
{
  "answer": string,
  "confidence": number,
  "warnings": string[]
}`,
    {
      question,
      plan,
      family_member: familyMember
        ? { id: familyMember.id, name: fullName(familyMember), relationship: familyMember.relationship }
        : null,
      structured_evidence: structured,
      rag_context: ragChunks.map((chunk) => ({
        source_type: chunk.source_type,
        title: chunk.title,
        excerpt: chunk.excerpt,
        visit_id: chunk.visit_id,
      })),
    },
    520,
  );

  return {
    answer: String(result.answer ?? "").trim() || "No encontré información suficiente para responder con seguridad.",
    confidence: clampConfidence(result.confidence, 0.45),
    warnings: Array.isArray(result.warnings) ? result.warnings.filter(Boolean).slice(0, 4) : [],
  };
}

function inferConfidence(plan: PlannerResult, structured: any, ragChunks: any[], llmConfidence: number): number {
  let score = llmConfidence;

  if (structured.visits.length > 0) score += 0.12;
  if (structured.prescriptions.length > 0 || structured.tests.length > 0 || structured.doses.length > 0) score += 0.12;
  if (ragChunks.length > 0) score += 0.06;
  if (plan.intent === "general_question") score -= 0.08;

  return clampConfidence(score, 0.3);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let tenantId: string | null = null;
  let userId: string | null = null;
  let question = "";

  try {
    const body = await req.json();
    question = typeof body?.question === "string" ? body.question.trim() : "";
    const requestedMemberId = typeof body?.familyMemberId === "string" ? body.familyMemberId : null;

    if (!question) {
      return new Response(JSON.stringify({
        answer: "",
        family_member: null,
        matched_visits: [],
        confidence: 0,
        warnings: ["La pregunta está vacía."],
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      throw new Error("No se pudo autenticar al usuario");
    }

    userId = authData.user.id;
    tenantId = await resolveTenantContext(userClient, userId);
    if (!tenantId) {
      throw new Error("No se encontró un tenant activo para este usuario");
    }

    const ragBootstrapWarnings: string[] = [];
    try {
      await ensureTenantRagSeeded(serviceClient, tenantId);
      await processRagReindexQueue(serviceClient, { tenantId, limit: 20 });
    } catch (ragBootstrapError) {
      console.error("ask-health-agent rag bootstrap warning:", ragBootstrapError);
      ragBootstrapWarnings.push("El índice semántico no estuvo disponible en este intento; respondí con los datos estructurados que sí pude leer.");
    }

    const members = await fetchMembers(userClient);
    const plan = await planQuestion(question, members);
    const memberResolution = resolveFamilyMember(question, members, requestedMemberId, plan.family_member_name);
    const familyMember = memberResolution.member;

    const { structured, visitIds } = await retrieveStructuredEvidence(
      userClient,
      plan,
      familyMember?.id ?? null,
    );

    const ragChunks = await fetchRagEvidence(
      userClient,
      question,
      plan,
      familyMember?.id ?? null,
    );

    for (const chunk of ragChunks) {
      if (chunk.visit_id) {
        visitIds.add(chunk.visit_id);
      }
    }

    const matchedVisits = await fetchRelatedVisits(userClient, Array.from(visitIds).slice(0, 8));
    const llmAnswer = await generateAnswer(question, plan, familyMember, structured, ragChunks);
    const warnings = [...ragBootstrapWarnings, ...memberResolution.warnings, ...llmAnswer.warnings];
    const confidence = inferConfidence(plan, structured, ragChunks, llmAnswer.confidence);
    const latencyMs = Date.now() - startedAt;

    await serviceClient.from("rag_queries_log").insert({
      tenant_id: tenantId,
      user_id: userId,
      family_member_id: familyMember?.id ?? null,
      question: question.slice(0, 2000),
      detected_intent: plan.intent,
      detected_member: familyMember ? fullName(familyMember) : (plan.family_member_name ?? null),
      chunk_ids: ragChunks.map((chunk) => chunk.id),
      visit_ids: matchedVisits.map((visit) => visit.visit_id),
      warnings,
      confidence,
      latency_ms: latencyMs,
      status: "ok",
      answer_preview: llmAnswer.answer.slice(0, 500),
    });

    return new Response(JSON.stringify({
      answer: llmAnswer.answer,
      family_member: familyMember
        ? { id: familyMember.id, name: fullName(familyMember) }
        : null,
      matched_visits: matchedVisits,
      confidence,
      warnings,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ask-health-agent error:", error);

    if (tenantId && userId && question) {
      await serviceClient.from("rag_queries_log").insert({
        tenant_id: tenantId,
        user_id: userId,
        family_member_id: null,
        question: question.slice(0, 2000),
        detected_intent: null,
        detected_member: null,
        chunk_ids: [],
        visit_ids: [],
        warnings: [],
        confidence: 0,
        latency_ms: Date.now() - startedAt,
        status: "error",
        error_code: error instanceof Error ? error.name : "unknown_error",
        answer_preview: null,
      }).catch(() => undefined);
    }

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Error interno",
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
