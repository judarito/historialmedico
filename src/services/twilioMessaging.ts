import { FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type TwilioChannel = 'whatsapp' | 'sms';

export interface SendTwilioMessageRequest {
  channel?: TwilioChannel;
  to?: string | null;
  body?: string | null;
  contentSid?: string | null;
  contentVariables?: Record<string, string | number | boolean> | null;
  useProfilePhone?: boolean;
}

export interface SendTwilioMessageResponse {
  ok: boolean;
  channel: TwilioChannel;
  sid: string | null;
  status: string | null;
  to: string;
  sandbox?: boolean;
}

async function extractFunctionError(error: FunctionsHttpError | FunctionsRelayError): Promise<string> {
  try {
    const context = error.context;
    if (!context) return error.message;
    if (typeof (context as Response).json === 'function') {
      const payload = await (context as Response).json();
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        return payload.error;
      }
      if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message;
      }
    }
  } catch {
    // dejamos el mensaje original
  }

  return error.message;
}

export async function sendTwilioMessage(
  payload: SendTwilioMessageRequest,
): Promise<SendTwilioMessageResponse> {
  const { data, error } = await supabase.functions.invoke('send-twilio-message', {
    body: payload,
  });

  if (error) {
    if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
      throw new Error(await extractFunctionError(error));
    }
    throw new Error(error.message);
  }

  return data as SendTwilioMessageResponse;
}

export async function sendWhatsAppTestToMyPhone(): Promise<SendTwilioMessageResponse> {
  const now = new Date();
  const dateText = now.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'numeric',
  });
  const timeText = now.toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return sendTwilioMessage({
    channel: 'whatsapp',
    useProfilePhone: true,
    body: `Prueba de WhatsApp desde Family Health Tracker el ${dateText} a las ${timeText}.`,
    contentVariables: {
      1: dateText,
      2: timeText,
    },
  });
}
