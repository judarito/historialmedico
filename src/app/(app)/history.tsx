import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../services/supabase';
import { searchMemberHistoryLocal } from '../../services/searchFallback';
import { Colors, Radius, Spacing, Typography } from '../../theme';

// ── Types ──────────────────────────────────────────────────────────────────

type VisitStatus       = 'draft' | 'scheduled' | 'completed' | 'cancelled';
type PrescriptionStatus = 'active' | 'completed' | 'paused' | 'cancelled';
type TestStatus        = 'pending' | 'scheduled' | 'completed' | 'result_uploaded' | 'cancelled';

interface MedicalVisit {
  id: string;
  visit_date: string;
  doctor_name: string | null;
  specialty: string | null;
  institution_name: string | null;
  reason_for_visit: string | null;
  diagnosis: string | null;
  notes: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  temperature_c: number | null;
  blood_pressure: string | null;
  heart_rate: number | null;
  status: VisitStatus;
  created_at: string;
}

interface Prescription {
  id: string;
  medical_visit_id: string | null;
  medication_name: string;
  presentation: string | null;
  dose_amount: string | number | null;
  dose_unit: string | null;
  frequency_text: string | null;
  instructions: string | null;
  start_at: string | null;
  end_at: string | null;
  status: PrescriptionStatus;
  created_at: string;
}

interface MedicalTest {
  id: string;
  medical_visit_id: string | null;
  test_name: string;
  category: string | null;
  ordered_at: string | null;
  due_at: string | null;
  notes: string | null;
  status: TestStatus;
  created_at: string;
}

interface SearchResult {
  result_type: string;
  result_id: string;
  title: string;
  subtitle: string;
  date_ref: string | null;
}

type TabKey = 'visits' | 'medications' | 'exams';

function sortVisitsByDateDesc(visits: MedicalVisit[]): MedicalVisit[] {
  return [...visits].sort((a, b) => {
    const aTime = a.visit_date ? new Date(a.visit_date).getTime() : 0;
    const bTime = b.visit_date ? new Date(b.visit_date).getTime() : 0;
    return bTime - aTime;
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function truncate(str: string | null | undefined, max = 60): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function PrescriptionBadge({ status }: { status: PrescriptionStatus }) {
  const map: Record<PrescriptionStatus, { label: string; color: string; bg: string }> = {
    active:    { label: 'Activo',     color: Colors.healthy, bg: Colors.healthyBg },
    completed: { label: 'Completado', color: Colors.textMuted, bg: Colors.surface },
    paused:    { label: 'Pausado',    color: Colors.warning, bg: Colors.warningBg },
    cancelled: { label: 'Cancelado',  color: Colors.alert,   bg: Colors.alertBg  },
  };
  const s = map[status] ?? map.completed;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg, borderColor: s.color }]}>
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

function TestBadge({ status }: { status: TestStatus }) {
  const map: Record<TestStatus, { label: string; color: string; bg: string }> = {
    pending:         { label: 'Pendiente',  color: Colors.warning,       bg: Colors.warningBg },
    scheduled:       { label: 'Agendado',   color: Colors.info,          bg: Colors.infoBg    },
    completed:       { label: 'Completado', color: Colors.healthy,       bg: Colors.healthyBg },
    result_uploaded: { label: 'Resultado',  color: Colors.primary,       bg: Colors.infoBg    },
    cancelled:       { label: 'Cancelado',  color: Colors.alert,         bg: Colors.alertBg   },
  };
  const s = map[status] ?? map.pending;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg, borderColor: s.color }]}>
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

