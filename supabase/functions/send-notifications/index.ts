// ============================================================
// Edge Function: send-notifications (schema real)
// Usa reminder_status enum: pending / sent / read / dismissed / failed
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_PUSH_URL             = "https://exp.host/--/api/v2/push/send";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Reminder {
  id: string;
  tenant_id: string;
  family_member_id: string;
  reminder_type: string;
  title: string;
  message: string | null;
  remind_at: string;
  prescription_id: string | null;
  medication_schedule_id: string | null;
  medical_test_id: string | null;
  // Join con profiles para obtener push_token
  family_members: {
    tenant_id: string;
    family_id: string;
  } | null;
}

interface ProfilePushToken {
  push_token: string | null;
  family_member_id: string;
}

async function sendExpoBatch(messages: object[]) {
  if (messages.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  const receipts: unknown[] = [];
  for (const chunk of chunks) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) {
        const data = await res.json();
        receipts.push(...(data.data || []));
      }
    } catch (e) {
      console.error("Error enviando chunk a Expo:", e);
    }
  }
  return receipts;
}

serve(async (req) => {
  const secret = req.headers.get("x-internal-secret");
  if (secret !== Deno.env.get("INTERNAL_SECRET")) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const now         = new Date();
    const windowStart = new Date(now.getTime() - 5 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + 5 * 60 * 1000);

    // Obtener recordatorios pendientes en ventana de ±5min
    // reminder_status = 'pending' (columna status en schema real)
    const { data: reminders, error } = await supabase
      .from("reminders")
      .select(`
        id, tenant_id, family_member_id,
        reminder_type, title, message,
        remind_at,
        prescription_id, medication_schedule_id, medical_test_id
      `)
      .eq("status", "pending")         // enum reminder_status
      .gte("remind_at", windowStart.toISOString())
      .lte("remind_at", windowEnd.toISOString())
      .limit(200) as { data: Reminder[] | null; error: unknown };

    if (error) throw error;
    if (!reminders || reminders.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // Obtener push tokens de los usuarios responsables de cada familiar
    // Buscamos en profiles el push_token de quien tenga acceso al tenant
    const memberIds = [...new Set(reminders.map(r => r.family_member_id))];
    const tenantIds = [...new Set(reminders.map(r => r.tenant_id))];

    // Obtener user_ids de los tenants relevantes
    const { data: tenantUsers } = await supabase
      .from("tenant_users")
      .select("tenant_id, user_id")
      .in("tenant_id", tenantIds)
      .eq("is_active", true);

    if (!tenantUsers) {
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const userIds = [...new Set(tenantUsers.map(tu => tu.user_id))];

    // Obtener push tokens de esos usuarios
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, push_token, tenant_id")
      .in("id", userIds)
      .not("push_token", "is", null);

    const tokensByTenant = new Map<string, string[]>();
    if (profiles) {
      for (const p of profiles) {
        if (p.push_token && p.tenant_id) {
          if (!tokensByTenant.has(p.tenant_id)) {
            tokensByTenant.set(p.tenant_id, []);
          }
          tokensByTenant.get(p.tenant_id)!.push(p.push_token);
        }
      }
    }

    // Construir mensajes Expo
    const messages: object[] = [];
    const reminderIdsToUpdate: string[] = [];

    for (const reminder of reminders) {
      const tokens = tokensByTenant.get(reminder.tenant_id) || [];
      for (const token of tokens) {
        if (!token.startsWith("ExponentPushToken[")) continue;

        messages.push({
          to:       token,
          title:    reminder.title,
          body:     reminder.message || "",
          sound:    "default",
          priority: "high",
          data: {
            type:                   reminder.reminder_type,
            prescription_id:        reminder.prescription_id,
            medication_schedule_id: reminder.medication_schedule_id,
            medical_test_id:        reminder.medical_test_id,
            family_member_id:       reminder.family_member_id,
            tenant_id:              reminder.tenant_id,
          }
        });
      }
      reminderIdsToUpdate.push(reminder.id);
    }

    // Enviar a Expo
    const receipts = await sendExpoBatch(messages);

    // Actualizar status a 'sent' (enum reminder_status real)
    if (reminderIdsToUpdate.length > 0) {
      await supabase
        .from("reminders")
        .update({
          status:       "sent",
          sent_at:      now.toISOString(),
          push_receipt: receipts,
        })
        .in("id", reminderIdsToUpdate);
    }

    console.log(`Enviadas ${messages.length} notificaciones para ${reminderIdsToUpdate.length} recordatorios`);

    return new Response(
      JSON.stringify({ sent: messages.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Error en send-notifications:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Error interno" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
