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

// ── DeepSeek: texto → datos médicos estructurados ─────────────────────────

async function extractVisitData(transcription: string): Promise<object> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("Falta DEEPSEEK_API_KEY en los secrets de Supabase");
  }

  const systemPrompt = `Eres un asistente médico colombiano. Extrae datos médicos estructurados de una nota de voz transcrita.
Si un campo no se menciona, devuelve null para ese campo.
Responde ÚNICAMENTE con JSON válido.`;

  const userPrompt = `Transcripción: "${transcription}"

Extrae los datos en este formato JSON:
{
  "visit_date": "YYYY-MM-DDTHH:mm o null",
  "doctor_name": "nombre del médico o null",
  "specialty": "especialidad médica o null",
  "institution_name": "clínica u hospital o null",
  "reason_for_visit": "motivo de consulta o null",
  "diagnosis": "diagnóstico o null",
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

  return JSON.parse(cleaned);
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
