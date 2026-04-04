import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const INTERNAL_SECRET = Deno.env.get("INTERNAL_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMBEDDING_DIMENSION = 256;

interface QueueRow {
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

interface ProcessQueueOptions {
  tenantId?: string | null;
  limit?: number;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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

function formatName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function formatDateTime(value?: string | null): string | null {
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

function humanizeKey(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function jsonToText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => jsonToText(item)).filter(Boolean).join("; ");
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => {
        const nestedText = jsonToText(nestedValue);
        return nestedText ? `${humanizeKey(key)}: ${nestedText}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function buildContent(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join("\n");
}

async function loadMemberIdentity(supabase: any, memberId: string | null | undefined) {
  if (!memberId) return null;

  const { data } = await supabase
    .from("family_members")
    .select("id, first_name, last_name, relationship")
    .eq("id", memberId)
    .maybeSingle();

  return data ?? null;
}

async function buildFamilyMemberChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: member } = await supabase
    .from("family_members")
    .select("id, tenant_id, family_id, first_name, last_name, relationship, birth_date, sex, blood_type, allergies, chronic_conditions, eps_name, notes, updated_at, is_active")
    .eq("id", recordId)
    .maybeSingle();

  if (!member || member.is_active === false) return [];

  const fullName = formatName(member.first_name, member.last_name) || "Familiar";
  const content = buildContent([
    `Nombre del familiar: ${fullName}`,
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
    title: `Perfil clínico de ${fullName}`,
    content,
    metadata: {
      family_member_name: fullName,
      relationship: member.relationship,
      eps_name: member.eps_name,
    },
    sourceUpdatedAt: member.updated_at ?? null,
  }];
}

async function buildMedicalVisitChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: visit } = await supabase
    .from("medical_visits")
    .select("id, tenant_id, family_id, family_member_id, visit_date, doctor_name, specialty, institution_name, reason_for_visit, diagnosis, notes, weight_kg, height_cm, temperature_c, blood_pressure, heart_rate, voice_note_text, status, deleted_at, updated_at")
    .eq("id", recordId)
    .maybeSingle();

  if (!visit || visit.deleted_at) return [];

  const member = await loadMemberIdentity(supabase, visit.family_member_id);
  const memberName = formatName(member?.first_name, member?.last_name);
  const vitals = [
    visit.weight_kg ? `peso ${visit.weight_kg} kg` : null,
    visit.height_cm ? `talla ${visit.height_cm} cm` : null,
    visit.temperature_c ? `temperatura ${visit.temperature_c} °C` : null,
    visit.blood_pressure ? `presión ${visit.blood_pressure}` : null,
    visit.heart_rate ? `frecuencia cardiaca ${visit.heart_rate}` : null,
  ].filter(Boolean).join(", ");

  const content = buildContent([
    memberName ? `Familiar: ${memberName}` : null,
    visit.visit_date ? `Fecha de la visita: ${formatDateTime(visit.visit_date)}` : null,
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
    title: visit.diagnosis ?? visit.reason_for_visit ?? `Visita médica ${formatDateTime(visit.visit_date) ?? ""}`.trim(),
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

async function buildPrescriptionChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: prescription } = await supabase
    .from("prescriptions")
    .select("id, tenant_id, family_id, family_member_id, medical_visit_id, medication_name, presentation, dose_amount, dose_unit, frequency_text, interval_hours, times_per_day, duration_days, route, instructions, start_at, end_at, is_as_needed, max_daily_doses, status, updated_at")
    .eq("id", recordId)
    .maybeSingle();

  if (!prescription) return [];

  const member = await loadMemberIdentity(supabase, prescription.family_member_id);
  const memberName = formatName(member?.first_name, member?.last_name);
  const doseLabel = [prescription.dose_amount, prescription.dose_unit].filter(Boolean).join(" ");

  const content = buildContent([
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
    prescription.start_at ? `Inicio: ${formatDateTime(prescription.start_at)}` : null,
    prescription.end_at ? `Fin: ${formatDateTime(prescription.end_at)}` : null,
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

async function buildMedicationScheduleChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
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

  const member = await loadMemberIdentity(supabase, schedule.family_member_id);
  const memberName = formatName(member?.first_name, member?.last_name);
  const statusMoment = schedule.taken_at ?? schedule.skipped_at ?? schedule.scheduled_at;

  const content = buildContent([
    memberName ? `Familiar: ${memberName}` : null,
    `Medicamento: ${prescription.medication_name}`,
    `Estado de la dosis: ${schedule.status}`,
    schedule.dose_label ? `Etiqueta de dosis: ${schedule.dose_label}` : null,
    schedule.dose_number ? `Número de dosis: ${schedule.dose_number}` : null,
    schedule.scheduled_at ? `Hora programada: ${formatDateTime(schedule.scheduled_at)}` : null,
    schedule.taken_at ? `Hora registrada: ${formatDateTime(schedule.taken_at)}` : null,
    schedule.skipped_at ? `Hora de omisión: ${formatDateTime(schedule.skipped_at)}` : null,
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

async function buildMedicalTestChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: test } = await supabase
    .from("medical_tests")
    .select("id, tenant_id, family_id, family_member_id, medical_visit_id, test_name, category, ordered_at, scheduled_at, completed_at, due_at, status, notes, updated_at")
    .eq("id", recordId)
    .maybeSingle();

  if (!test) return [];

  const member = await loadMemberIdentity(supabase, test.family_member_id);
  const memberName = formatName(member?.first_name, member?.last_name);

  const content = buildContent([
    memberName ? `Familiar: ${memberName}` : null,
    `Examen: ${test.test_name}`,
    test.category ? `Categoría: ${test.category}` : null,
    test.status ? `Estado: ${test.status}` : null,
    test.ordered_at ? `Ordenado el: ${formatDateTime(test.ordered_at)}` : null,
    test.scheduled_at ? `Agendado para: ${formatDateTime(test.scheduled_at)}` : null,
    test.due_at ? `Vence el: ${formatDateTime(test.due_at)}` : null,
    test.completed_at ? `Completado el: ${formatDateTime(test.completed_at)}` : null,
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

async function buildMedicalDocumentChunks(supabase: any, recordId: string): Promise<RagChunkDraft[]> {
  const { data: document } = await supabase
    .from("medical_documents")
    .select("id, tenant_id, family_id, family_member_id, medical_visit_id, document_type, title, extracted_text, parsed_json, processing_status, captured_at, verified_by_user, updated_at")
    .eq("id", recordId)
    .maybeSingle();

  if (!document) return [];

  const member = await loadMemberIdentity(supabase, document.family_member_id);
  const memberName = formatName(member?.first_name, member?.last_name);
  const documentLabel = humanizeKey(document.document_type ?? "documento");
  const baseMeta = {
    family_member_name: memberName || null,
    document_type: document.document_type,
    processing_status: document.processing_status,
    captured_at: document.captured_at,
    verified_by_user: document.verified_by_user,
  };

  const chunks: RagChunkDraft[] = [];

  if (normalizeText(document.extracted_text)) {
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
      content: buildContent([
        memberName ? `Familiar: ${memberName}` : null,
        document.captured_at ? `Capturado el: ${formatDateTime(document.captured_at)}` : null,
        `Contenido OCR del documento ${documentLabel}:`,
        document.extracted_text,
      ]),
      metadata: baseMeta,
      sourceUpdatedAt: document.updated_at ?? null,
    });
  }

  const parsedText = jsonToText(document.parsed_json);
  if (normalizeText(parsedText)) {
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
      content: buildContent([
        memberName ? `Familiar: ${memberName}` : null,
        document.captured_at ? `Capturado el: ${formatDateTime(document.captured_at)}` : null,
        `Datos interpretados del documento ${documentLabel}:`,
        parsedText,
      ]),
      metadata: baseMeta,
      sourceUpdatedAt: document.updated_at ?? null,
    });
  }

  return chunks;
}

async function buildChunksForQueueRow(supabase: any, row: QueueRow): Promise<RagChunkDraft[]> {
  switch (row.source_table) {
    case "family_members":
      return buildFamilyMemberChunks(supabase, row.source_record_id);
    case "medical_visits":
      return buildMedicalVisitChunks(supabase, row.source_record_id);
    case "medical_documents":
      return buildMedicalDocumentChunks(supabase, row.source_record_id);
    case "prescriptions":
      return buildPrescriptionChunks(supabase, row.source_record_id);
    case "medication_schedules":
      return buildMedicationScheduleChunks(supabase, row.source_record_id);
    case "medical_tests":
      return buildMedicalTestChunks(supabase, row.source_record_id);
    default:
      return [];
  }
}

async function enqueueBackfillRows(supabase: any, sourceTable: string, rows: any[]): Promise<number> {
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
  enqueued += await enqueueBackfillRows(supabase, "family_members", membersRes.data ?? []);
  enqueued += await enqueueBackfillRows(supabase, "medical_visits", visitsRes.data ?? []);
  enqueued += await enqueueBackfillRows(supabase, "medical_documents", documentsRes.data ?? []);
  enqueued += await enqueueBackfillRows(supabase, "prescriptions", prescriptionsRes.data ?? []);
  enqueued += await enqueueBackfillRows(supabase, "medication_schedules", schedulesRes.data ?? []);
  enqueued += await enqueueBackfillRows(supabase, "medical_tests", testsRes.data ?? []);

  return enqueued;
}

async function processRagReindexQueue(supabase: any, options: ProcessQueueOptions = {}) {
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

  for (const row of (rows ?? []) as QueueRow[]) {
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
        : await buildChunksForQueueRow(supabase, row);

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok");
  }

  if (req.headers.get("x-internal-secret") !== INTERNAL_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = typeof body?.tenantId === "string" ? body.tenantId : null;
    const limit = typeof body?.limit === "number" ? body.limit : 50;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const seeded = tenantId
      ? await ensureTenantRagSeeded(supabase, tenantId)
      : 0;

    const summary = await processRagReindexQueue(supabase, {
      tenantId,
      limit,
    });

    return new Response(JSON.stringify({
      seeded,
      ...summary,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("sync-rag-index error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Error interno",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
