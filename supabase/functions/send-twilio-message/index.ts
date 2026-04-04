import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Channel = "whatsapp" | "sms";

type SendTwilioMessageRequest = {
  channel?: Channel;
  to?: string | null;
  body?: string | null;
  contentSid?: string | null;
  contentVariables?: Record<string, string | number | boolean> | null;
  from?: string | null;
  messagingServiceSid?: string | null;
  useProfilePhone?: boolean;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const DEFAULT_WHATSAPP_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "whatsapp:+14155238886";
const DEFAULT_SMS_FROM = Deno.env.get("TWILIO_SMS_FROM") ?? "";
const DEFAULT_SMS_MESSAGING_SERVICE_SID = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") ?? "";
const DEFAULT_WHATSAPP_CONTENT_SID = Deno.env.get("TWILIO_DEFAULT_WHATSAPP_CONTENT_SID") ?? "";
const INTERNAL_SECRET = Deno.env.get("INTERNAL_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/[^\d+]/g, "");
  if (normalized.startsWith("00")) {
    normalized = `+${normalized.slice(2)}`;
  }

  if (!normalized.startsWith("+")) {
    const digitsOnly = normalized.replace(/\D/g, "");
    if (/^3\d{9}$/.test(digitsOnly)) {
      normalized = `+57${digitsOnly}`;
    } else if (/^\d{8,15}$/.test(digitsOnly)) {
      normalized = `+${digitsOnly}`;
    }
  }

  return /^\+\d{8,15}$/.test(normalized) ? normalized : null;
}

function channelPrefix(channel: Channel, phone: string): string {
  return channel === "whatsapp" ? `whatsapp:${phone}` : phone;
}

function getAuthorizationHeader(): string {
  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  return `Basic ${credentials}`;
}

async function getAuthenticatedUser(authHeader: string | null) {
  if (!authHeader) return { user: null, client: null, error: "Missing Authorization header" };
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { user: null, client: null, error: "Supabase auth environment is incomplete" };

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error || !user) {
    return { user: null, client, error: error?.message ?? "Invalid user session" };
  }

  return { user, client, error: null };
}

async function resolveRecipientPhone(params: {
  authHeader: string | null;
  requestedTo: string | null;
  useProfilePhone: boolean;
  internalSecretValid: boolean;
}) {
  if (params.internalSecretValid) {
    const directPhone = normalizePhone(params.requestedTo);
    if (!directPhone) {
      return { phone: null, error: "Debes enviar 'to' en formato internacional válido (ej. +573001112233)." };
    }
    return { phone: directPhone, error: null };
  }

  const auth = await getAuthenticatedUser(params.authHeader);
  if (auth.error || !auth.user || !auth.client) {
    return { phone: null, error: auth.error ?? "No pudimos autenticar la sesión" };
  }

  const { data: profile, error } = await auth.client
    .from("profiles")
    .select("phone")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error) {
    return { phone: null, error: error.message };
  }

  const profilePhone = normalizePhone(profile?.phone ?? null);
  if (!profilePhone) {
    return {
      phone: null,
      error: "Tu perfil no tiene un número válido. Guárdalo en Perfil usando formato +57...",
    };
  }

  if (!params.requestedTo || params.useProfilePhone) {
    return { phone: profilePhone, error: null };
  }

  const requestedPhone = normalizePhone(params.requestedTo);
  if (!requestedPhone) {
    return { phone: null, error: "El número solicitado no tiene un formato válido." };
  }

  if (requestedPhone !== profilePhone) {
    return {
      phone: null,
      error: "Solo puedes enviar mensajes de prueba a tu propio número configurado en Perfil.",
    };
  }

  return { phone: requestedPhone, error: null };
}

