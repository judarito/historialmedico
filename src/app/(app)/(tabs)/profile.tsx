import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../../store/authStore';
import { useFamilyStore } from '../../../store/familyStore';
import { Avatar } from '../../../components/ui/Avatar';
import { supabase } from '../../../services/supabase';
import type { Database, TenantInvitationStatus, TenantUserRole } from '../../../types/database.types';
import { Colors, Typography, Spacing, Radius } from '../../../theme';
import { getTenantPlanLabel } from '../../../constants/tenantPlans';

type AccessMember = Database['public']['Functions']['get_tenant_access_members']['Returns'][number];
type PendingInvitation = Database['public']['Functions']['get_tenant_pending_invitations']['Returns'][number];

type InviteResponse = {
  success?: boolean;
  status?: 'invited' | 'reactivated' | 'role_updated' | 'already_member' | 'invitation_pending' | 'invitation_updated';
  email?: string;
  role?: TenantUserRole;
  user_id?: string;
};

const ROLE_LABELS: Record<TenantUserRole, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  member: 'Miembro',
  viewer: 'Consulta',
};

const ROLE_STYLES: Record<TenantUserRole, { color: string; backgroundColor: string }> = {
  owner: { color: Colors.warning, backgroundColor: Colors.warningBg },
  admin: { color: Colors.info, backgroundColor: Colors.infoBg },
  member: { color: Colors.healthy, backgroundColor: Colors.healthyBg },
  viewer: { color: Colors.textSecondary, backgroundColor: Colors.surfaceHigh },
};

const INVITATION_STATUS_LABELS: Record<TenantInvitationStatus, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  cancelled: 'Cancelada',
  expired: 'Vencida',
};

const MANAGEABLE_ROLE_OPTIONS: TenantUserRole[] = ['admin', 'member', 'viewer'];

function isValidEmail(value: string) {
  return /\S+@\S+\.\S+/.test(value);
}

function getAssignableRoles(currentRole: TenantUserRole | null): TenantUserRole[] {
  if (currentRole === 'owner') return MANAGEABLE_ROLE_OPTIONS;
  if (currentRole === 'admin') return ['member', 'viewer'];
  return [];
}

function canManageAccessMember(currentRole: TenantUserRole | null, member: AccessMember) {
  if (!currentRole || member.is_current_user || member.role === 'owner') return false;
  if (currentRole === 'admin' && member.role === 'admin') return false;
  return true;
}

function canManagePendingInvitation(currentRole: TenantUserRole | null, invitation: PendingInvitation) {
  if (!currentRole) return false;
  if (currentRole === 'admin' && invitation.role === 'admin') return false;
  return true;
}

function getInviteMessage(status?: InviteResponse['status']) {
  switch (status) {
    case 'invitation_pending':
      return 'La invitación quedó pendiente. Esa persona podrá crear su cuenta con ese mismo correo y entrar a esta familia.';
    case 'invitation_updated':
      return 'La invitación pendiente ya existía y fue actualizada.';
    case 'reactivated':
      return 'Ese usuario ya había estado vinculado. Su acceso quedó reactivado.';
    case 'role_updated':
      return 'El acceso ya existía y se actualizó correctamente.';
    case 'already_member':
      return 'Ese usuario ya tiene acceso a esta familia.';
    case 'invited':
    default:
      return 'El acceso quedó habilitado. Si esa persona ya tenía cuenta, puede entrar de inmediato a ver la familia.';
  }
}

function getDisplayName(member: AccessMember) {
  if (member.full_name?.trim()) return member.full_name.trim();
  if (member.email) return member.email.split('@')[0];
  return 'Usuario';
}

function isMissingSharedAccessRpc(error: { message?: string | null; details?: string | null } | null) {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
  return (
    (
      haystack.includes('get_tenant_access_members') ||
      haystack.includes('get_tenant_pending_invitations') ||
      haystack.includes('invite_user_to_tenant') ||
      haystack.includes('update_tenant_user_role') ||
      haystack.includes('update_tenant_invitation_role') ||
      haystack.includes('revoke_tenant_user_access') ||
      haystack.includes('cancel_tenant_invitation')
    ) &&
    (haystack.includes('schema cache') || haystack.includes('could not find the function'))
  );
}

