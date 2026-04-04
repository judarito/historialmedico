import { FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface HealthAgentVisitLink {
  visit_id: string;
  title: string;
  visit_date: string;
  reason: string;
}

export interface HealthAgentFamilyMember {
  id: string;
  name: string;
}

export interface HealthAgentResponse {
  answer: string;
  family_member: HealthAgentFamilyMember | null;
  matched_visits: HealthAgentVisitLink[];
  confidence: number;
  warnings: string[];
}

const AGENT_PATTERNS = [
  /\?/,
  /\bcuando\b/i,
  /\bcu[aá]ndo\b/i,
  /\bcual\b/i,
  /\bcu[aá]l\b/i,
  /\bque\b/i,
  /\bqu[eé]\b/i,
  /\bresume\b/i,
  /\bresumen\b/i,
  /\bhistoria medica\b/i,
  /\bhistoria m[eé]dica\b/i,
  /\bultima\b/i,
  /\búltima\b/i,
  /\bultimo\b/i,
  /\búltimo\b/i,
  /\bpendiente\b/i,
  /\bpendientes\b/i,
  /\bactualmente\b/i,
  /\btratamientos\b/i,
  /\bdosis\b/i,
  /\bdiagnostico\b/i,
  /\bdiagn[oó]stico\b/i,
];

export function looksLikeHealthAgentQuestion(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (trimmed.split(/\s+/).length >= 6) return true;
  return AGENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export async function askHealthAgent(question: string, familyMemberId?: string | null): Promise<HealthAgentResponse> {
  const { data, error } = await supabase.functions.invoke('ask-health-agent', {
    body: {
      question,
      familyMemberId: familyMemberId ?? null,
    },
  });

  if (error) {
    if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
      const rawText = await error.context.text().catch(() => '');
      if (rawText) {
        try {
          const payload = JSON.parse(rawText);
          throw new Error(payload?.error || payload?.message || rawText);
        } catch {
          throw new Error(rawText);
        }
      }
    }
    throw new Error(error.message || 'No se pudo consultar el agente médico');
  }

  return data as HealthAgentResponse;
}
