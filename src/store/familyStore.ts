import { create } from 'zustand';
import { supabase } from '../services/supabase';
import type { Database, TenantPlan } from '../types/database.types';
import { captureException, markBootStep } from '../services/runtimeDiagnostics';
import { DEFAULT_TENANT_PLAN } from '../constants/tenantPlans';

type Tenant       = Database['public']['Tables']['tenants']['Row'];
type Family       = Database['public']['Tables']['families']['Row'];
type FamilyMember = Database['public']['Tables']['family_members']['Row'];
type RelType      = Database['public']['Tables']['family_members']['Row']['relationship'];
type InviteClaimOutcome = {
  claimed?: boolean;
  reason?: string;
  tenant_id?: string;
  role?: string;
  invitation_id?: string;
};

function isMissingClaimInvitesRpc(error: { message?: string | null; details?: string | null } | null): boolean {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
  return haystack.includes('claim_pending_tenant_invitations')
    && (haystack.includes('schema cache') || haystack.includes('could not find the function'));
}

interface FamilyState {
  tenant:   Tenant | null;
  family:   Family | null;
  members:  FamilyMember[];
  inviteClaimOutcome: InviteClaimOutcome | null;
  loading:  boolean;

  fetchTenantAndFamily: () => Promise<void>;
  fetchMembers:         () => Promise<void>;
  createTenantWithFamily: (familyName: string, plan?: TenantPlan) => Promise<string | null>;
  consumeInviteClaimNotice: () => string | null;
  addMember: (data: {
    first_name:   string;
    last_name:    string;
    birth_date:   string;
    relationship: RelType;
    sex?:         string;
    eps_name?:    string;
    allergies?:   string;
  }) => Promise<string | null>;
  reset: () => void;
}

export const useFamilyStore = create<FamilyState>((set, get) => ({
  tenant:  null,
  family:  null,
  members: [],
  inviteClaimOutcome: null,
  loading: false,

  fetchTenantAndFamily: async () => {
    try {
      set({ loading: true });
      await markBootStep('familyStore.fetchTenantAndFamily:getUser');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        set({ tenant: null, family: null, members: [], inviteClaimOutcome: null, loading: false });
        return;
      }

      await markBootStep('familyStore.fetchTenantAndFamily:claimInvites');
      const { data: claimData, error: claimError } = await supabase.rpc('claim_pending_tenant_invitations');
      if (claimError && !isMissingClaimInvitesRpc(claimError)) {
        await captureException('familyStore.fetchTenantAndFamily.claimInvites', claimError);
      }

      set({
        inviteClaimOutcome: claimError || isMissingClaimInvitesRpc(claimError)
          ? null
          : ((claimData as InviteClaimOutcome | null) ?? null),
      });

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      let tenantId = profile?.tenant_id ?? null;

      if (tenantId) {
        const { data: preferredMembership } = await supabase
          .from('tenant_users')
          .select('tenant_id')
          .eq('tenant_id', tenantId)
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (!preferredMembership?.tenant_id) {
          tenantId = null;
        }
      }

      if (!tenantId) {
        const { data: membership } = await supabase
          .from('tenant_users')
          .select('tenant_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        tenantId = membership?.tenant_id ?? null;
      }

      if (!tenantId) {
        set({ tenant: null, family: null, members: [], loading: false });
        return;
      }

      await markBootStep('familyStore.fetchTenantAndFamily:loadTenant');
      const [{ data: tenant }, { data: families }] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', tenantId).single(),
        supabase.from('families').select('*').eq('tenant_id', tenantId).eq('is_active', true).limit(1),
      ]);

      set({
        tenant:  tenant ?? null,
        family:  families?.[0] ?? null,
        loading: false,
      });
    } catch (error) {
      await captureException('familyStore.fetchTenantAndFamily', error);
      set({ loading: false });
    }
  },

  fetchMembers: async () => {
    try {
      const { family } = get();
      if (!family) return;
      set({ loading: true });

      const { data } = await supabase
        .from('family_members')
        .select('*')
        .eq('family_id', family.id)
        .eq('is_active', true)
        .order('created_at');

      set({ members: data ?? [], loading: false });
    } catch (error) {
      await captureException('familyStore.fetchMembers', error);
      set({ loading: false });
    }
  },

  createTenantWithFamily: async (familyName, plan = DEFAULT_TENANT_PLAN) => {
    set({ loading: true });
    const slug = familyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();

    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_tenant_with_owner', {
      p_name: familyName,
      p_slug: slug,
      p_plan: plan,
    });
    if (rpcErr) { set({ loading: false }); return rpcErr.message; }

    const tenantId = (rpcData as any)?.tenant_id as string | undefined;
    if (!tenantId) { set({ loading: false }); return 'No se pudo crear el grupo familiar'; }

    await get().fetchTenantAndFamily();
    if (!get().tenant?.id || !get().family?.id) {
      set({ loading: false });
      return 'El grupo se creó, pero no pudimos cargar su estado completo. Reintenta entrar al onboarding.';
    }

    set({ loading: false });
    return null;
  },

  consumeInviteClaimNotice: () => {
    const outcome = get().inviteClaimOutcome;
    set({ inviteClaimOutcome: null });

    if (!outcome || outcome.claimed !== false) {
      return null;
    }

    switch (outcome.reason) {
      case 'already_has_tenant':
        return 'Esta cuenta ya pertenece a otra familia. Por ahora solo soportamos una familia activa por cuenta, asi que seguiras entrando a tu grupo actual.';
      case 'missing_email':
        return 'No pudimos revisar invitaciones pendientes porque esta cuenta no tiene un correo disponible.';
      default:
        return null;
    }
  },

  addMember: async (data) => {
    const { family, tenant } = get();
    if (!family || !tenant) return 'No hay grupo familiar activo';
    set({ loading: true });

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('family_members').insert({
      tenant_id:    tenant.id,
      family_id:    family.id,
      created_by:   user!.id,
      first_name:   data.first_name,
      last_name:    data.last_name,
      birth_date:   data.birth_date,
      relationship: data.relationship,
      sex:          data.sex ?? null,
      eps_name:     data.eps_name ?? null,
      allergies:    data.allergies ?? null,
    });

    if (error) { set({ loading: false }); return error.message; }
    await get().fetchMembers();
    set({ loading: false });
    return null;
  },

  reset: () => set({ tenant: null, family: null, members: [], inviteClaimOutcome: null, loading: false }),
}));