function getSharedAccessErrorMessage(error: { message?: string | null; details?: string | null } | null) {
  if (isMissingSharedAccessRpc(error)) {
    return 'Esta base todavía no tiene activado el acceso compartido completo. Aplica las migraciones recientes y vuelve a intentar.';
  }

  return error?.message ?? 'No pudimos completar la acción.';
}

export default function ProfileTab() {
  const { user, signOut } = useAuthStore();
  const { tenant, members, reset } = useFamilyStore();
  const [accessMembers, setAccessMembers] = useState<AccessMember[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TenantUserRole>('member');
  const [inviting, setInviting] = useState(false);
  const [mutatingAccessKey, setMutatingAccessKey] = useState<string | null>(null);
  const [directoryFavoritesCount, setDirectoryFavoritesCount] = useState(0);
  const [loadingDirectorySummary, setLoadingDirectorySummary] = useState(false);

  const fullName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'Usuario';
  const email = user?.email ?? '';
  const currentAccess = accessMembers.find((member) => member.user_id === user?.id) ?? null;
  const currentRole = currentAccess?.role ?? null;
  const canManageAccess = currentRole === 'owner' || currentRole === 'admin';
  const assignableRoles = getAssignableRoles(currentRole);

  const loadDirectorySummary = useCallback(async () => {
    if (!user?.id) {
      setDirectoryFavoritesCount(0);
      setLoadingDirectorySummary(false);
      return;
    }

    setLoadingDirectorySummary(true);
    const { count, error } = await supabase
      .from('medical_directory_favorites')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    setLoadingDirectorySummary(false);

    if (error) {
      setDirectoryFavoritesCount(0);
      return;
    }

    setDirectoryFavoritesCount(count ?? 0);
  }, [user?.id]);

  async function loadAccessData() {
    if (!tenant?.id) {
      setAccessMembers([]);
      setPendingInvitations([]);
      setAccessError('');
      setLoadingAccess(false);
      return;
    }

    setLoadingAccess(true);
    setAccessError('');

    const [{ data: accessData, error: accessRpcError }, { data: pendingData, error: pendingRpcError }] = await Promise.all([
      supabase.rpc('get_tenant_access_members', {
        p_tenant_id: tenant.id,
      }),
      supabase.rpc('get_tenant_pending_invitations', {
        p_tenant_id: tenant.id,
      }),
    ]);

    const error = accessRpcError ?? pendingRpcError;
    if (error) {
      setAccessMembers([]);
      setPendingInvitations([]);
      setAccessError(
        isMissingSharedAccessRpc(error)
          ? 'El acceso compartido todavía no está habilitado en esta base de datos. Faltan aplicar las migraciones recientes.'
          : error.message
      );
      setLoadingAccess(false);
      return;
    }

    setAccessMembers(accessData ?? []);
    setPendingInvitations(pendingData ?? []);
    setLoadingAccess(false);
  }

  useEffect(() => {
    void loadAccessData();
  }, [tenant?.id]);

  useEffect(() => {
    void loadDirectorySummary();
  }, [loadDirectorySummary]);

  useFocusEffect(useCallback(() => {
    void loadDirectorySummary();
  }, [loadDirectorySummary]));

  useEffect(() => {
    if (assignableRoles.length === 0) return;
    if (!assignableRoles.includes(inviteRole)) {
      setInviteRole(assignableRoles[0]);
    }
  }, [assignableRoles.join('|'), inviteRole]);

  async function handleInvite() {
    if (!tenant?.id) {
      Alert.alert('Sin grupo familiar', 'Primero necesitas tener una familia activa.');
      return;
    }

    const normalizedEmail = inviteEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      Alert.alert('Correo requerido', 'Ingresa el correo del usuario que quieres habilitar.');
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      Alert.alert('Correo inválido', 'Revisa el correo e inténtalo de nuevo.');
      return;
    }

    setInviting(true);
    const { data, error } = await supabase.rpc('invite_user_to_tenant', {
      p_tenant_id: tenant.id,
      p_email: normalizedEmail,
      p_role: inviteRole,
    });
    setInviting(false);

    if (error) {
      Alert.alert('No pudimos habilitar el acceso', getSharedAccessErrorMessage(error));
      return;
    }

    setInviteEmail('');
    await loadAccessData();

    const result = (data ?? {}) as InviteResponse;
    Alert.alert('Acceso compartido', getInviteMessage(result.status));
  }

  async function handleUpdateMemberRole(member: AccessMember, nextRole: TenantUserRole) {
    if (!tenant?.id) return;

    setMutatingAccessKey(`member-role:${member.user_id}:${nextRole}`);
    const { error } = await supabase.rpc('update_tenant_user_role', {
      p_tenant_id: tenant.id,
      p_user_id: member.user_id,
      p_role: nextRole,
    });
    setMutatingAccessKey(null);

    if (error) {
      Alert.alert('No pudimos actualizar el acceso', getSharedAccessErrorMessage(error));
      return;
    }

    await loadAccessData();
    Alert.alert('Acceso actualizado', `${getDisplayName(member)} ahora tiene rol ${ROLE_LABELS[nextRole].toLowerCase()}.`);
  }

  function confirmRevokeMember(member: AccessMember) {
    Alert.alert(
      'Revocar acceso',
      `¿Seguro que quieres quitarle el acceso a ${getDisplayName(member)}? Seguirá existiendo la cuenta, pero ya no verá esta familia.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Revocar',
          style: 'destructive',
          onPress: async () => {
            if (!tenant?.id) return;
            setMutatingAccessKey(`member-revoke:${member.user_id}`);
            const { error } = await supabase.rpc('revoke_tenant_user_access', {
              p_tenant_id: tenant.id,
              p_user_id: member.user_id,
            });
            setMutatingAccessKey(null);

            if (error) {
              Alert.alert('No pudimos revocar el acceso', getSharedAccessErrorMessage(error));
              return;
            }

            await loadAccessData();
            Alert.alert('Acceso revocado', `${getDisplayName(member)} ya no puede entrar a esta familia.`);
          },
        },
      ]
    );
  }

  async function handleUpdateInvitationRole(invitation: PendingInvitation, nextRole: TenantUserRole) {
    setMutatingAccessKey(`invitation-role:${invitation.invitation_id}:${nextRole}`);
    const { error } = await supabase.rpc('update_tenant_invitation_role', {
      p_invitation_id: invitation.invitation_id,
      p_role: nextRole,
    });
    setMutatingAccessKey(null);

    if (error) {
      Alert.alert('No pudimos actualizar la invitación', getSharedAccessErrorMessage(error));
      return;
    }

    await loadAccessData();
    Alert.alert('Invitación actualizada', `${invitation.email} ahora se invitará con rol ${ROLE_LABELS[nextRole].toLowerCase()}.`);
  }

  function confirmCancelInvitation(invitation: PendingInvitation) {
    Alert.alert(
      'Cancelar invitación',
      `¿Seguro que quieres cancelar la invitación pendiente para ${invitation.email}?`,
      [
        { text: 'Conservar', style: 'cancel' },
        {
          text: 'Cancelar invitación',
          style: 'destructive',
          onPress: async () => {
            setMutatingAccessKey(`invitation-cancel:${invitation.invitation_id}`);
            const { error } = await supabase.rpc('cancel_tenant_invitation', {
              p_invitation_id: invitation.invitation_id,
            });
            setMutatingAccessKey(null);

            if (error) {
              Alert.alert('No pudimos cancelar la invitación', getSharedAccessErrorMessage(error));
              return;
            }

            await loadAccessData();
            Alert.alert('Invitación cancelada', `La invitación pendiente para ${invitation.email} fue cancelada.`);
          },
        },
      ]
    );
  }

  async function handleSignOut() {
    Alert.alert('Cerrar sesión', '¿Estás seguro de que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          reset();
          router.replace('/');
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.profileCard}>
          <Avatar name={fullName} imageUrl={null} size={72} />
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{fullName}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
          </View>
        </View>

        {tenant && (
          <Section title="Grupo familiar">
            <InfoRow icon="home-outline" label="Nombre" value={tenant.name} />
            <InfoRow icon="card-outline" label="Plan" value={getTenantPlanLabel(tenant.plan)} />
            <InfoRow icon="people-outline" label="Miembros" value={`${members.length} registrados`} />
            {currentRole && (
              <InfoRow icon="key-outline" label="Tu acceso" value={ROLE_LABELS[currentRole]} />
            )}
          </Section>
        )}

        {tenant && (
          <Section title="Acceso compartido">
            <View style={styles.accessHeader}>
              <Text style={styles.sectionBodyText}>
                Otros adultos pueden entrar con su propio usuario a ver esta familia. Si todavía no tienen cuenta, puedes dejar la invitación pendiente y se activará cuando se registren con ese mismo correo.
              </Text>
            </View>

            {!loadingAccess && !accessError && canManageAccess ? (
              <View style={styles.inviteBlock}>
                <Text style={styles.inviteTitle}>Habilitar otro usuario</Text>
                <Text style={styles.inviteHelp}>
                  Escribe su correo. Si ya tiene cuenta, entra de inmediato. Si no, podrá crearla luego con ese mismo correo y la invitación se aplicará automáticamente.
                </Text>

                <View style={styles.inputWrap}>
                  <Ionicons
                    name="mail-outline"
                    size={18}
                    color={Colors.textSecondary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="correo@ejemplo.com"
                    placeholderTextColor={Colors.textMuted}
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!inviting}
                    returnKeyType="done"
                    onSubmitEditing={handleInvite}
                  />
                </View>

                {assignableRoles.length > 0 ? (
                  <View style={styles.roleSelectorBlock}>
                    <Text style={styles.roleSelectorLabel}>Rol inicial del acceso</Text>
                    <View style={styles.roleSelectorList}>
                      {assignableRoles.map((role) => {
                        const selected = inviteRole === role;
                        const roleStyle = ROLE_STYLES[role];

                        return (
                          <TouchableOpacity
                            key={role}
                            style={[
                              styles.roleSelectorChip,
                              selected
                                ? {
                                    backgroundColor: roleStyle.backgroundColor,
                                    borderColor: roleStyle.color + '55',
                                  }
                                : null,
                            ]}
                            onPress={() => setInviteRole(role)}
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                styles.roleSelectorChipText,
                                selected ? { color: roleStyle.color } : null,
                              ]}
                            >
                              {ROLE_LABELS[role]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.inviteBtn, inviting && styles.inviteBtnDisabled]}
                  onPress={handleInvite}
                  disabled={inviting}
                  activeOpacity={0.8}
                >
                  {inviting ? (
                    <ActivityIndicator color={Colors.white} size="small" />
                  ) : (
                    <>
                      <Ionicons name="person-add-outline" size={18} color={Colors.white} />
                      <Text style={styles.inviteBtnText}>Invitar a esta familia</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            {!loadingAccess && !accessError && !canManageAccess ? (
              <View style={styles.accessNotice}>
                <Ionicons name="lock-closed-outline" size={18} color={Colors.textSecondary} />
                <Text style={styles.noticeText}>
                  Solo el propietario o un administrador puede habilitar nuevos usuarios.
                </Text>
              </View>
            ) : null}

            <View style={styles.accessListHeader}>
              <Text style={styles.accessListTitle}>Usuarios con acceso</Text>
              {(loadingAccess || Boolean(mutatingAccessKey)) && <ActivityIndicator color={Colors.primary} size="small" />}
            </View>

            {accessError ? (
              <Text style={styles.errorText}>{accessError}</Text>
            ) : null}

            {!loadingAccess && accessMembers.length === 0 && pendingInvitations.length === 0 && !accessError ? (
              <Text style={styles.emptyText}>Todavía no hay otros usuarios habilitados.</Text>
            ) : null}

            {accessMembers.map((member, index) => {
              const roleStyle = ROLE_STYLES[member.role];
              const canManageMember = canManageAccess && canManageAccessMember(currentRole, member);
              const roleActions = getAssignableRoles(currentRole).filter((role) => role !== member.role);

              return (
                <View
                  key={member.user_id}
                  style={[
                    styles.accessRow,
                    index === accessMembers.length - 1 ? styles.accessRowLast : null,
                  ]}
                >
                  <View style={styles.accessRowMain}>
                    <View style={styles.accessIdentity}>
                      <Text style={styles.accessName}>
                        {getDisplayName(member)}
                        {member.is_current_user ? ' · Tú' : ''}
                      </Text>
                      <Text style={styles.accessEmail}>{member.email ?? 'Sin correo visible'}</Text>
                    </View>

                    <View
                      style={[
                        styles.roleBadge,
                        { backgroundColor: roleStyle.backgroundColor, borderColor: roleStyle.color + '44' },
                      ]}
                    >
                      <Text style={[styles.roleBadgeText, { color: roleStyle.color }]}>
                        {ROLE_LABELS[member.role]}
                      </Text>
                    </View>
                  </View>

                  {canManageMember ? (
                    <View style={styles.accessActions}>
                      {roleActions.map((role) => {
                        const nextRoleStyle = ROLE_STYLES[role];
                        return (
                          <TouchableOpacity
                            key={`${member.user_id}:${role}`}
                            style={[
                              styles.actionChip,
                              {
                                backgroundColor: nextRoleStyle.backgroundColor,
                                borderColor: nextRoleStyle.color + '44',
                              },
                              mutatingAccessKey ? styles.actionChipDisabled : null,
                            ]}
                            onPress={() => handleUpdateMemberRole(member, role)}
                            disabled={Boolean(mutatingAccessKey)}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.actionChipText, { color: nextRoleStyle.color }]}>
                              A {ROLE_LABELS[role]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}

                      <TouchableOpacity
                        style={[styles.actionChip, styles.actionChipDanger, mutatingAccessKey ? styles.actionChipDisabled : null]}
                        onPress={() => confirmRevokeMember(member)}
                        disabled={Boolean(mutatingAccessKey)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.actionChipText, styles.actionChipDangerText]}>Revocar acceso</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            })}

            {!loadingAccess && pendingInvitations.length > 0 ? (
              <>
                <View style={styles.accessListHeader}>
                  <Text style={styles.accessListTitle}>Invitaciones pendientes</Text>
                </View>

                {pendingInvitations.map((invitation, index) => {
                  const roleStyle = ROLE_STYLES[invitation.role];
                  const isLastPending = index === pendingInvitations.length - 1;
                  const canManageInvitation = canManageAccess && canManagePendingInvitation(currentRole, invitation);
                  const roleActions = getAssignableRoles(currentRole).filter((role) => role !== invitation.role);

                  return (
                    <View
                      key={invitation.invitation_id}
                      style={[styles.accessRow, isLastPending ? styles.accessRowLast : null]}
                    >
                      <View style={styles.accessRowMain}>
                        <View style={styles.accessIdentity}>
                          <Text style={styles.accessName}>{invitation.email}</Text>
                          <Text style={styles.accessEmail}>
                            Esperando que cree su cuenta o inicie sesión con ese correo
                          </Text>
                        </View>

                        <View style={styles.pendingBadges}>
                          <View
                            style={[
                              styles.roleBadge,
                              { backgroundColor: roleStyle.backgroundColor, borderColor: roleStyle.color + '44' },
                            ]}
                          >
                            <Text style={[styles.roleBadgeText, { color: roleStyle.color }]}>
                              {ROLE_LABELS[invitation.role]}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.roleBadge,
                              { backgroundColor: Colors.warningBg, borderColor: Colors.warning + '44' },
                            ]}
                          >
                            <Text style={[styles.roleBadgeText, { color: Colors.warning }]}>
                              {INVITATION_STATUS_LABELS[invitation.status]}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {canManageInvitation ? (
                        <View style={styles.accessActions}>
                          {roleActions.map((role) => {
                            const nextRoleStyle = ROLE_STYLES[role];
                            return (
                              <TouchableOpacity
                                key={`${invitation.invitation_id}:${role}`}
                                style={[
                                  styles.actionChip,
                                  {
                                    backgroundColor: nextRoleStyle.backgroundColor,
                                    borderColor: nextRoleStyle.color + '44',
                                  },
                                  mutatingAccessKey ? styles.actionChipDisabled : null,
                                ]}
                                onPress={() => handleUpdateInvitationRole(invitation, role)}
                                disabled={Boolean(mutatingAccessKey)}
                                activeOpacity={0.8}
                              >
                                <Text style={[styles.actionChipText, { color: nextRoleStyle.color }]}>
                                  A {ROLE_LABELS[role]}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}

                          <TouchableOpacity
                            style={[styles.actionChip, styles.actionChipDanger, mutatingAccessKey ? styles.actionChipDisabled : null]}
                            onPress={() => confirmCancelInvitation(invitation)}
                            disabled={Boolean(mutatingAccessKey)}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.actionChipText, styles.actionChipDangerText]}>Cancelar invitación</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </>
            ) : null}
          </Section>
        )}

        <Section title="Directorio médico">
          <InfoRow
            icon="star-outline"
            label="Guardados"
            value={loadingDirectorySummary ? 'Cargando...' : `${directoryFavoritesCount} especialista${directoryFavoritesCount === 1 ? '' : 's'}`}
          />
          <OptionRow
            icon="medkit-outline"
            label="Ver especialistas guardados"
            onPress={() => router.push({ pathname: '/(app)/doctor-directory', params: { favorites: '1' } })}
          />
          <OptionRow
            icon="search-outline"
            label="Buscar especialistas"
            onPress={() => router.push('/(app)/doctor-directory')}
          />
        </Section>

        <Section title="Configuración">
          <OptionRow
            icon="notifications-outline"
            label="Notificaciones"
            onPress={() => Alert.alert('Próximamente', 'Esta función estará disponible pronto.')}
          />
          <OptionRow
            icon="shield-outline"
            label="Privacidad y datos"
            onPress={() => Alert.alert('Próximamente', 'Esta función estará disponible pronto.')}
          />
          <OptionRow
            icon="help-circle-outline"
            label="Ayuda"
            onPress={() => Alert.alert('Próximamente', 'Esta función estará disponible pronto.')}
          />
        </Section>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={20} color={Colors.alert} />
          <Text style={styles.signOutText}>Cerrar sesión</Text>
        </TouchableOpacity>

          <Text style={styles.version}>Family Health Tracker IA v1.0.0</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={Colors.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function OptionRow({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={18} color={Colors.textSecondary} />
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.xl,
  },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  profileInfo: { flex: 1, gap: 4 },
  profileName: {
    color: Colors.textPrimary,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
  },
  profileEmail: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },

  section: { gap: Spacing.sm },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
  },
  rowValue: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    marginLeft: 'auto',
  },

  accessHeader: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
  },
  sectionBodyText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  inviteBlock: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  inviteTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  inviteHelp: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  roleSelectorBlock: {
    gap: Spacing.xs,
  },
  roleSelectorLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  roleSelectorList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  roleSelectorChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceHigh,
  },
  roleSelectorChipText: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 52,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.base,
  },
  inviteBtn: {
    height: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  inviteBtnDisabled: {
    opacity: 0.7,
  },
  inviteBtnText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.bold,
  },
  accessNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  noticeText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  accessListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.sm,
  },
  accessListTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  accessRow: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  accessRowLast: {
    borderBottomWidth: 0,
  },
  accessRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  pendingBadges: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  accessIdentity: {
    flex: 1,
    gap: 4,
  },
  accessName: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.medium,
  },
  accessEmail: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },
  roleBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
  accessActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  actionChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  actionChipDisabled: {
    opacity: 0.6,
  },
  actionChipText: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
  actionChipDanger: {
    backgroundColor: Colors.alertBg,
    borderColor: Colors.alert + '44',
  },
  actionChipDangerText: {
    color: Colors.alert,
  },
  errorText: {
    color: Colors.alert,
    fontSize: Typography.sm,
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.base,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.base,
  },

  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 52,
    backgroundColor: Colors.alertBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.alert + '44',
  },
  signOutText: {
    color: Colors.alert,
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
  },
  version: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    textAlign: 'center',
  },
});
