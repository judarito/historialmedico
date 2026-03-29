// ============================================================
// Pantalla 2: Dashboard — "Hola, Andrea"
// Resumen de salud + Estado de la familia
// ============================================================
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatCard } from '../components/ui/StatCard';
import { FamilyMemberRow } from '../components/family/FamilyMemberRow';
import { Avatar } from '../components/ui/Avatar';
import { Colors, Typography, Spacing, Radius } from '../theme';
import { Icons } from '../assets';

// Tipado de datos del dashboard (vendrá de Supabase en implementación real)
interface DashboardMember {
  id:         string;
  name:       string;
  statusText: string;
  status:     'alert' | 'warning' | 'healthy' | 'neutral';
  avatarUrl?: string | null;
}

interface DashboardScreenProps {
  userName:      string;
  avatarUrl?:    string | null;
  appointments:  number;
  reminders:     number;
  steps:         number;
  criticalAlerts:number;
  members:       DashboardMember[];
  onMemberPress:   (id: string) => void;
  onNotifications: () => void;
  onSearch:        () => void;
}

export function DashboardScreen({
  userName,
  avatarUrl,
  appointments,
  reminders,
  steps,
  criticalAlerts,
  members,
  onMemberPress,
  onNotifications,
  onSearch,
}: DashboardScreenProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>Hola, {userName}</Text>
            <Text style={styles.date}>{getTodayLabel()}</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.notifBtn} onPress={onNotifications}>
              <Ionicons name="notifications-outline" size={22} color={Colors.textPrimary} />
              {reminders > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{reminders}</Text>
                </View>
              )}
            </TouchableOpacity>
            <Avatar name={userName} imageUrl={avatarUrl} size={38} />
          </View>
        </View>

        {/* Barra de búsqueda */}
        <TouchableOpacity style={styles.searchBar} onPress={onSearch} activeOpacity={0.75}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
          <Text style={styles.searchBarPlaceholder}>Buscar medicina, médico, diagnóstico...</Text>
          <View style={styles.searchBarBadge}>
            <Ionicons name="sparkles" size={12} color={Colors.primary} />
            <Text style={styles.searchBarBadgeText}>IA</Text>
          </View>
        </TouchableOpacity>

        {/* Resumen de Salud */}
        <Text style={styles.sectionTitle}>Resumen de Salud</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <StatCard
              icon={Icons.calendar}
              iconBg={Colors.infoBg}
              label="Citas Médicas"
              value={String(appointments)}
              sublabel="Próximas"
              sublabelColor={Colors.info}
            />
            <View style={styles.statGap} />
            <StatCard
              icon={Icons.bell}
              iconBg={Colors.warningBg}
              label="Recordatorios"
              value={String(reminders)}
              sublabel="Alertas"
              sublabelColor={Colors.warning}
            />
          </View>
          <View style={[styles.statsRow, { marginTop: Spacing.sm }]}>
            <StatCard
              icon={Icons.heartrate}
              iconBg={Colors.healthyBg}
              label="Medicamentos"
              value={steps.toLocaleString('es-CO')}
              sublabel="Activos"
              sublabelColor={Colors.healthy}
            />
            <View style={styles.statGap} />
            <StatCard
              icon={Icons.heart}
              iconBg={Colors.alertBg}
              label="Salud General"
              value={String(criticalAlerts)}
              sublabel={criticalAlerts > 0 ? "Alertas Críticas" : "Todo bien"}
              sublabelColor={criticalAlerts > 0 ? Colors.alert : Colors.healthy}
            />
          </View>
        </View>

        {/* Estado de la Familia */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Estado de la Familia</Text>
          <TouchableOpacity>
            <Text style={styles.seeAll}>Ver todo</Text>
          </TouchableOpacity>
        </View>

        {members.map(member => (
          <FamilyMemberRow
            key={member.id}
            name={member.name}
            statusText={member.statusText}
            status={member.status}
            avatarUrl={member.avatarUrl}
            onPress={() => onMemberPress(member.id)}
          />
        ))}

        {/* Espacio inferior para tab bar */}
        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  headerLeft: {
    gap: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  greeting: {
    color: Colors.textPrimary,
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
  },
  date: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    textTransform: 'capitalize',
  },
  notifBtn: {
    position: 'relative',
    width: 38,
    height: 38,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.alert,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: Colors.white,
    fontSize: 9,
    fontWeight: Typography.bold,
  },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 48,
    marginBottom: Spacing.xl,
  },
  searchBarPlaceholder: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: Typography.base,
  },
  searchBarBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primary + '15',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  searchBarBadgeText: {
    color: Colors.primary,
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
  },

  // Stats
  statsGrid: {
    marginBottom: Spacing.xl,
  },
  statsRow: {
    flexDirection: 'row',
  },
  statGap: {
    width: Spacing.sm,
  },

  // Sección
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
    marginBottom: Spacing.md,
  },
  seeAll: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    marginBottom: Spacing.md,
  },
});
