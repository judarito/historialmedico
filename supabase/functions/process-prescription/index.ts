// ============================================================
// Edge Function: process-prescription (schema real)
// Flujo: imagen → DeepSeek → medical_documents.parsed_json
// El usuario luego confirma via RPC confirm_document_and_create_records
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEEPSEEK_API_KEY          = Deno.env.get("DEEPSEEK_API_KEY")!;
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

interface AIExtractionResult {
  patient_name: string;
  doctor_name: string;
  visit_date: string;
  diagnosis: string;
  medications: ExtractedMedication[];
  tests: ExtractedTest[];
  general_instructions: string;
  confidence: number;
}

// ============================================================
// Llamada a DeepSeek Vision API
// ============================================================
async function extractWithDeepSeek(imageBase64: string): Promise<AIExtractionResult> {

  const systemPrompt = `Eres un asistente médico experto en interpretar fórmulas médicas latinoamericanas (Colombia, México, Argentina, etc.).
Extraes información estructurada de imágenes de fórmulas médicas con máxima precisión.

REGLAS:
- Extrae solo lo explícitamente escrito en la fórmula
- Si un campo no es legible, usa null o cadena vacía
- interval_hours: calcula a partir de la frecuencia ("cada 8h"=8, "3 veces/día"=8, "cada 12h"=12, "2 veces/día"=12)
- times_per_day: número de tomas por día ("cada 8h"=3, "cada 12h"=2, "1 vez/día"=1)
- duration_days: "7 días"=7, "1 semana"=7, "10 días"=10, "1 mes"=30
- route: "V.O."/"vía oral"="oral", "tópico"="topical", "I.M."="intramuscular", etc.
- is_as_needed: true si dice "SOS", "PRN", "si es necesario", "según necesidad"
- category para tests: "laboratorio", "imagen", "especialidad", "otro"
- confidence: 0.0 a 1.0 según legibilidad y completitud de la fórmula
- Responde ÚNICAMENTE con JSON válido`;

  const userPrompt = `Extrae la información de esta fórmula médica en el siguiente JSON:

{
  "patient_name": "",
  "doctor_name": "",
  "visit_date": "YYYY-MM-DD",
  "diagnosis": "",
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
  "general_instructions": "",
  "confidence": 0.0
}`;

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageBase64 } },
            { type: "text", content: userPrompt }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek no retornó contenido");

  const parsed = JSON.parse(content) as AIExtractionResult;
  if (!parsed.medications)  parsed.medications  = [];
  if (!parsed.tests)        parsed.tests        = [];
  if (!parsed.confidence)   parsed.confidence   = 0.5;

  return parsed;
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
      .update({ processing_status: "processing" })
      .eq("id", document_id);

    // 3. Obtener URL firmada del archivo (1 hora)
    // file_path es la columna real en el schema existente
    const { data: signedData, error: urlErr } = await supabaseUser.storage
      .from("medical-documents")
      .createSignedUrl(doc.file_path, 3600);

    if (urlErr || !signedData?.signedUrl) {
      throw new Error(`No se pudo obtener URL firmada: ${urlErr?.message}`);
    }

    // 4. Convertir imagen a base64
    const imgResponse = await fetch(signedData.signedUrl);
    if (!imgResponse.ok) throw new Error("No se pudo descargar la imagen");

    const arrayBuffer = await imgResponse.arrayBuffer();
    const base64      = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const mimeType    = doc.mime_type || "image/jpeg";
    const imageBase64 = `data:${mimeType};base64,${base64}`;

    // 5. Procesar con DeepSeek
    const extracted = await extractWithDeepSeek(imageBase64);

    // 6. Guardar resultado en el documento
    // Usa parsed_json y extracted_text (columnas reales del schema)
    await supabaseUser
      .from("medical_documents")
      .update({
        parsed_json:       extracted,
        extracted_text:    JSON.stringify(extracted), // texto plano para búsqueda
        ai_model:          "deepseek-chat",
        processing_status: "processed",    // listo para revisión humana
        verified_by_user:  false,          // pendiente confirmación
        processing_error:  null,
      })
      .eq("id", document_id);

    // 7. Log de auditoría
    await supabaseAdmin.rpc("log_audit_event", {
      p_tenant_id:   doc.tenant_id,
      p_action:      "AI_PROCESS_DOCUMENT",
      p_entity_name: "medical_documents",
      p_entity_id:   document_id,
      p_details:     {
        ai_model:           "deepseek-chat",
        confidence:         extracted.confidence,
        medications_found:  extracted.medications.length,
        tests_found:        extracted.tests.length,
      }
    });

    return new Response(
      JSON.stringify({
        success:    true,
        document_id,
        extracted,
        // El frontend muestra estos datos para revisión humana
        // Luego llama a confirm_document_and_create_records RPC
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
