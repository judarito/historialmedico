import { useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useFamilyStore } from '../../store/familyStore';
import { useNotificationStore, type NotificationItem } from '../../store/notificationStore';
import { Colors, Radius, Spacing, Typography } from '../../theme';

function getNotificationIcon(type: NotificationItem['reminder_type']): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'appointment':
      return 'calendar-outline';
    case 'medical_test':
      return 'flask-outline';
    case 'medication_dose':
    case 'dose_overdue':
    case 'treatment_ending':
      return 'medkit-outline';
    default:
      return 'notifications-outline';
  }
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildNotificationRoute(item: NotificationItem) {
  if (item.medical_visit_id) {
    return {
      pathname: '/(app)/visit/[id]' as const,
      params: { id: item.medical_visit_id },
    };
  }

  if (item.family_member_id) {
    return {
      pathname: '/(app)/member/[id]' as const,
      params: { id: item.family_member_id },
    };
  }

  return null;
}

export default function NotificationsScreen() {
  const tenant = useFamilyStore((state) => state.tenant);
  const {
    items,
    unreadCount,
    loading,
    refresh,
    markAsRead,
    markAllAsRead,
  } = useNotificationStore();

  useFocusEffect(useCallback(() => {
    if (!tenant?.id) return;
    void refresh();
  }, [refresh, tenant?.id]));

  async function handleMarkAll() {
    const error = await markAllAsRead();
    if (error) {
      Alert.alert('No se pudo actualizar', error);
    }
  }

  async function handleOpen(item: NotificationItem) {
    if (!item.is_read) {
      const error = await markAsRead(item.reminder_id);
      if (error) {
        Alert.alert('No se pudo actualizar', error);
        return;
      }
    }

    const route = buildNotificationRoute(item);
    if (route) {
      router.push(route);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Notificaciones</Text>
          <Text style={styles.headerSub}>
            {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todo al dia'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.markAllBtn, unreadCount === 0 && styles.markAllBtnDisabled]}
          onPress={() => { void handleMarkAll(); }}
          disabled={unreadCount === 0}
          activeOpacity={0.8}
        >
          <Ionicons name="checkmark-done-outline" size={18} color={unreadCount === 0 ? Colors.textMuted : Colors.primary} />
        </TouchableOpacity>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.reminder_id}
          contentContainerStyle={items.length === 0 ? styles.emptyListContent : styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, !item.is_read && styles.cardUnread]}
              activeOpacity={0.8}
              onPress={() => { void handleOpen(item); }}
            >
              <View style={[styles.iconWrap, !item.is_read && styles.iconWrapUnread]}>
                <Ionicons name={getNotificationIcon(item.reminder_type)} size={20} color={item.is_read ? Colors.textSecondary : Colors.primary} />
              </View>

              <View style={styles.cardBody}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                  {!item.is_read && <View style={styles.unreadDot} />}
                </View>

                {!!item.message && (
                  <Text style={styles.cardMessage} numberOfLines={2}>
                    {item.message}
                  </Text>
                )}

                <View style={styles.cardMetaRow}>
                  <Text style={styles.cardMeta}>
                    {item.family_member_name ?? 'Familiar'}
                  </Text>
                  <Text style={styles.cardMeta}>•</Text>
                  <Text style={styles.cardMeta}>{formatDateTime(item.remind_at)}</Text>
                </View>
              </View>

              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={(
            <View style={styles.centerState}>
              <Ionicons name="notifications-off-outline" size={36} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Sin notificaciones todavia</Text>
              <Text style={styles.emptyText}>
                Aqui apareceran recordatorios de citas, medicamentos y examenes.
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerCenter: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
  },
  headerSub: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },
  markAllBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '14',
    borderWidth: 1,
    borderColor: Colors.primary + '22',
  },
  markAllBtnDisabled: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
  },
  listContent: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.sm,
  },
  emptyListContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.base,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  cardUnread: {
    borderColor: Colors.primary + '44',
    backgroundColor: Colors.primary + '10',
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  iconWrapUnread: {
    backgroundColor: Colors.primary + '18',
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  cardTitle: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.bold,
  },
  cardMessage: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardMeta: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.bold,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
