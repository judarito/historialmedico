import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  if (!req.headers.get("Authorization")) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!DEEPSEEK_API_KEY) {
    return new Response(JSON.stringify({ error: "Falta DEEPSEEK_API_KEY en los secrets de Supabase" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { visit, prescriptions = [], tests = [] } = await req.json();

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.1,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Eres un asistente médico colombiano prudente.
Debes sugerir un diagnóstico o síndrome clínico breve en español usando el contexto de una visita.

REGLAS:
- Prioriza un diagnóstico corto y útil para el historial clínico.
- Si solo hay evidencia para un síndrome clínico, devuelve ese síndrome.
- Además devuelve una explicación muy simple, corta y comprensible para una persona sin estudios médicos.
- Si la información es insuficiente o muy ambigua, devuelve null.
- No inventes enfermedades raras ni detalles no sustentados.
- No incluyas explicaciones largas dentro del diagnóstico.
- Responde ÚNICAMENTE con JSON válido.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              visit: {
                doctor_name: visit?.doctor_name ?? null,
                specialty: visit?.specialty ?? null,
                institution_name: visit?.institution_name ?? null,
                reason_for_visit: visit?.reason_for_visit ?? null,
                current_diagnosis: visit?.diagnosis ?? null,
                notes: visit?.notes ?? null,
                vitals: visit?.vitals ?? null,
              },
              prescriptions,
              tests,
            }),
          },
        ],
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

    const parsed = JSON.parse(cleaned) as {
      diagnosis?: string | null;
      plain_language_diagnosis?: string | null;
      rationale?: string | null;
    };

    return new Response(JSON.stringify({
      diagnosis: formatDiagnosisWithPlainLanguage(parsed.diagnosis, parsed.plain_language_diagnosis),
      rationale: normalizeText(parsed.rationale),
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("infer-visit-diagnosis error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Error interno",
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
