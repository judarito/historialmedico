// ============================================================
// Edge Function: process-prescription (schema real)
// Flujo: imagen → OpenAI Vision → medical_documents.parsed_json
// El usuario luego confirma via RPC confirm_document_and_create_records
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY            = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface ExtractedMedication {
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

interface ExtractedTest {
  test_name: string;
  category: string;
  instructions?: string;
}

interface ExtractedVitals {
  weight_kg: number | null;
  height_cm: number | null;
  temperature_c: number | null;
  blood_pressure: string | null;
  heart_rate: number | null;
}

interface AIExtractionResult {
  patient_name: string | null;
  doctor_name: string | null;
  specialty: string | null;
  institution_name: string | null;
  reason_for_visit: string | null;
  visit_date: string | null;
  diagnosis: string | null;
  notes: string | null;
  medications: ExtractedMedication[];
  tests: ExtractedTest[];
  general_instructions: string | null;
  vitals: ExtractedVitals;
  confidence: number;
}

const SPECIALTY_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\bpediatr(?:ia|ía|a)\b/i, label: "Pediatría" },
  { regex: /\bmedicina general\b/i, label: "Medicina general" },
  { regex: /\bmedicina interna\b|\binternista\b/i, label: "Medicina interna" },
  { regex: /\bcardiolog(?:ia|ía|o|a)\b/i, label: "Cardiología" },
  { regex: /\bdermatolog(?:ia|ía|o|a)\b/i, label: "Dermatología" },
  { regex: /\bneurolog(?:ia|ía|o|a)\b/i, label: "Neurología" },
  { regex: /\bgineco(?:log(?:ia|ía|o|a))?\b|\bobstetricia\b/i, label: "Ginecología y obstetricia" },
  { regex: /\bortop(?:edia|edista)\b/i, label: "Ortopedia" },
  { regex: /\botorrinolaringolog(?:ia|ía)\b|\botorrino\b/i, label: "Otorrinolaringología" },
  { regex: /\boftalmolog(?:ia|ía|o|a)\b/i, label: "Oftalmología" },
  { regex: /\bneumolog(?:ia|ía|o|a)\b/i, label: "Neumología" },
  { regex: /\bgastroenterolog(?:ia|ía|o|a)\b/i, label: "Gastroenterología" },
  { regex: /\bendocrinolog(?:ia|ía|o|a)\b/i, label: "Endocrinología" },
  { regex: /\buro(?:log(?:ia|ía|o|a))\b/i, label: "Urología" },
  { regex: /\bnutri(?:cion|ción)\b|\bnutricionista\b/i, label: "Nutrición" },
  { regex: /\bpsiquiatr(?:ia|ía|a)\b/i, label: "Psiquiatría" },
  { regex: /\bpsicolog(?:ia|ía|o|a)\b/i, label: "Psicología" },
];

const DOCTOR_ROLE_RE = /\b(m[eé]dico|m[eé]dica|doctor|doctora|dr\.?|dra\.?)\b/gi;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized : null;
}

function mergeTextBlocks(...values: Array<string | null | undefined>): string | null {
  const unique = values
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index) as string[];

  return unique.length > 0 ? unique.join("\n\n") : null;
}

