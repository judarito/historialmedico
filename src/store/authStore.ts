import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseInitError } from '../services/supabase';
import { captureException, markBootStep } from '../services/runtimeDiagnostics';

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
    try {
      if (supabaseInitError) {
        throw supabaseInitError;
      }

      await markBootStep('authStore.init:getSession');
      const { data: { session } } = await supabase.auth.getSession();
      set({ session, user: session?.user ?? null, initialized: true });

      await markBootStep('authStore.init:subscribeAuthState');
      supabase.auth.onAuthStateChange((_event, session) => {
        set({ session, user: session?.user ?? null });
      });
    } catch (error) {
      await captureException('authStore.init', error, { markBootFailed: true });
      set({ session: null, user: null, initialized: true });
      throw error;
    }
  },

  signIn: async (email, password) => {
    set({ loading: true });
    try {
      if (supabaseInitError) throw supabaseInitError;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error?.message ?? null;
    } catch (error) {
      await captureException('authStore.signIn', error);
      return error instanceof Error ? error.message : 'No se pudo iniciar sesion';
    } finally {
      set({ loading: false });
    }
  },

  signUp: async (email, password, fullName) => {
    set({ loading: true });
    try {
      if (supabaseInitError) throw supabaseInitError;
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      return error?.message ?? null;
    } catch (error) {
      await captureException('authStore.signUp', error);
      return error instanceof Error ? error.message : 'No se pudo crear la cuenta';
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    try {
      if (supabaseInitError) throw supabaseInitError;
      await supabase.auth.signOut();
    } catch (error) {
      await captureException('authStore.signOut', error);
    } finally {
      set({ session: null, user: null });
    }
  },
}));
