import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { captureException } from '../services/runtimeDiagnostics';
import type { Database } from '../types/database.types';

export type NotificationItem = Database['public']['Functions']['get_notification_feed']['Returns'][number];

let notificationsChannel: RealtimeChannel | null = null;

function teardownChannel() {
  if (!notificationsChannel) return;
  supabase.removeChannel(notificationsChannel);
  notificationsChannel = null;
}

interface NotificationState {
  tenantId: string | null;
  userId: string | null;
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  initialized: boolean;

  initialize: (tenantId: string, userId: string) => Promise<void>;
  refresh: () => Promise<void>;
  markAsRead: (reminderId: string) => Promise<string | null>;
  markAllAsRead: () => Promise<string | null>;
  reset: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  tenantId: null,
  userId: null,
  items: [],
  unreadCount: 0,
  loading: false,
  initialized: false,

  initialize: async (tenantId, userId) => {
    const sameSubscription =
      get().tenantId === tenantId &&
      get().userId === userId &&
      notificationsChannel !== null;

    set({ tenantId, userId, initialized: true });
    await get().refresh();

    if (sameSubscription) return;

    teardownChannel();

    notificationsChannel = supabase
      .channel(`notifications:${tenantId}:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reminders',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void useNotificationStore.getState().refresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notification_reads',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void useNotificationStore.getState().refresh();
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          void captureException('notificationStore.subscribe', new Error(`Realtime status=${status}`), {
            extra: { tenantId, userId },
          });
        }
      });
  },

  refresh: async () => {
    const { tenantId } = get();
    if (!tenantId) {
      set({ items: [], unreadCount: 0, loading: false });
      return;
    }

    set({ loading: true });

    try {
      const [{ data: feedData, error: feedError }, { data: unreadData, error: unreadError }] = await Promise.all([
        supabase.rpc('get_notification_feed', {
          p_tenant_id: tenantId,
          p_limit: 50,
        }),
        supabase.rpc('get_unread_notification_count', {
          p_tenant_id: tenantId,
        }),
      ]);

      if (feedError) throw feedError;
      if (unreadError) throw unreadError;

      set({
        items: feedData ?? [],
        unreadCount: unreadData ?? 0,
        loading: false,
      });
    } catch (error) {
      await captureException('notificationStore.refresh', error, {
        extra: { tenantId },
      });
      set({ items: [], unreadCount: 0, loading: false });
    }
  },

  markAsRead: async (reminderId) => {
    const target = get().items.find((item) => item.reminder_id === reminderId);
    if (!target || target.is_read) return null;

    try {
      const { error } = await supabase.rpc('mark_notification_as_read', {
        p_reminder_id: reminderId,
      });
      if (error) return error.message;

      const readAt = new Date().toISOString();
      set((state) => ({
        items: state.items.map((item) => (
          item.reminder_id === reminderId
            ? { ...item, is_read: true, read_at: item.read_at ?? readAt }
            : item
        )),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }));
      return null;
    } catch (error) {
      await captureException('notificationStore.markAsRead', error, {
        extra: { reminderId },
      });
      return error instanceof Error ? error.message : 'No se pudo marcar la notificacion como leida';
    }
  },

  markAllAsRead: async () => {
    const { tenantId, unreadCount } = get();
    if (!tenantId || unreadCount === 0) return null;

    try {
      const { error } = await supabase.rpc('mark_all_notifications_as_read', {
        p_tenant_id: tenantId,
      });
      if (error) return error.message;

      const readAt = new Date().toISOString();
      set((state) => ({
        items: state.items.map((item) => (
          item.is_read ? item : { ...item, is_read: true, read_at: item.read_at ?? readAt }
        )),
        unreadCount: 0,
      }));
      return null;
    } catch (error) {
      await captureException('notificationStore.markAllAsRead', error, {
        extra: { tenantId },
      });
      return error instanceof Error ? error.message : 'No se pudieron marcar las notificaciones';
    }
  },

  reset: () => {
    teardownChannel();
    set({
      tenantId: null,
      userId: null,
      items: [],
      unreadCount: 0,
      loading: false,
      initialized: false,
    });
  },
}));
