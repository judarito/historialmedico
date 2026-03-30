import { create } from 'zustand';
import { supabase } from '../services/supabase';
import type { Database } from '../types/database.types';
import { captureException, markBootStep } from '../services/runtimeDiagnostics';

type Tenant       = Database['public']['Tables']['tenants']['Row'];
type Family       = Database['public']['Tables']['families']['Row'];
type FamilyMember = Database['public']['Tables']['family_members']['Row'];
type RelType      = Database['public']['Tables']['family_members']['Row']['relationship'];

interface FamilyState {
  tenant:   Tenant | null;
  family:   Family | null;
  members:  FamilyMember[];
  loading:  boolean;

  fetchTenantAndFamily: () => Promise<void>;
  fetchMembers:         () => Promise<void>;
  createTenantWithFamily: (familyName: string) => Promise<string | null>;
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
  loading: false,

  fetchTenantAndFamily: async () => {
    try {
      set({ loading: true });
      await markBootStep('familyStore.fetchTenantAndFamily:getUser');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { set({ loading: false }); return; }

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) { set({ loading: false }); return; }

      await markBootStep('familyStore.fetchTenantAndFamily:loadTenant');
      const [{ data: tenant }, { data: families }] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', profile.tenant_id).single(),
        supabase.from('families').select('*').eq('tenant_id', profile.tenant_id).eq('is_active', true).limit(1),
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

  createTenantWithFamily: async (familyName) => {
    set({ loading: true });
    const slug = familyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();

    // 1. Crear tenant
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_tenant_with_owner', {
      p_name: familyName,
      p_slug: slug,
    });
    if (rpcErr) { set({ loading: false }); return rpcErr.message; }

    const tenantId = (rpcData as any)?.tenant_id as string | undefined;
    if (!tenantId) { set({ loading: false }); return 'No se pudo crear el grupo familiar'; }

    // 2. Crear familia dentro del tenant
    const { data: { user } } = await supabase.auth.getUser();
    const { data: family, error: famErr } = await supabase
      .from('families')
      .insert({ tenant_id: tenantId, name: familyName, created_by: user!.id })
      .select()
      .single();

    if (famErr) { set({ loading: false }); return famErr.message; }

    // 3. Refrescar datos
    const { data: tenant } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
    set({ tenant: tenant ?? null, family: family ?? null, loading: false });
    return null;
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

  reset: () => set({ tenant: null, family: null, members: [], loading: false }),
}));