function formatDiagnosisWithPlainLanguage(
  diagnosis: unknown,
  plainLanguageDiagnosis: unknown,
): string | null {
  const technical = normalizeText(diagnosis);
  if (!technical) return null;

  const plainLanguage = normalizeText(plainLanguageDiagnosis);
  if (!plainLanguage) return technical;

  const technicalLc = technical.toLowerCase();
  const plainLanguageLc = plainLanguage.toLowerCase();

  if (
    technicalLc.includes(plainLanguageLc) ||
    plainLanguageLc.includes(technicalLc) ||
    technical.includes("(") ||
    technical.includes(" - ")
  ) {
    return technical;
  }

  return `${technical} (${plainLanguage})`;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBloodPressure(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/\b(\d{2,3})\s*\/\s*(\d{2,3})\b/);
  return match ? `${match[1]}/${match[2]}` : normalizeText(value);
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const latinMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (latinMatch) {
    const [, day, month, year] = latinMatch;
    const normalizedYear = year.length === 2 ? `20${year}` : year;
    return `${normalizedYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

function inferSpecialty(...values: Array<unknown>): string | null {
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;

    for (const specialty of SPECIALTY_PATTERNS) {
      if (specialty.regex.test(text)) {
        return specialty.label;
      }
    }
  }

  return null;
}

function stripKnownSpecialties(value: string): string {
  let cleaned = value;

  for (const specialty of SPECIALTY_PATTERNS) {
    cleaned = cleaned.replace(specialty.regex, " ");
  }

  return normalizeWhitespace(cleaned);
}

function sanitizeDoctorName(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;

  const withoutRole = normalizeWhitespace(text.replace(DOCTOR_ROLE_RE, " "));
  const withoutSpecialty = stripKnownSpecialties(withoutRole);
  const cleaned = normalizeWhitespace(withoutSpecialty.replace(/[,:;|-]+/g, " "));

  if (!cleaned) return null;
  return cleaned;
}

function extractVitalsFromText(value: unknown): Partial<ExtractedVitals> {
  const text = normalizeText(value);
  if (!text) return {};

  const findNumber = (pattern: RegExp) => {
    const match = text.match(pattern);
    return match ? normalizeNumber(match[1]) : null;
  };

  const pressureMatch = text.match(/\b(?:ta|t\.?a\.?|pa|p\.?a\.?|tensi[oó]n(?: arterial)?|presi[oó]n(?: arterial)?)\s*[:=]?\s*(\d{2,3}\s*\/\s*\d{2,3})\b/i);

  return {
    weight_kg: findNumber(/\b(?:peso|wt)\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:kg|kgs|kilogramos?)\b/i),
    height_cm: findNumber(/\b(?:talla|estatura|altura|ht)\s*[:=]?\s*(\d{2,3}(?:[.,]\d+)?)\s*(?:cm|cms|cent[ií]metros?)\b/i),
    temperature_c: findNumber(/\b(?:temp(?:eratura)?|temp\.?|t(?:°|º|o)?)(?:\s*corp(?:oral)?)?\s*[:=]?\s*(\d{2}(?:[.,]\d+)?)\s*(?:°?\s*c)\b/i),
    blood_pressure: pressureMatch ? normalizeBloodPressure(pressureMatch[1]) : null,
    heart_rate: findNumber(/\b(?:fc|f\.?c\.?|frecuencia cardiaca|frecuencia cardíaca|pulso)\s*[:=]?\s*(\d{2,3})\s*(?:lpm|ppm)?\b/i),
  };
}

function mergeVitals(primary: ExtractedVitals, ...fallbacks: Array<Partial<ExtractedVitals>>): ExtractedVitals {
  const merged = { ...primary };

  for (const fallback of fallbacks) {
    if (merged.weight_kg == null && fallback.weight_kg != null) merged.weight_kg = fallback.weight_kg;
    if (merged.height_cm == null && fallback.height_cm != null) merged.height_cm = fallback.height_cm;
    if (merged.temperature_c == null && fallback.temperature_c != null) merged.temperature_c = fallback.temperature_c;
    if (merged.blood_pressure == null && fallback.blood_pressure != null) merged.blood_pressure = fallback.blood_pressure;
    if (merged.heart_rate == null && fallback.heart_rate != null) merged.heart_rate = fallback.heart_rate;
  }

  return merged;
}

function normalizeExtraction(raw: Partial<AIExtractionResult>): AIExtractionResult {
  const textFallbacks = [
    raw.notes,
    raw.general_instructions,
    raw.reason_for_visit,
    raw.diagnosis,
    raw.doctor_name,
    raw.specialty,
  ];

  const normalizedSpecialty =
    normalizeText(raw.specialty) ?? inferSpecialty(raw.doctor_name, ...textFallbacks);

  const normalizedVitals: ExtractedVitals = mergeVitals(
    {
      weight_kg: normalizeNumber(raw.vitals?.weight_kg),
      height_cm: normalizeNumber(raw.vitals?.height_cm),
      temperature_c: normalizeNumber(raw.vitals?.temperature_c),
      blood_pressure: normalizeBloodPressure(raw.vitals?.blood_pressure),
      heart_rate: normalizeNumber(raw.vitals?.heart_rate),
    },
    ...textFallbacks.map((value) => extractVitalsFromText(value))
  );

  return {
    patient_name: normalizeText(raw.patient_name),
    doctor_name: sanitizeDoctorName(raw.doctor_name),
    specialty: normalizedSpecialty,
    institution_name: normalizeText(raw.institution_name),
    reason_for_visit: normalizeText(raw.reason_for_visit),
    visit_date: normalizeDate(raw.visit_date),
    diagnosis: normalizeText(raw.diagnosis),
    notes: normalizeText(raw.notes),
    medications: Array.isArray(raw.medications)
      ? raw.medications
          .map((med) => ({
            medication_name: normalizeText(med?.medication_name) ?? "",
            presentation: normalizeText(med?.presentation) ?? "",
            dose_amount: normalizeNumber(med?.dose_amount) ?? 0,
            dose_unit: normalizeText(med?.dose_unit) ?? "",
            frequency_text: normalizeText(med?.frequency_text) ?? "",
            interval_hours: normalizeNumber(med?.interval_hours) ?? 0,
            times_per_day: normalizeNumber(med?.times_per_day) ?? 0,
            duration_days: normalizeNumber(med?.duration_days) ?? 0,
            route: normalizeText(med?.route) ?? "oral",
            instructions: normalizeText(med?.instructions) ?? "",
            is_as_needed: Boolean(med?.is_as_needed),
          }))
          .filter((med) => med.medication_name)
      : [],
    tests: Array.isArray(raw.tests)
      ? raw.tests
          .map((test) => ({
            test_name: normalizeText(test?.test_name) ?? "",
            category: normalizeText(test?.category) ?? "otro",
            instructions: normalizeText(test?.instructions) ?? "",
          }))
          .filter((test) => test.test_name)
      : [],
    general_instructions: normalizeText(raw.general_instructions),
    vitals: normalizedVitals,
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0.5,
  };
}

async function suggestDiagnosisWithOpenAI(extracted: AIExtractionResult): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      max_tokens: 180,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Eres un asistente médico prudente.
Debes sugerir un diagnóstico o síndrome clínico breve en español a partir de medicamentos, exámenes y contexto.
REGLAS:
- Si el diagnóstico explícito ya existe, no lo cambies.
- Si la evidencia solo orienta a un síndrome, devuelve un síndrome clínico corto.
- Además devuelve una explicación muy simple, de máximo 3 a 8 palabras, para una persona sin formación médica.
- La explicación simple debe complementar el diagnóstico técnico, no repetirlo.
- Si la información es insuficiente o demasiado ambigua, devuelve null.
- No inventes enfermedades raras ni detalles no sustentados.
- Responde ÚNICAMENTE con JSON válido.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            doctor_name: extracted.doctor_name,
            specialty: extracted.specialty,
            institution_name: extracted.institution_name,
            reason_for_visit: extracted.reason_for_visit,
            notes: extracted.notes,
            medications: extracted.medications.map((med) => ({
              medication_name: med.medication_name,
              presentation: med.presentation,
              dose_amount: med.dose_amount,
              dose_unit: med.dose_unit,
              frequency_text: med.frequency_text,
              instructions: med.instructions,
            })),
            tests: extracted.tests,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI diagnosis suggestion error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return null;
  }

  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const parsed = JSON.parse(cleaned) as {
    diagnosis?: string | null;
    plain_language_diagnosis?: string | null;
  };
  return formatDiagnosisWithPlainLanguage(parsed.diagnosis, parsed.plain_language_diagnosis);
}

// ============================================================
// Llamada a OpenAI Vision API
// ============================================================
async function extractWithOpenAI(imageUrl: string): Promise<AIExtractionResult> {
  if (!OPENAI_API_KEY) {
    throw new Error("Falta OPENAI_API_KEY en los secrets de Supabase");
  }

  const systemPrompt = `Eres un asistente médico experto en interpretar fórmulas médicas latinoamericanas (Colombia, México, Argentina, etc.).
Extraes información estructurada de imágenes de fórmulas médicas con máxima precisión.

REGLAS:
- Extrae solo lo explícitamente escrito en la fórmula
- Si un campo no es legible, usa null o cadena vacía
- También extrae datos de la visita si aparecen: médico, especialidad, institución, motivo, diagnóstico, observaciones y signos vitales
- Si el diagnóstico no aparece escrito, pero los medicamentos, exámenes o el contexto clínico lo orientan claramente, sugiere un diagnóstico breve y prudente en "diagnosis", idealmente en formato "Diagnóstico técnico (explicación sencilla)"
- Haz dos pasadas mentales sobre la imagen:
  1. Encabezado, sello, membrete y tabla de signos vitales
  2. Medicamentos, exámenes e indicaciones
- Revisa con cuidado la parte superior, los sellos, firmas y márgenes: allí suelen venir médico, especialidad y fecha
- La especialidad puede aparecer como "Pediatría", "Medicina general", "Neurología", "Dermatología", etc.; si aparece junto al médico, sepárala y llena ambos campos
- Los signos vitales pueden aparecer como "Peso", "Talla", "Temp", "Temperatura", "TA", "PA", "FC", "Pulso"
- NO confundas dosis de medicamentos (mg, ml, gotas) con signos vitales; solo llena signos vitales cuando el valor esté asociado a su etiqueta o a una unidad clínica consistente
- interval_hours: calcula a partir de la frecuencia ("cada 8h"=8, "3 veces/día"=8, "cada 12h"=12, "2 veces/día"=12)
- times_per_day: número de tomas por día ("cada 8h"=3, "cada 12h"=2, "1 vez/día"=1)
- duration_days: "7 días"=7, "1 semana"=7, "10 días"=10, "1 mes"=30
- route: "V.O."/"vía oral"="oral", "tópico"="topical", "I.M."="intramuscular", etc.
- is_as_needed: true si dice "SOS", "PRN", "si es necesario", "según necesidad"
- category para tests: "laboratorio", "imagen", "especialidad", "otro"
- weight_kg, height_cm, temperature_c y heart_rate deben ser numéricos si aparecen explícitos
- blood_pressure debe conservarse como texto tipo "120/80" si aparece
- Si el valor trae unidad ("12 kg", "98 cm", "37.5 C"), devuelve solo el número en los campos numéricos
- confidence: 0.0 a 1.0 según legibilidad y completitud de la fórmula
- Responde ÚNICAMENTE con JSON válido`;

  const userPrompt = `Extrae la información de esta fórmula médica en el siguiente JSON:

{
  "patient_name": null,
  "doctor_name": null,
  "specialty": null,
  "institution_name": null,
  "reason_for_visit": null,
  "visit_date": "YYYY-MM-DD o null",
  "diagnosis": null,
  "notes": null,
  "medications": [
    {
      "medication_name": "",
      "presentation": "",
      "dose_amount": 0,
      "dose_unit": "",
      "frequency_text": "",
      "interval_hours": 0,
      "times_per_day": 0,
      "duration_days": 0,
      "route": "oral",
      "instructions": "",
      "is_as_needed": false
    }
  ],
  "tests": [
    {
      "test_name": "",
      "category": "laboratorio",
      "instructions": ""
    }
  ],
  "general_instructions": null,
  "vitals": {
    "weight_kg": null,
    "height_cm": null,
    "temperature_c": null,
    "blood_pressure": null,
    "heart_rate": null
  },
  "confidence": 0.0
}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI no retorno contenido util");
  }

  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const parsed = JSON.parse(cleaned) as Partial<AIExtractionResult>;
  const normalized = normalizeExtraction(parsed);

  if (!normalized.diagnosis && (
    normalized.medications.length > 0 ||
    normalized.tests.length > 0 ||
    normalized.reason_for_visit ||
    normalized.specialty
  )) {
    try {
      const suggestedDiagnosis = await suggestDiagnosisWithOpenAI(normalized);
      if (suggestedDiagnosis) {
        normalized.diagnosis = suggestedDiagnosis;
        normalized.notes = mergeTextBlocks(
          normalized.notes,
          "Diagnóstico sugerido por IA a partir de medicamentos, exámenes y contexto clínico."
        );
      }
    } catch (error) {
      console.warn("diagnosis suggestion warning:", error);
    }
  }

  return normalized;
}

