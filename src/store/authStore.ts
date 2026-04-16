import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseInitError } from '../services/supabase';
import { captureException, markBootStep } from '../services/runtimeDiagnostics';
import { PASSWORD_RESET_REDIRECT_URL } from '../services/authLinks';

type AuthEmailStatus = {
  exists?: boolean;
  confirmed?: boolean;
};

function isMissingAuthEmailStatusRpc(error: { message?: string | null; details?: string | null } | null) {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
  return haystack.includes('check_auth_email_status')
    && (haystack.includes('schema cache') || haystack.includes('could not find the function'));
}

function getDuplicateEmailMessage(status?: AuthEmailStatus | null) {
  if (status?.confirmed === false) {
    return 'Este correo ya fue registrado y está pendiente de confirmación. Revisa tu correo o usa recuperación de contraseña.';
  }

  return 'Este correo ya tiene una cuenta. Inicia sesión o usa recuperación de contraseña.';
}

interface AuthState {
  session:     Session | null;
  user:        User | null;
  loading:     boolean;
  initialized: boolean;

  signIn:   (email: string, password: string) => Promise<string | null>;
  signUp:   (email: string, password: string, fullName: string) => Promise<string | null>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
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

      const normalizedEmail = email.trim().toLowerCase();
      const { data: emailStatusData, error: emailStatusError } = await supabase.rpc('check_auth_email_status', {
        p_email: normalizedEmail,
      });

      if (emailStatusError && !isMissingAuthEmailStatusRpc(emailStatusError)) {
        await captureException('authStore.signUp.checkAuthEmailStatus', emailStatusError);
      }

      const emailStatus = (!emailStatusError || isMissingAuthEmailStatusRpc(emailStatusError))
        ? (emailStatusData as AuthEmailStatus | null)
        : null;

      if (emailStatus?.exists) {
        return getDuplicateEmailMessage(emailStatus);
      }

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        return error.message;
      }

      if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
        return getDuplicateEmailMessage(emailStatus);
      }

      return null;
    } catch (error) {
      await captureException('authStore.signUp', error);
      return error instanceof Error ? error.message : 'No se pudo crear la cuenta';
    } finally {
      set({ loading: false });
    }
  },

  requestPasswordReset: async (email) => {
    set({ loading: true });
    try {
      if (supabaseInitError) throw supabaseInitError;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: PASSWORD_RESET_REDIRECT_URL,
      });
      return error?.message ?? null;
    } catch (error) {
      await captureException('authStore.requestPasswordReset', error);
      return error instanceof Error ? error.message : 'No se pudo enviar el correo de recuperacion';
    } finally {
      set({ loading: false });
    }
  },

  updatePassword: async (password) => {
    set({ loading: true });
    try {
      if (supabaseInitError) throw supabaseInitError;
      const { error } = await supabase.auth.updateUser({ password });
      return error?.message ?? null;
    } catch (error) {
      await captureException('authStore.updatePassword', error);
      return error instanceof Error ? error.message : 'No se pudo actualizar la contraseña';
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    set({ loading: true });
    try {
      if (supabaseInitError) throw supabaseInitError;

      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) {
        throw error;
      }
    } catch (error) {
      await captureException('authStore.signOut', error);
    } finally {
      set({ session: null, user: null, loading: false });
    }
  },
}));
