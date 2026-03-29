// ============================================================
// Edge Function: search-ai
// Búsqueda inteligente con DeepSeek como expansor de términos.
// Flujo:
//   1. Usuario envía query en lenguaje natural
//   2. DeepSeek extrae términos médicos alternativos/sinónimos
//   3. Se ejecuta search_global para cada término
//   4. Resultados se fusionan, deduplicidad y ordenan por relevancia
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEEPSEEK_API_KEY          = Deno.env.get("DEEPSEEK_API_KEY")!;
const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchResult {
  result_type:     string;
  filter_category: string;
  result_id:       string;
  member_id:       string;
  member_name:     string;
  title:           string;
  subtitle:        string;
  date_ref:        string | null;
  // añadidos por la Edge Function
  match_score:     number;   // cuántos términos matchearon este resultado
  matched_terms:   string[]; // términos que generaron el match
}

interface DeepSeekExpansion {
  terms:    string[];   // términos alternativos incluyendo el original
  category: string;    // sugerencia de filtro
  intent:   string;    // descripción de lo que el usuario busca
}

// ── DeepSeek: expandir términos médicos ────────────────────────────────────

async function expandQuery(query: string): Promise<DeepSeekExpansion> {
  const systemPrompt = `Eres un asistente médico colombiano experto en terminología clínica latinoamericana.
Tu tarea es expandir consultas de búsqueda en historial médico a múltiples términos sinónimos.

Reglas:
- Incluye el término original SIEMPRE como primer elemento
- Agrega nombres genéricos si el usuario escribió marca (ej: "Dolex" → ["Dolex", "acetaminofén", "paracetamol"])
- Agrega sinónimos clínicos y abreviaturas comunes (ej: "presión alta" → ["presión alta", "hipertensión", "HTA", "hipertensión arterial"])
- Agrega variaciones de escritura (con/sin tildes, siglas)
- Máximo 5 términos en total
- category: "all" | "medication" | "diagnosis" | "doctor" | "specialist" | "test" | "member"
- intent: frase corta describiendo qué busca el usuario

Responde ÚNICAMENTE con JSON válido.`;

  const userPrompt = `Busca en historial médico: "${query}"

Devuelve JSON:
{
  "terms": ["${query}", "sinónimo1", "sinónimo2"],
  "category": "all",
  "intent": "descripción corta"
}`;

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model:           "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
        temperature:     0.2,
        max_tokens:      300,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) throw new Error(`DeepSeek ${response.status}`);

    const result  = await response.json();
    const content = result.choices?.[0]?.message?.content;
    const parsed  = JSON.parse(content) as DeepSeekExpansion;

    // Asegurar que el término original siempre esté
    if (!parsed.terms.includes(query)) parsed.terms.unshift(query);
    // Limitar a 5 términos
    parsed.terms = [...new Set(parsed.terms)].slice(0, 5);

    return parsed;
  } catch (err) {
    console.warn("DeepSeek expansion failed, usando query original:", err);
    return { terms: [query], category: "all", intent: query };
  }
}

// ── Handler principal ──────────────────────────────────────────────────────

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
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { query, limit = 30 } = await req.json();

    if (!query?.trim()) {
      return new Response(JSON.stringify({ results: [], expansion: null }), {
        status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Cliente con JWT del usuario (respeta RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // 1. Expandir query con DeepSeek
    const expansion = await expandQuery(query.trim());

    // 2. Ejecutar search_global para cada término expandido
    const allResults = new Map<string, SearchResult>();

    await Promise.all(
      expansion.terms.map(async (term) => {
        const { data, error } = await supabase.rpc("search_global", {
          p_query: term,
          p_limit: limit,
        });

        if (error) {
          console.error(`search_global error for term "${term}":`, error.message);
          return;
        }

        for (const row of (data ?? [])) {
          const key = `${row.result_type}:${row.result_id}:${row.filter_category}`;

          if (allResults.has(key)) {
            // Ya existe: incrementar score y agregar término
            const existing = allResults.get(key)!;
            existing.match_score += 1;
            if (!existing.matched_terms.includes(term)) {
              existing.matched_terms.push(term);
            }
          } else {
            allResults.set(key, {
              ...row,
              match_score:   1,
              matched_terms: [term],
            });
          }
        }
      })
    );

    // 3. Convertir a array, ordenar por score desc → fecha desc
    const results = Array.from(allResults.values())
      .sort((a, b) => {
        if (b.match_score !== a.match_score) return b.match_score - a.match_score;
        const da = a.date_ref ? new Date(a.date_ref).getTime() : 0;
        const db = b.date_ref ? new Date(b.date_ref).getTime() : 0;
        return db - da;
      })
      .slice(0, limit);

    return new Response(
      JSON.stringify({ results, expansion }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("search-ai error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
