import React, { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFamilyStore } from '../../store/familyStore';
import { Colors, Typography, Spacing, Radius } from '../../theme';
import { DEFAULT_TENANT_PLAN, TENANT_PLAN_OPTIONS, getTenantPlanLabel } from '../../constants/tenantPlans';
import type { TenantPlan } from '../../types/database.types';

export default function OnboardingCreateFamily() {
  const [name, setName] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<TenantPlan>(DEFAULT_TENANT_PLAN);
  const [error, setError] = useState('');
  const [checkingAccess, setCheckingAccess] = useState(true);
  const { tenant, family, createTenantWithFamily, fetchMembers, fetchTenantAndFamily, loading } = useFamilyStore();

  useEffect(() => {
    let active = true;

    async function resolveOnboardingRoute() {
      await fetchTenantAndFamily();
      if (!active) return;

      const state = useFamilyStore.getState();
      if (!state.tenant?.id) {
        setCheckingAccess(false);
        return;
      }

      if (!state.family?.id) {
        setSelectedPlan(state.tenant.plan);
        setName((current) => current || state.tenant?.name || '');
        setCheckingAccess(false);
        return;
      }

      await state.fetchMembers();
      if (!active) return;

      const nextState = useFamilyStore.getState();
      router.replace(nextState.members.length === 0 ? '/onboarding/member' : '/(app)/(tabs)');
    }

    void resolveOnboardingRoute();
    return () => {
      active = false;
    };
  }, [fetchMembers, fetchTenantAndFamily]);

  const isCompletingExistingTenant = Boolean(tenant?.id && !family?.id);

  async function handleCreate() {
    if (!name.trim()) {
      setError(isCompletingExistingTenant ? 'Ingresa el nombre de la familia' : 'Ingresa el nombre de tu familia');
      return;
    }

    setError('');
    const err = await createTenantWithFamily(name.trim(), selectedPlan);
    if (err) {
      Alert.alert('Error', err);
      return;
    }

    router.replace('/onboarding/member');
  }

  function handleSelectPlan(plan: TenantPlan, available: boolean) {
    if (isCompletingExistingTenant) {
      Alert.alert(
        'Plan ya definido',
        'Este tenant ya existe. Solo falta completar la familia inicial con el plan que ya tenia asignado.'
      );
      return;
    }

    if (!available) {
      Alert.alert(
        'Plan proximamente disponible',
        'Por ahora los nuevos grupos familiares empiezan en Free. Cuando habilitemos otros planes podras cambiarlos sin afectar a los invitados.'
      );
      return;
    }

    setSelectedPlan(plan);
  }

  if (checkingAccess) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingState}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Preparando tu onboarding...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.heroCard}>
          <View style={styles.iconWrap}>
            <Ionicons name="people" size={56} color={Colors.primary} />
          </View>

          <Text style={styles.title}>
            {isCompletingExistingTenant ? 'Completa tu grupo familiar' : 'Crea tu grupo familiar'}
          </Text>
          <Text style={styles.subtitle}>
            {isCompletingExistingTenant
              ? 'Encontramos un tenant ya creado para esta cuenta, pero todavia falta crear la familia principal. Vamos a completarla sin perder el plan actual.'
              : 'El plan pertenece a la familia, no al usuario. Si alguien entra por invitacion, heredara el mismo tenant sin pasar por este paso.'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Plan inicial</Text>
          <Text style={styles.sectionHint}>
            {isCompletingExistingTenant
              ? 'Este tenant ya tiene un plan asignado. Solo mostramos la referencia para completar la familia faltante.'
              : 'Todos los grupos nuevos empiezan hoy en Free. Dejamos visibles los siguientes planes para que el flujo quede listo sin chocar con los invitados.'}
          </Text>

          <View style={styles.planList}>
            {TENANT_PLAN_OPTIONS.map((option) => {
              const selected = option.value === selectedPlan;
              const disabled = isCompletingExistingTenant || !option.available;

              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.planCard,
                    selected ? styles.planCardSelected : null,
                    disabled ? styles.planCardDisabled : null,
                  ]}
                  onPress={() => handleSelectPlan(option.value, option.available)}
                  activeOpacity={0.85}
                >
                  <View style={styles.planHeader}>
                    <View style={styles.planTitleWrap}>
                      <Text style={[styles.planTitle, disabled ? styles.planTitleDisabled : null]}>
                        {option.title}
                      </Text>
                      <Text style={[styles.planPrice, disabled ? styles.planPriceDisabled : null]}>
                        {option.priceLabel}
                      </Text>
                    </View>

                    {option.badge ? (
                      <View style={styles.planBadge}>
                        <Text style={styles.planBadgeText}>{option.badge}</Text>
                      </View>
                    ) : selected ? (
                      <View style={styles.planCheck}>
                        <Ionicons name="checkmark" size={16} color={Colors.white} />
                      </View>
                    ) : null}
                  </View>

                  <Text style={[styles.planSummary, disabled ? styles.planSummaryDisabled : null]}>
                    {option.summary}
                  </Text>
                  <Text style={[styles.planDescription, disabled ? styles.planDescriptionDisabled : null]}>
                    {option.description}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.planFootnote}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.textSecondary} />
            <Text style={styles.planFootnoteText}>
              Plan seleccionado hoy: {getTenantPlanLabel(selectedPlan)}. Los cambios futuros de plan aplicaran al tenant completo.
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {isCompletingExistingTenant ? 'Nombre de la familia' : 'Nombre del grupo'}
          </Text>
          <View style={[styles.inputWrap, error ? styles.inputErr : null]}>
            <Ionicons name="home-outline" size={18} color={Colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={isCompletingExistingTenant ? 'Familia Garcia' : 'Familia Garcia'}
              placeholderTextColor={Colors.textMuted}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

          <TouchableOpacity
            style={[styles.btn, loading ? styles.btnDisabled : null]}
            onPress={handleCreate}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.btnText}>
                {isCompletingExistingTenant
                  ? 'Completar familia y continuar'
                  : `Continuar con ${getTenantPlanLabel(selectedPlan)}`}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.base,
    paddingHorizontal: Spacing.xl,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    textAlign: 'center',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.xl,
  },
  heroCard: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconWrap: {
    width: 100,
    height: 100,
    backgroundColor: Colors.surface,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: Colors.textPrimary,
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    textAlign: 'center',
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    textAlign: 'center',
    lineHeight: 22,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
  },
  sectionHint: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  planList: {
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  planCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    gap: Spacing.xs,
  },
  planCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.infoBg,
  },
  planCardDisabled: {
    opacity: 0.7,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.base,
  },
  planTitleWrap: {
    flex: 1,
    gap: 2,
  },
  planTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
  planTitleDisabled: {
    color: Colors.textSecondary,
  },
  planPrice: {
    color: Colors.healthy,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  planPriceDisabled: {
    color: Colors.warning,
  },
  planBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.warningBg,
    borderWidth: 1,
    borderColor: Colors.warning + '44',
  },
  planBadgeText: {
    color: Colors.warning,
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
  planCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planSummary: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
  },
  planSummaryDisabled: {
    color: Colors.textSecondary,
  },
  planDescription: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  planDescriptionDisabled: {
    color: Colors.textMuted,
  },
  planFootnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  planFootnoteText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 52,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  inputErr: {
    borderColor: Colors.alert,
  },
  input: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.base,
  },
  errorText: {
    color: Colors.alert,
    fontSize: Typography.xs,
  },
  btn: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: Colors.white,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
});