function SearchResultIcon({ type }: { type: string }) {
  const icon =
    type === 'visit'      ? '📅' :
    type === 'medication' ? '💊' :
    type === 'test' || type === 'exam' ? '🧪' : '📄';
  return <Text style={styles.searchResultIcon}>{icon}</Text>;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const { memberId, memberName } = useLocalSearchParams<{
    memberId: string;
    memberName: string;
  }>();

  const [activeTab, setActiveTab]           = useState<TabKey>('visits');
  const [loading, setLoading]               = useState(true);

  const [visits, setVisits]                 = useState<MedicalVisit[]>([]);
  const [prescriptions, setPrescriptions]   = useState<Prescription[]>([]);
  const [tests, setTests]                   = useState<MedicalTest[]>([]);

  const [searchQuery, setSearchQuery]       = useState('');
  const [searchResults, setSearchResults]   = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading]   = useState(false);
  const debounceRef                         = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── data loading ──────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);

    const [visitsRes, prescRes, testsRes] = await Promise.all([
      supabase
        .from('medical_visits')
        .select('*')
        .eq('family_member_id', memberId)
        .is('deleted_at', null)
        .order('visit_date', { ascending: false }),
      supabase
        .from('prescriptions')
        .select('*')
        .eq('family_member_id', memberId)
        .order('created_at', { ascending: false }),
      supabase
        .from('medical_tests')
        .select('*')
        .eq('family_member_id', memberId)
        .order('created_at', { ascending: false }),
    ]);

    setVisits(sortVisitsByDateDesc((visitsRes.data as MedicalVisit[] | null) ?? []));
    setPrescriptions((prescRes.data as Prescription[]) ?? []);
    setTests((testsRes.data as MedicalTest[]) ?? []);
    setLoading(false);
  }, [memberId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── search ────────────────────────────────────────────────────────────

  // Construye un resumen compacto de los datos ya cargados en memoria
  // para alimentar a DeepSeek solo cuando la búsqueda determinística falla.
  function buildMemberContext(): string {
    const parts: string[] = [];

    const visitSummaries = visits.slice(0, 20)
      .map(v => [v.diagnosis, v.reason_for_visit, v.doctor_name, v.specialty].filter(Boolean).join(', '))
      .filter(Boolean);
    if (visitSummaries.length > 0)
      parts.push(`Visitas: ${visitSummaries.join(' | ')}`);

    const medNames = [...new Set(prescriptions.map(p => p.medication_name))].slice(0, 25);
    if (medNames.length > 0)
      parts.push(`Medicamentos: ${medNames.join(', ')}`);

    const testNames = [...new Set(tests.map(t => t.test_name))].slice(0, 25);
    if (testNames.length > 0)
      parts.push(`Exámenes: ${testNames.join(', ')}`);

    return parts.join('\n');
  }

  async function runSearch(q: string) {
    setSearchLoading(true);
    setSearchResults([]);

    const localResults = searchMemberHistoryLocal({
      query: q,
      visits,
      prescriptions,
      tests,
    });

    if (localResults.length > 0) {
      setSearchResults(localResults as SearchResult[]);
      setSearchLoading(false);
      return;
    }

    // Fase 1: búsqueda determinística directa en BD
    const { data: directData } = await supabase.rpc('search_medical_history', {
      p_family_member_id: memberId,
      p_query: q,
    });

    if (directData && directData.length > 0) {
      setSearchResults(directData as SearchResult[]);
      setSearchLoading(false);
      return;
    }

    // Fase 2: sin resultados → llamar IA con contexto del paciente
    // El contexto se construye desde datos ya en memoria (sin llamadas extra a BD)
    const memberContext = buildMemberContext();

    const { data: aiData, error: aiError } = await supabase.functions.invoke('search-ai', {
      body: { query: q, limit: 20, memberContext },
    });

    if (aiError || !aiData?.expansion?.terms) {
      setSearchLoading(false);
      return;
    }

    // Buscar con cada término expandido por la IA
    const seen = new Set<string>();
    const merged: SearchResult[] = [];

    await Promise.all(
      aiData.expansion.terms.map(async (term: string) => {
        const { data: termData } = await supabase.rpc('search_medical_history', {
          p_family_member_id: memberId,
          p_query: term,
        });
        for (const row of (termData as SearchResult[]) ?? []) {
          if (!seen.has(row.result_id)) {
            seen.add(row.result_id);
            merged.push(row);
          }
        }
      })
    );

    merged.sort((a, b) =>
      (b.date_ref ? new Date(b.date_ref).getTime() : 0) -
      (a.date_ref ? new Date(a.date_ref).getTime() : 0)
    );

    setSearchResults(merged);
    setSearchLoading(false);
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(() => runSearch(searchQuery.trim()), 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, memberId]);

  // ── render helpers ────────────────────────────────────────────────────

  function renderVisitItem({ item }: { item: MedicalVisit }) {
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => router.push({ pathname: '/(app)/visit/[id]', params: { id: item.id } })}
      >
        <View style={styles.cardRow}>
          <Text style={styles.cardDate}>{formatDate(item.visit_date)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {item.status === 'scheduled' && (
              <View style={[styles.badge, { backgroundColor: Colors.infoBg, borderColor: Colors.info }]}>
                <Text style={[styles.badgeText, { color: Colors.info }]}>Programada</Text>
              </View>
            )}
            {item.status === 'cancelled' && (
              <View style={[styles.badge, { backgroundColor: Colors.alertBg, borderColor: Colors.alert }]}>
                <Text style={[styles.badgeText, { color: Colors.alert }]}>Cancelada</Text>
              </View>
            )}
            <Text style={styles.chevron}>›</Text>
          </View>
        </View>
        {!!item.doctor_name && (
          <Text style={styles.cardTitle}>{item.doctor_name}</Text>
        )}
        {!!item.specialty && (
          <Text style={styles.cardSubtitle}>{item.specialty}</Text>
        )}
        {!!item.diagnosis && (
          <Text style={styles.cardBody} numberOfLines={2}>
            {truncate(item.diagnosis, 80)}
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  function renderPrescriptionItem({ item }: { item: Prescription }) {
    const dose = [item.dose_amount, item.dose_unit].filter(Boolean).join(' ');
    const range =
      item.start_at && item.end_at
        ? `${formatDate(item.start_at)} → ${formatDate(item.end_at)}`
        : item.start_at
        ? `Desde ${formatDate(item.start_at)}`
        : null;

    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={styles.cardTitle}>{item.medication_name}</Text>
          <PrescriptionBadge status={item.status} />
        </View>
        {!!dose && <Text style={styles.cardSubtitle}>{dose}</Text>}
        {!!item.frequency_text && (
          <Text style={styles.cardBody}>{item.frequency_text}</Text>
        )}
        {!!range && <Text style={styles.cardMeta}>{range}</Text>}
      </View>
    );
  }

  function renderTestItem({ item }: { item: MedicalTest }) {
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={styles.cardTitle}>{item.test_name}</Text>
          <TestBadge status={item.status} />
        </View>
        {!!item.category && (
          <Text style={styles.cardSubtitle}>{item.category}</Text>
        )}
        {!!item.due_at && (
          <Text style={styles.cardMeta}>Fecha límite: {formatDate(item.due_at)}</Text>
        )}
      </View>
    );
  }

  function renderSearchResult({ item }: { item: SearchResult }) {
    const isVisit = item.result_type === 'visit';
    const visitLabel = item.date_ref ? `Visita ${formatDate(item.date_ref)}` : 'Visita vinculada';
    return (
      <TouchableOpacity
        style={styles.searchResultItem}
        activeOpacity={isVisit ? 0.7 : 1}
        onPress={isVisit
          ? () => router.push({ pathname: '/(app)/visit/[id]', params: { id: item.result_id } })
          : undefined
        }
      >
        <SearchResultIcon type={item.result_type} />
        <View style={styles.searchResultText}>
          <Text style={styles.searchResultTitle}>{item.title || '(sin título)'}</Text>
          {!!item.subtitle && <Text style={styles.searchResultSub}>{item.subtitle}</Text>}
          <View style={styles.searchResultMetaRow}>
            <View style={styles.searchMetaChip}>
              <Text style={styles.searchMetaChipText}>{memberName || 'Familiar'}</Text>
            </View>
            <View style={styles.searchMetaChip}>
              <Text style={styles.searchMetaChipText}>{visitLabel}</Text>
            </View>
          </View>
        </View>
        {isVisit && <Text style={styles.chevron}>›</Text>}
      </TouchableOpacity>
    );
  }

  // ── main render ───────────────────────────────────────────────────────

  const showSearch = searchQuery.trim().length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Historial Médico</Text>
            {!!memberName && (
              <Text style={styles.headerSub}>{memberName}</Text>
            )}
          </View>
        </View>

        {/* Search bar */}
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Buscar medicamento, diagnóstico..."
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {searchLoading && (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: Spacing.sm }} />
          )}
        </View>

        {showSearch ? (
          /* ── Search results overlay ── */
          <View style={styles.flex}>
            {searchResults.length === 0 && !searchLoading ? (
              <EmptyState text="Sin resultados para esa búsqueda" />
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={item => item.result_id}
                renderItem={renderSearchResult}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>
        ) : (
          <>
            {/* ── Tabs ── */}
            <View style={styles.tabBar}>
              {(
                [
                  { key: 'visits',      label: 'Visitas'       },
                  { key: 'medications', label: 'Medicamentos'  },
                  { key: 'exams',       label: 'Exámenes'      },
                ] as { key: TabKey; label: string }[]
              ).map(tab => (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.tabPill, activeTab === tab.key && styles.tabPillActive]}
                  onPress={() => setActiveTab(tab.key)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.tabLabel,
                      activeTab === tab.key && styles.tabLabelActive,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Tab content ── */}
            {loading ? (
              <View style={styles.loadingCenter}>
                <ActivityIndicator size="large" color={Colors.primary} />
              </View>
            ) : (
              <View style={styles.flex}>
                {activeTab === 'visits' && (
                  visits.length === 0 ? (
                    <EmptyState text="Sin visitas registradas" />
                  ) : (
                    <FlatList
                      data={visits}
                      keyExtractor={item => item.id}
                      renderItem={renderVisitItem}
                      contentContainerStyle={styles.listContent}
                      showsVerticalScrollIndicator={false}
                    />
                  )
                )}

                {activeTab === 'medications' && (
                  prescriptions.length === 0 ? (
                    <EmptyState text="Sin medicamentos registrados" />
                  ) : (
                    <FlatList
                      data={prescriptions}
                      keyExtractor={item => item.id}
                      renderItem={renderPrescriptionItem}
                      contentContainerStyle={styles.listContent}
                      showsVerticalScrollIndicator={false}
                    />
                  )
                )}

                {activeTab === 'exams' && (
                  tests.length === 0 ? (
                    <EmptyState text="Sin exámenes registrados" />
                  ) : (
                    <FlatList
                      data={tests}
                      keyExtractor={item => item.id}
                      renderItem={renderTestItem}
                      contentContainerStyle={styles.listContent}
                      showsVerticalScrollIndicator={false}
                    />
                  )
                )}
              </View>
            )}
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  backBtn: {
    marginRight: Spacing.md,
    padding: Spacing.xs,
  },
  backArrow: {
    fontSize: Typography.xxl,
    color: Colors.primary,
    lineHeight: Typography.xxl + 2,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  headerSub: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginHorizontal: Spacing.base,
    marginTop: Spacing.base,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  searchIcon: {
    fontSize: Typography.base,
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    paddingVertical: 0,
  },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: Spacing.base,
    marginBottom: Spacing.base,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabPill: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: Radius.md,
  },
  tabPillActive: {
    backgroundColor: Colors.primary,
  },
  tabLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  tabLabelActive: {
    color: Colors.white,
    fontWeight: Typography.semibold,
  },

  // List
  listContent: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },

  // Card
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  cardDate: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.medium,
  },
  cardTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  cardSubtitle: {
    fontSize: Typography.sm,
    color: Colors.info,
    marginTop: 2,
    marginBottom: Spacing.xs,
  },
  cardBody: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: Typography.sm * 1.5,
  },
  cardMeta: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },

  // Badge
  badge: {
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxxl,
  },
  emptyText: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    textAlign: 'center',
  },

  // Loading
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search results
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  searchResultIcon: {
    fontSize: Typography.lg,
    marginRight: Spacing.md,
  },
  searchResultText: {
    flex: 1,
  },
  searchResultTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  searchResultSub: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  searchResultMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  searchMetaChip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchMetaChipText: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },
  chevron: {
    fontSize: Typography.lg,
    color: Colors.textMuted,
    lineHeight: Typography.lg,
  },
});
