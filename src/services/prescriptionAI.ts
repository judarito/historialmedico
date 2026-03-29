// ============================================================
// Servicio: Procesamiento IA de Fórmulas (schema real)
// Usa: medical_documents.file_path, parsed_json, processing_status
// Usa: prescriptions.medication_name, start_at, end_at
// Usa: medical_tests.test_name, ordered_at
// ============================================================

import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "./supabase";
import type { Json } from "../types/database.types";

export interface ExtractedMedication {
  medication_name: string;
  presentation: string;
  dose_amount: number;
  dose_unit: string;
  frequency_text: string;
  interval_hours: number;
  times_per_day: number;
  duration_days: number;
  route: string;
  instructions: string;
  is_as_needed: boolean;
}

export interface ExtractedTest {
  test_name: string;
  category: string;
  instructions?: string;
}

export interface AIExtractionResult {
  patient_name: string;
  doctor_name: string;
  visit_date: string;
  diagnosis: string;
  medications: ExtractedMedication[];
  tests: ExtractedTest[];
  general_instructions: string;
  confidence: number;
}

export interface ProcessPrescriptionResult {
  document_id: string;
  extracted: AIExtractionResult;
}

export interface ConfirmResult {
  success: boolean;
  prescription_ids: string[];
  test_ids: string[];
  medications_created: number;
  tests_created: number;
}

export class PrescriptionAIService {

