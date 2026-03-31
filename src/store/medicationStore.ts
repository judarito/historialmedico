import { create } from 'zustand';
import { supabase } from '../services/supabase';
import type { Database, ScheduleStatus } from '../types/database.types';

type PendingDose = Database['public']['Functions']['get_pending_doses_today']['Returns'][number];
type ActiveMed   = Database['public']['Functions']['get_active_medications']['Returns'][number];

interface MedicationState {
  currentMemberId: string | null;
  doses:       PendingDose[];
  activeMeds:  ActiveMed[];
  loading:     boolean;
  marking:     string | null;   // schedule_id en proceso

  fetchTodayDoses:  (memberId: string) => Promise<void>;
  fetchActiveMeds:  (memberId: string) => Promise<void>;
  markDose:         (scheduleId: string, status: ScheduleStatus, notes?: string) => Promise<string | null>;
}

export const useMedicationStore = create<MedicationState>((set, get) => ({
  currentMemberId: null,
  doses:      [],
  activeMeds: [],
  loading:    false,
  marking:    null,

  fetchTodayDoses: async (memberId) => {
    set({ loading: true, currentMemberId: memberId, doses: [] });
    const { data, error } = await supabase.rpc('get_pending_doses_today', {
      p_family_member_id: memberId,
    });

    if (get().currentMemberId !== memberId) {
      return;
    }

    set({ doses: error ? [] : (data ?? []), loading: false });
  },

  fetchActiveMeds: async (memberId) => {
    set({ loading: true, currentMemberId: memberId, activeMeds: [] });
    const { data, error } = await supabase.rpc('get_active_medications', {
      p_family_member_id: memberId,
    });

    if (get().currentMemberId !== memberId) {
      return;
    }

    set({ activeMeds: error ? [] : (data ?? []), loading: false });
  },

  markDose: async (scheduleId, status, notes) => {
    set({ marking: scheduleId });
    const { error } = await supabase.rpc('mark_dose', {
      p_schedule_id: scheduleId,
      p_status:      status,
      p_notes:       notes,
    });
    set({ marking: null });
    if (error) return error.message;

    // Actualiza localmente sin refetch
    set((state) => ({
      doses: state.doses.map((d) =>
        d.schedule_id === scheduleId ? { ...d, status } : d
      ),
    }));
    return null;
  },
}));
