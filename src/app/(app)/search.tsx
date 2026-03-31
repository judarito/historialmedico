import { useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { searchGlobalFallback } from '../../services/searchFallback';
import { Colors, Typography, Spacing, Radius } from '../../theme';
import { VoiceRecordButton } from '../../components/ui/VoiceRecordButton';

// ── Types ────────────────────────────────────────────────────────────────────

type FilterCategory = 'all' | 'member' | 'medication' | 'diagnosis' | 'doctor' | 'specialist' | 'test' | 'document';

interface SearchResult {
  result_type:     string;
  filter_category: string;
  result_id:       string;
  member_id:       string;
  member_name:     string;
  title:           string;
  subtitle:        string;
  date_ref:        string | null;
  navigation_id?:  string | null;
  match_score?:    number;
  matched_terms?:  string[];
}

interface AIExpansion {
  terms:    string[];
  category: string;
  intent:   string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const FILTER_CHIPS: { key: FilterCategory; label: string; icon: any }[] = [
  { key: 'all',        label: 'Todos',        icon: 'search-outline'        },
  { key: 'member',     label: 'Miembro',      icon: 'person-outline'        },
  { key: 'medication', label: 'Medicina',     icon: 'medkit-outline'        },
  { key: 'diagnosis',  label: 'Diagnóstico',  icon: 'document-text-outline' },
  { key: 'doctor',     label: 'Médico',       icon: 'person-circle-outline' },
  { key: 'specialist', label: 'Especialidad', icon: 'medal-outline'         },
  { key: 'test',       label: 'Examen',       icon: 'flask-outline'         },
  { key: 'document',   label: 'Adjunto',      icon: 'attach-outline'        },
];

const TYPE_META: Record<string, { icon: any; color: string; navTarget: 'member' | 'visit' }> = {
  member:     { icon: 'person',          color: Colors.primary, navTarget: 'member' },
  medication: { icon: 'medkit',          color: Colors.healthy, navTarget: 'member' },
  visit:      { icon: 'calendar',        color: Colors.info,    navTarget: 'visit'  },
  test:       { icon: 'flask',           color: Colors.warning, navTarget: 'member' },
  document:   { icon: 'attach',          color: Colors.warning, navTarget: 'visit'  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function deduplicateForAll(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    const key = `${r.result_type}:${r.result_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const [query,        setQuery]        = useState('');
  const [filter,       setFilter]       = useState<FilterCategory>('all');
  const [results,      setResults]      = useState<SearchResult[]>([]);
  const [expansion,    setExpansion]    = useState<AIExpansion | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [searched,     setSearched]     = useState(false);
  const [searchError,  setSearchError]  = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef    = useRef<TextInput>(null);

  function handleQueryChange(text: string) {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!text.trim()) {
      setResults([]); setExpansion(null); setSearchError(null);
      setSearched(false); setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => runSearch(text.trim()), 500);
  }

  async function runSearch(q: string) {
    setSearchError(null);

    try {
      const fallbackResults = await searchGlobalFallback(q, 40);
      if (fallbackResults.length > 0) {
        setLoading(false);
        setSearched(true);
        setResults(fallbackResults);
        setExpansion(null);
        setFilter('all');
        return;
      }
    } catch (fallbackError) {
      console.warn('search fallback error:', fallbackError);
    }

    // Intentar primero con la edge function (expansión IA con DeepSeek)
    const { data, error: fnError } = await supabase.functions.invoke('search-ai', {
      body: { query: q, limit: 40 },
    });

    if (!fnError && data?.results) {
      setLoading(false);
      setSearched(true);
      const results: SearchResult[] = data.results ?? [];
      setResults(results);
      setExpansion(data.expansion ?? null);
      // Solo aplicar el filtro sugerido por la IA si efectivamente hay resultados
      // en esa categoría; si no, quedarse en 'all' para no ocultar nada.
      const suggestedCategory = data.expansion?.category as FilterCategory | undefined;
      if (suggestedCategory && suggestedCategory !== 'all') {
        const hasResultsInCategory = results.some(r => r.filter_category === suggestedCategory);
        setFilter(hasResultsInCategory ? suggestedCategory : 'all');
      } else {
        setFilter('all');
      }
      return;
    }

    // Fallback: búsqueda directa sin IA cuando la edge function falla
    console.warn('search-ai no disponible, usando búsqueda directa:', fnError);

    const { data: rpcData, error: rpcError } = await supabase.rpc('search_global', {
      p_query: q,
      p_limit: 40,
    });

    setLoading(false);
    setSearched(true);

    if (rpcError) {
      console.warn('search_global error:', rpcError);
      setSearchError('No se pudo completar la búsqueda. Revisa tu conexión.');
      return;
    }

    setResults((rpcData as SearchResult[]) ?? []);
    setExpansion(null);
  }

  function handleVoiceTranscription(text: string) {
    if (!text.trim()) return;
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    runSearch(text.trim());
  }

  function handleResultPress(item: SearchResult) {
    if (item.result_type === 'document') {
      if (item.navigation_id) {
        router.push({ pathname: '/(app)/visit/[id]', params: { id: item.navigation_id } });
        return;
      }
      router.push({ pathname: '/(app)/member/[id]', params: { id: item.member_id } });
      return;
    }

    const meta = TYPE_META[item.result_type] ?? TYPE_META.member;
    if (meta.navTarget === 'visit') {
      router.push({ pathname: '/(app)/visit/[id]', params: { id: item.navigation_id ?? item.result_id } });
    } else {
      router.push({ pathname: '/(app)/member/[id]', params: { id: item.member_id } });
    }
  }

  // Aplicar filtro activo
  const filtered: SearchResult[] = filter === 'all'
    ? deduplicateForAll(results)
    : results.filter(r => r.filter_category === filter);

  // Conteos por categoría
  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.filter_category] = (acc[r.filter_category] ?? 0) + 1;
    return acc;
  }, {});
  const totalUniq = deduplicateForAll(results).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderResult({ item }: { item: SearchResult }) {
    const meta     = TYPE_META[item.result_type] ?? TYPE_META.member;
    const catLabel = FILTER_CHIPS.find(c => c.key === item.filter_category)?.label ?? '';
    const isAIMatch = (item.match_score ?? 0) > 1;

    return (
      <TouchableOpacity style={styles.resultCard} onPress={() => handleResultPress(item)} activeOpacity={0.7}>
        <View style={[styles.resultIcon, { backgroundColor: meta.color + '1A' }]}>
          <Ionicons name={meta.icon} size={20} color={meta.color} />
        </View>

        <View style={styles.resultContent}>
          <View style={styles.resultTitleRow}>
            <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
            {isAIMatch && (
              <View style={styles.aiMatchBadge}>
                <Ionicons name="sparkles" size={10} color={Colors.primary} />
              </View>
            )}
          </View>
          {!!item.subtitle && (
            <Text style={styles.resultSubtitle} numberOfLines={1}>{item.subtitle}</Text>
          )}
          <View style={styles.resultMeta}>
            <View style={styles.memberTag}>
              <Ionicons name="person-outline" size={11} color={Colors.textMuted} />
              <Text style={styles.memberTagText}>{item.member_name}</Text>
            </View>
            <View style={[styles.catTag, { backgroundColor: meta.color + '18' }]}>
              <Text style={[styles.catTagText, { color: meta.color }]}>{catLabel}</Text>
            </View>
          </View>
        </View>

        <View style={styles.resultRight}>
          {!!item.date_ref && <Text style={styles.resultDate}>{formatDate(item.date_ref)}</Text>}
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header con barra de búsqueda */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Buscar miembro, medicina, médico..."
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => { if (debounceRef.current) clearTimeout(debounceRef.current); if (query.trim()) runSearch(query.trim()); }}
          />
          {loading
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : !!query
              ? (
                <TouchableOpacity onPress={() => { setQuery(''); setResults([]); setSearched(false); setExpansion(null); }}>
                  <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              )
              : null
          }
        </View>

        <VoiceRecordButton
          size={44}
          onTranscription={handleVoiceTranscription}
          disabled={loading}
        />
      </View>

      {/* IA: intención detectada + términos expandidos */}
      {expansion && (
        <View style={styles.aiBar}>
          <Ionicons name="sparkles" size={13} color={Colors.primary} />
          <Text style={styles.aiIntent} numberOfLines={1}>{expansion.intent}</Text>
          {expansion.terms.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.aiTermsScroll}>
              {expansion.terms.slice(1).map(t => (
                <TouchableOpacity
                  key={t}
                  style={styles.aiTermChip}
                  onPress={() => { setQuery(t); runSearch(t); }}
                >
                  <Text style={styles.aiTermText}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      <TouchableOpacity
        style={styles.directoryCta}
        onPress={() => router.push('/(app)/doctor-directory')}
        activeOpacity={0.8}
      >
        <View style={styles.directoryCtaIcon}>
          <Ionicons name="medkit-outline" size={16} color={Colors.primary} />
        </View>
        <View style={styles.directoryCtaBody}>
          <Text style={styles.directoryCtaTitle}>Buscar especialistas en Colombia</Text>
          <Text style={styles.directoryCtaText}>Usa Google Places con cache compartido para hallar médicos y clínicas.</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
      </TouchableOpacity>

      {/* Filter chips */}
      {results.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} style={styles.chipsScroll}>
          {FILTER_CHIPS.map(chip => {
            const count  = chip.key === 'all' ? totalUniq : (counts[chip.key] ?? 0);
            if (chip.key !== 'all' && count === 0) return null;
            const active = filter === chip.key;
            return (
              <TouchableOpacity key={chip.key} style={[styles.chip, active && styles.chipActive]} onPress={() => setFilter(chip.key)} activeOpacity={0.7}>
                <Ionicons name={chip.icon} size={13} color={active ? Colors.white : Colors.textSecondary} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
                <View style={[styles.chipBadge, active && styles.chipBadgeActive]}>
                  <Text style={[styles.chipBadgeText, active && styles.chipBadgeTextActive]}>{count}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Results / States */}
      {!query.trim() ? (
        <View style={styles.stateCenter}>
          <Ionicons name="sparkles" size={52} color={Colors.primary + '66'} />
          <Text style={styles.stateTitle}>Búsqueda inteligente</Text>
          <Text style={styles.stateText}>
            Escribe en lenguaje natural.{'\n'}
            "pastillas para la presión de mamá", "cardiólogo el año pasado", "examen de sangre"
          </Text>
        </View>
      ) : loading && !searched ? (
        <View style={styles.stateCenter}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.stateText}>Analizando con IA...</Text>
        </View>
      ) : searchError ? (
        <View style={styles.stateCenter}>
          <Ionicons name="warning-outline" size={48} color={Colors.warning} />
          <Text style={styles.stateTitle}>Error de búsqueda</Text>
          <Text style={styles.stateText}>{searchError}</Text>
          <TouchableOpacity onPress={() => runSearch(query.trim())} style={styles.clearFilterBtn}>
            <Text style={styles.clearFilterText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.stateCenter}>
          <Ionicons name="file-tray-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.stateTitle}>Sin resultados</Text>
          <Text style={styles.stateText}>
            No se encontró nada para "{query}"
            {filter !== 'all' ? ` en "${FILTER_CHIPS.find(c => c.key === filter)?.label}"` : ''}.
          </Text>
          {filter !== 'all' && (
            <TouchableOpacity onPress={() => setFilter('all')} style={styles.clearFilterBtn}>
              <Text style={styles.clearFilterText}>Ver todos los resultados</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, i) => `${item.result_id}:${item.filter_category}:${i}`}
          renderItem={renderResult}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 38, height: 38, backgroundColor: Colors.surface,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
  },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, height: 46,
  },
  searchInput: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },

  // AI bar
  aiBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    backgroundColor: Colors.primary + '0C',
    borderBottomWidth: 1, borderBottomColor: Colors.primary + '20',
  },
  aiIntent:       { color: Colors.primary, fontSize: Typography.xs, fontWeight: Typography.medium, flexShrink: 1 },
  aiTermsScroll:  { flexShrink: 0 },
  aiTermChip: {
    backgroundColor: Colors.primary + '18', borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 3, marginLeft: Spacing.xs,
  },
  aiTermText: { color: Colors.primary, fontSize: Typography.xs, fontWeight: Typography.medium },
  directoryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.base,
    marginTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  directoryCtaIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '15',
  },
  directoryCtaBody: { flex: 1, gap: 2 },
  directoryCtaTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  directoryCtaText: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    lineHeight: 18,
  },

  // Chips
  chipsScroll: { maxHeight: 52 },
  chipsRow:    { paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm, gap: Spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surface, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  chipActive:          { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:            { color: Colors.textSecondary, fontSize: Typography.xs, fontWeight: Typography.medium },
  chipTextActive:      { color: Colors.white },
  chipBadge:           { backgroundColor: Colors.border, borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  chipBadgeActive:     { backgroundColor: Colors.white + '33' },
  chipBadgeText:       { color: Colors.textMuted, fontSize: 10, fontWeight: Typography.bold },
  chipBadgeTextActive: { color: Colors.white },

  // States
  stateCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  stateTitle:  { color: Colors.textPrimary,   fontSize: Typography.lg, fontWeight: Typography.bold, textAlign: 'center' },
  stateText:   { color: Colors.textSecondary, fontSize: Typography.sm, textAlign: 'center', lineHeight: 22 },
  clearFilterBtn:  { marginTop: Spacing.sm },
  clearFilterText: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.medium },

  // Results
  listContent:  { paddingHorizontal: Spacing.base, paddingTop: Spacing.sm, paddingBottom: Spacing.xxxl },
  resultCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
  },
  resultIcon:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  resultContent:  { flex: 1, gap: 3 },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  resultTitle:    { color: Colors.textPrimary, fontSize: Typography.base, fontWeight: Typography.semibold, flex: 1 },
  aiMatchBadge:   { width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center' },
  resultSubtitle: { color: Colors.textSecondary, fontSize: Typography.xs },
  resultMeta:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  memberTag:      { flexDirection: 'row', alignItems: 'center', gap: 3 },
  memberTagText:  { color: Colors.textMuted, fontSize: Typography.xs },
  catTag:         { borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  catTagText:     { fontSize: 10, fontWeight: Typography.semibold },
  resultRight:    { alignItems: 'flex-end', gap: 4 },
  resultDate:     { color: Colors.textMuted, fontSize: Typography.xs },
});
