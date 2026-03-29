import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

interface AuthState {
  session:     Session | null;
  user:        User | null;
  loading:     boolean;
  initialized: boolean;

  signIn:   (email: string, password: string) => Promise<string | null>;
  signUp:   (email: string, password: string, fullName: string) => Promise<string | null>;
  signOut:  () => Promise<void>;
  init:     () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session:     null,
  user:        null,
  loading:     false,
  initialized: false,

  init: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    set({ session, user: session?.user ?? null, initialized: true });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null });
    });
  },

  signIn: async (email, password) => {
    set({ loading: true });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    set({ loading: false });
    return error?.message ?? null;
  },

  signUp: async (email, password, fullName) => {
    set({ loading: true });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    set({ loading: false });
    return error?.message ?? null;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));
