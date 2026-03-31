import { useFamilyStore } from '../store/familyStore';

export type AppEntryRoute = '/onboarding' | '/onboarding/member' | '/(app)/(tabs)';

export async function resolveAuthenticatedRoute(): Promise<AppEntryRoute> {
  const store = useFamilyStore.getState();
  await store.fetchTenantAndFamily();

  const state = useFamilyStore.getState();
  if (!state.tenant || !state.family) {
    return '/onboarding';
  }

  await state.fetchMembers();
  const nextState = useFamilyStore.getState();
  return nextState.members.length === 0 ? '/onboarding/member' : '/(app)/(tabs)';
}