  // --------------------------------------------------------
  // PASO 1: Optimizar imagen
  // --------------------------------------------------------
  static async optimizeImage(imageUri: string): Promise<string> {
    const result = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 1600 } }],
      {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    return result.uri;
  }

  // --------------------------------------------------------
  // PASO 2: Subir imagen a Supabase Storage
  // Path: {tenant_id}/{family_member_id}/{timestamp}/formula.jpg
  // Crea registro en medical_documents con file_path (columna real)
  // --------------------------------------------------------
  static async uploadFormulaImage(params: {
    imageUri:        string;
    tenantId:        string;
    familyId:        string;
    familyMemberId:  string;
    visitId?:        string;
  }): Promise<{ documentId: string; filePath: string }> {

    const { imageUri, tenantId, familyId, familyMemberId, visitId } = params;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no autenticado");

    // Optimizar
    const optimizedUri = await this.optimizeImage(imageUri);
    const fileInfo = await FileSystem.getInfoAsync(optimizedUri);
    if (!fileInfo.exists) throw new Error("Archivo no encontrado");

    // Path en Storage
    const timestamp = Date.now();
    const filePath  = `${tenantId}/${familyMemberId}/${timestamp}/formula.jpg`;

    // Leer como base64
    const base64 = await FileSystem.readAsStringAsync(optimizedUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const uint8 = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

    // Subir a Storage (bucket medical-documents)
    const { error: uploadErr } = await supabase.storage
      .from("medical-documents")
      .upload(filePath, uint8, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadErr) throw new Error(`Error subiendo imagen: ${uploadErr.message}`);

    // Crear registro en medical_documents
    // file_path es la columna real (no storage_path)
    const { data: doc, error: docErr } = await supabase
      .from("medical_documents")
      .insert({
        tenant_id:         tenantId,
        family_id:         familyId,
        family_member_id:  familyMemberId,
        medical_visit_id:  visitId ?? null,
        document_type:     "formula",
        title:             `Fórmula ${new Date().toLocaleDateString("es-CO")}`,
        file_path:         filePath,         // columna real
        mime_type:         "image/jpeg",
        file_size_bytes:   fileInfo.size ?? 0,
        captured_at:       new Date().toISOString(),
        processing_status: "pending",
        verified_by_user:  false,
        created_by:        user.id,
      })
      .select("id")
      .single();

    if (docErr || !doc) throw new Error(`Error creando documento: ${docErr?.message}`);

    return { documentId: doc.id, filePath };
  }

  // --------------------------------------------------------
  // PASO 3: Llamar a la Edge Function de procesamiento IA
  // La función actualiza medical_documents.parsed_json
  // --------------------------------------------------------
  static async processWithAI(documentId: string): Promise<AIExtractionResult> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Sesión no válida");

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;

    const response = await fetch(
      `${supabaseUrl}/functions/v1/process-prescription`,
      {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ document_id: documentId }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Error del servidor: ${response.status}`);
    }

    const result = await response.json();
    return result.extracted as AIExtractionResult;
  }

  // --------------------------------------------------------
  // PASO 4: Confirmar datos (el usuario revisó y aprobó)
  // Llama a RPC confirm_document_and_create_records
  // Crea: prescriptions + medication_schedules + medical_tests
  // --------------------------------------------------------
  static async confirmAndCreate(params: {
    documentId:  string;
    medications: ExtractedMedication[];
    tests:       ExtractedTest[];
  }): Promise<ConfirmResult> {

    const { data, error } = await supabase.rpc(
      "confirm_document_and_create_records",
      {
        p_document_id: params.documentId,
        p_medications: params.medications as unknown as Json,
        p_tests:       params.tests       as unknown as Json,
      }
    );

    if (error) throw new Error(`Error confirmando documento: ${error.message}`);
    return data as ConfirmResult;
  }

  // --------------------------------------------------------
  // FLUJO COMPLETO
  // --------------------------------------------------------
  static async processFromImage(params: {
    imageUri:       string;
    tenantId:       string;
    familyId:       string;
    familyMemberId: string;
    visitId?:       string;
    onProgress?:    (step: string, pct: number) => void;
  }): Promise<ProcessPrescriptionResult> {

    const { imageUri, tenantId, familyId, familyMemberId, visitId, onProgress } = params;

    onProgress?.("Subiendo imagen...", 0.2);
    const { documentId } = await this.uploadFormulaImage({
      imageUri, tenantId, familyId, familyMemberId, visitId
    });

    onProgress?.("Analizando con IA...", 0.5);
    const extracted = await this.processWithAI(documentId);

    onProgress?.("Listo para revisar", 1.0);
    return { document_id: documentId, extracted };
  }

  // --------------------------------------------------------
  // Obtener URL firmada para mostrar la imagen (1h)
  // Usa file_path (columna real)
  // --------------------------------------------------------
  static async getSignedImageUrl(filePath: string): Promise<string> {
    const { data, error } = await supabase.storage
      .from("medical-documents")
      .createSignedUrl(filePath, 3600);

    if (error || !data) throw new Error("No se pudo obtener URL de imagen");
    return data.signedUrl;
  }

  // --------------------------------------------------------
  // Crear recordatorio de dosis
  // Usa columnas reales: medication_schedule_id, message (no body)
  // reminder_status enum: 'pending'
  // --------------------------------------------------------
  static async createDoseReminder(params: {
    tenantId:       string;
    familyId:       string;
    familyMemberId: string;
    prescriptionId: string;
    scheduleId:     string;
    medicationName: string;
    doseLabel:      string | null;
    scheduledAt:    Date;
    minutesBefore?: number;
  }): Promise<void> {

    const remindAt = new Date(
      params.scheduledAt.getTime() - (params.minutesBefore ?? 10) * 60 * 1000
    );

    await supabase.from("reminders").insert({
      tenant_id:              params.tenantId,
      family_id:              params.familyId,
      family_member_id:       params.familyMemberId,
      prescription_id:        params.prescriptionId,
      medication_schedule_id: params.scheduleId,    // columna real
      reminder_type:          "medication_dose",
      title:                  `💊 ${params.medicationName}`,
      message:                params.doseLabel       // columna real (no body)
                              ? `${params.doseLabel} — Hora de tomar el medicamento`
                              : "Hora de tomar el medicamento",
      remind_at:              remindAt.toISOString(),
      status:                 "pending",              // enum reminder_status
    });
  }

  // --------------------------------------------------------
  // Crear recordatorio de examen pendiente
  // --------------------------------------------------------
  static async createTestReminder(params: {
    tenantId:       string;
    familyId:       string;
    familyMemberId: string;
    testId:         string;
    testName:       string;
    dueAt:          Date;
    daysBefore?:    number;
  }): Promise<void> {

    const remindAt = new Date(params.dueAt);
    remindAt.setDate(remindAt.getDate() - (params.daysBefore ?? 1));
    remindAt.setHours(9, 0, 0, 0);

    await supabase.from("reminders").insert({
      tenant_id:        params.tenantId,
      family_id:        params.familyId,
      family_member_id: params.familyMemberId,
      medical_test_id:  params.testId,
      reminder_type:    "medical_test",
      title:            "🔬 Examen próximo",
      message:          `Recuerda: ${params.testName} es mañana`,
      remind_at:        remindAt.toISOString(),
      status:           "pending",
    });
  }
}