// ============================================================
// Handler principal
// ============================================================
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  // Cliente con JWT del usuario (respeta RLS)
  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } }
  });
  // Cliente admin (para operaciones de sistema)
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { document_id } = await req.json();

    if (!document_id) {
      return new Response(
        JSON.stringify({ error: "Falta document_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. Obtener el documento (RLS valida acceso)
    const { data: doc, error: docErr } = await supabaseUser
      .from("medical_documents")
      .select("*")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) {
      return new Response(
        JSON.stringify({ error: "Documento no encontrado o sin acceso" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Marcar como procesando
    await supabaseUser
      .from("medical_documents")
      .update({
        processing_status: "processing",
        processing_error: null,
      })
      .eq("id", document_id);

    // 3. Obtener URL firmada del archivo (1 hora)
    const { data: signedData, error: urlErr } = await supabaseUser.storage
      .from("medical-documents")
      .createSignedUrl(doc.file_path, 3600);

    if (urlErr || !signedData?.signedUrl) {
      throw new Error(`No se pudo obtener URL firmada: ${urlErr?.message}`);
    }

    // 4. Procesar con OpenAI Vision
    const extracted = await extractWithOpenAI(signedData.signedUrl);

    // 5. Guardar resultado en el documento
    await supabaseUser
      .from("medical_documents")
      .update({
        parsed_json:       extracted,
        extracted_text:    JSON.stringify(extracted),
        ai_model:          "gpt-4.1-mini",
        processing_status: "processed",
        verified_by_user:  false,
        processing_error:  null,
      })
      .eq("id", document_id);

    await supabaseAdmin.rpc("log_audit_event", {
      p_tenant_id:   doc.tenant_id,
      p_action:      "AI_PROCESS_DOCUMENT",
      p_entity_name: "medical_documents",
      p_entity_id:   document_id,
      p_details:     {
        ai_model:          "gpt-4.1-mini",
        confidence:        extracted.confidence,
        medications_found: extracted.medications.length,
        tests_found:       extracted.tests.length,
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        document_id,
        extracted,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Error en process-prescription:", err);

    // Marcar documento con error
    try {
      const { document_id } = await req.clone().json();
      if (document_id) {
        const supabaseErr = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          global: { headers: { Authorization: authHeader } }
        });
        await supabaseErr
          .from("medical_documents")
          .update({
            processing_status: "failed",
            processing_error:  err instanceof Error ? err.message : "Error desconocido"
          })
          .eq("id", document_id);
      }
    } catch (_) { /* silencioso */ }

    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
