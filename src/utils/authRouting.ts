import { useFamilyStore } from '../store/familyStore';
import { supabase } from '../services/supabase';
import { captureException } from '../services/runtimeDiagnostics';

export type AppEntryRoute = '/onboarding' | '/onboarding/member' | '/onboarding/contact' | '/(app)/(tabs)';

export async function hasCompletedProfilePhone(): Promise<boolean> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return true;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('phone')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      await captureException('authRouting.hasCompletedProfilePhone', error);
      return true;
    }

    return Boolean(data?.phone?.trim());
  } catch (error) {
    await captureException('authRouting.hasCompletedProfilePhone', error);
    return true;
  }
}

export async function resolveAuthenticatedRoute(): Promise<AppEntryRoute> {
  const store = useFamilyStore.getState();
  await store.fetchTenantAndFamily();

  const state = useFamilyStore.getState();
  if (!state.tenant || !state.family) {
    return '/onboarding';
  }

  await state.fetchMembers();
  const nextState = useFamilyStore.getState();
  if (nextState.members.length === 0) {
    return '/onboarding/member';
  }

  const hasPhone = await hasCompletedProfilePhone();
  return hasPhone ? '/(app)/(tabs)' : '/onboarding/contact';
}
