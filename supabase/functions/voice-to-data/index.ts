// ============================================================
// Edge Function: voice-to-data
// Recibe una transcripción de voz (texto) y extrae datos
// médicos estructurados con DeepSeek.
//
// Secrets requeridos en Supabase:
//   DEEPSEEK_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Input:  { transcription: string, context: 'search' | 'visit' | 'general' }
// Output: { transcription: string, structured?: object, error?: string }
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

async function suggestDiagnosisWithDeepSeek(structured: Record<string, unknown>): Promise<string | null> {
  if (!DEEPSEEK_API_KEY) {
    return null;
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
      max_tokens: 180,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Eres un asistente médico colombiano prudente.
Sugiere un diagnóstico breve en español a partir del contexto clínico.
REGLAS:
- Si no hay suficiente evidencia, devuelve null.
- Si la evidencia solo orienta a un síndrome, devuelve un síndrome corto.
- Además devuelve una explicación muy simple, de máximo 3 a 8 palabras, para alguien sin formación médica.
- No inventes detalles ni afirmes certezas injustificadas.
- Responde ÚNICAMENTE con JSON válido.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            doctor_name: structured.doctor_name ?? null,
            specialty: structured.specialty ?? null,
            institution_name: structured.institution_name ?? null,
            reason_for_visit: structured.reason_for_visit ?? null,
            notes: structured.notes ?? null,
            medications: structured.medications ?? [],
            vitals: structured.vitals ?? null,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek diagnosis suggestion error ${response.status}: ${errText}`);
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

// ── DeepSeek: texto → datos médicos estructurados ─────────────────────────

async function extractVisitData(transcription: string): Promise<object> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("Falta DEEPSEEK_API_KEY en los secrets de Supabase");
  }

  const systemPrompt = `Eres un asistente médico colombiano. Extrae datos médicos estructurados de una nota de voz transcrita.
Si un campo no se menciona, devuelve null para ese campo.
Extrae solo lo explícitamente dicho o claramente inferible por contexto inmediato.
Si no se menciona un diagnóstico pero la combinación de motivo, medicamentos y contexto clínico lo orienta, sugiere un diagnóstico breve y prudente, idealmente en formato "Diagnóstico técnico (explicación sencilla)".
Si aparecen signos vitales, conviértelos a los campos correspondientes y conserva sus unidades correctas.
Responde ÚNICAMENTE con JSON válido.`;

  const userPrompt = `Transcripción: "${transcription}"

Extrae los datos en este formato JSON:
{
  "visit_date": "YYYY-MM-DDTHH:mm o null",
  "doctor_name": "nombre del médico o null",
  "specialty": "especialidad médica o null",
  "institution_name": "clínica u hospital o null",
  "reason_for_visit": "motivo de consulta o null",
  "diagnosis": "diagnóstico explícito o sugerido de forma prudente; si es sugerido, intenta usar formato 'Diagnóstico técnico (explicación sencilla)', o null",
  "notes": "observaciones adicionales o null",
  "medications": [
    {
      "medication_name": "",
      "dose_amount": null,
      "dose_unit": "",
      "frequency_text": "",
      "duration_days": null,
      "instructions": ""
    }
  ],
  "vitals": {
    "weight_kg": null,
    "height_cm": null,
    "temperature_c": null,
    "blood_pressure": null,
    "heart_rate": null
  }
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
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("DeepSeek no retorno contenido util");
  }

  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const structured = JSON.parse(cleaned) as Record<string, unknown>;

  if (!normalizeText(structured.diagnosis) && (
    (Array.isArray(structured.medications) && structured.medications.length > 0) ||
    normalizeText(structured.reason_for_visit) ||
    normalizeText(structured.specialty) ||
    normalizeText(structured.notes)
  )) {
    try {
      const suggestedDiagnosis = await suggestDiagnosisWithDeepSeek(structured);
      if (suggestedDiagnosis) {
        structured.diagnosis = suggestedDiagnosis;
        structured.notes = mergeTextBlocks(
          normalizeText(structured.notes),
          "Diagnóstico sugerido por IA a partir del contexto clínico y los medicamentos."
        );
      }
    } catch (error) {
      console.warn("voice diagnosis suggestion warning:", error);
    }
  }

  return structured;
}

// ── Handler ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }
  if (!req.headers.get("Authorization")) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { transcription, context = "general" } = await req.json();

    if (!transcription || !transcription.trim()) {
      return new Response(JSON.stringify({ error: "Falta transcription" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Extraer datos estructurados solo cuando el contexto es visita
    let structured: object | null = null;
    if (context === "visit") {
      structured = await extractVisitData(transcription);
    }

    return new Response(
      JSON.stringify({ transcription, structured }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("voice-to-data error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