async function sendTwilioMessage(params: {
  channel: Channel;
  phone: string;
  body?: string | null;
  contentSid?: string | null;
  contentVariables?: Record<string, string | number | boolean> | null;
  from?: string | null;
  messagingServiceSid?: string | null;
}) {
  const payload = new URLSearchParams();

  const to = channelPrefix(params.channel, params.phone);
  payload.set("To", to);

  if (params.messagingServiceSid) {
    payload.set("MessagingServiceSid", params.messagingServiceSid);
  } else if (params.from) {
    payload.set("From", params.from);
  } else {
    throw new Error("No hay un sender configurado para Twilio.");
  }

  if (params.contentSid) {
    payload.set("ContentSid", params.contentSid);
    if (params.contentVariables && Object.keys(params.contentVariables).length > 0) {
      payload.set("ContentVariables", JSON.stringify(params.contentVariables));
    }
  } else if (params.body?.trim()) {
    payload.set("Body", params.body.trim());
  } else {
    throw new Error("Debes enviar 'body' o 'contentSid' para crear el mensaje.");
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: getAuthorizationHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    },
  );

  const raw = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: (data?.message as string | undefined) ?? raw ?? "Twilio request failed",
      code: data?.code ?? null,
      moreInfo: data?.more_info ?? null,
    };
  }

  return {
    ok: true,
    status: response.status,
    sid: data?.sid ?? null,
    twilioStatus: data?.status ?? null,
    to: data?.to ?? to,
    from: data?.from ?? params.from ?? null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return jsonResponse(
      { error: "Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN en los secrets de Supabase." },
      500,
    );
  }

  let body: SendTwilioMessageRequest;
  try {
    body = (await req.json()) as SendTwilioMessageRequest;
  } catch {
    return jsonResponse({ error: "El body debe ser JSON válido." }, 400);
  }

  const channel: Channel = body.channel === "sms" ? "sms" : "whatsapp";
  const internalSecretValid = INTERNAL_SECRET.length > 0 && req.headers.get("x-internal-secret") === INTERNAL_SECRET;
  const authHeader = req.headers.get("Authorization");

  const recipient = await resolveRecipientPhone({
    authHeader,
    requestedTo: body.to ?? null,
    useProfilePhone: body.useProfilePhone !== false,
    internalSecretValid,
  });

  if (recipient.error || !recipient.phone) {
    return jsonResponse({ error: recipient.error ?? "No se pudo resolver el destinatario." }, 403);
  }

  const defaultFrom = channel === "whatsapp" ? DEFAULT_WHATSAPP_FROM : DEFAULT_SMS_FROM;
  const defaultMessagingServiceSid = channel === "sms" ? DEFAULT_SMS_MESSAGING_SERVICE_SID : null;
  const contentSid = body.contentSid ?? (channel === "whatsapp" ? DEFAULT_WHATSAPP_CONTENT_SID || null : null);
  const bodyText = body.body ?? null;

  if (channel === "sms" && !bodyText?.trim() && !contentSid) {
    return jsonResponse({ error: "Para SMS debes enviar un 'body' o configurar un template válido." }, 400);
  }

  if (channel === "whatsapp" && !contentSid && !bodyText?.trim()) {
    return jsonResponse(
      { error: "Para WhatsApp envía 'body' o configura TWILIO_DEFAULT_WHATSAPP_CONTENT_SID." },
      400,
    );
  }

  try {
    const result = await sendTwilioMessage({
      channel,
      phone: recipient.phone,
      body: bodyText,
      contentSid,
      contentVariables: body.contentVariables ?? null,
      from: body.from ?? defaultFrom,
      messagingServiceSid: body.messagingServiceSid ?? defaultMessagingServiceSid,
    });

    if (!result.ok) {
      console.error("Twilio send failed", result);
      return jsonResponse(result, 502);
    }

    console.log("Twilio message sent", {
      channel,
      to: recipient.phone,
      sid: result.sid,
      authenticated: !internalSecretValid,
    });

    return jsonResponse({
      ok: true,
      channel,
      sid: result.sid,
      status: result.twilioStatus,
      to: recipient.phone,
      sandbox: DEFAULT_WHATSAPP_FROM === "whatsapp:+14155238886",
    });
  } catch (error) {
    console.error("send-twilio-message error", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "No pudimos enviar el mensaje." },
      500,
    );
  }
});
