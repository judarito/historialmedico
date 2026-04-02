import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../../../services/supabase';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../theme';
import { formatCalendarDate } from '../../../utils';

interface Member {
  id: string;
  first_name: string;
  last_name: string | null;
  blood_type: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  birth_date: string | null;
}

interface ActiveMedication {
  medication_name: string;
  dose_amount: string | null;
  dose_unit: string | null;
  frequency_text: string | null;
}

interface ShareTokenResult {
  token: string;
  expires_at: string;
}

export default function EmergencyCardScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();

  const [member, setMember] = useState<Member | null>(null);
  const [medications, setMedications] = useState<ActiveMedication[]>([]);
  const [tokenData, setTokenData] = useState<ShareTokenResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingToken, setGeneratingToken] = useState(false);

  useEffect(() => {
    if (!memberId) return;
    loadData();
  }, [memberId]);

  async function loadData() {
    setLoading(true);
    try {
      const [memberRes, medsRes] = await Promise.all([
        supabase
          .from('family_members')
          .select('id, first_name, last_name, blood_type, allergies, chronic_conditions, emergency_contact_name, emergency_contact_phone, birth_date')
          .eq('id', memberId as string)
          .single(),
        supabase
          .from('prescriptions')
          .select('medication_name, dose_amount, dose_unit, frequency_text')
          .eq('family_member_id', memberId as string)
          .eq('status', 'active'),
      ]);

      if (memberRes.data) setMember(memberRes.data as Member);
      if (medsRes.data) setMedications(medsRes.data as ActiveMedication[]);

      await generateToken();
    } catch {
      Alert.alert('Error', 'No se pudo cargar la tarjeta de emergencias.');
    } finally {
      setLoading(false);
    }
  }

  async function generateToken() {
    setGeneratingToken(true);
    try {
      const { data, error } = await supabase.rpc('generate_share_token', {
        p_member_id: memberId as string,
        p_ttl_hours: 168,
      });
      if (error) throw error;
      if (data) setTokenData(data as ShareTokenResult);
    } catch {
      // Token es opcional; la tarjeta igual se puede mostrar
    } finally {
      setGeneratingToken(false);
    }
  }

  async function handleShare() {
    if (!tokenData || !member) return;
    const shareUrl = Linking.createURL('/share/' + tokenData.token);
    try {
      await Share.share({
        url: shareUrl,
        message: `Historial de salud de ${member.first_name}${member.last_name ? ' ' + member.last_name : ''}: ${shareUrl}`,
      });
    } catch {
      // El usuario canceló
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Cargando tarjeta...</Text>
      </SafeAreaView>
    );
  }

  if (!member) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.alert} />
        <Text style={styles.errorText}>No se encontró el miembro.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const shareUrl = tokenData ? Linking.createURL('/share/' + tokenData.token) : null;
  const visibleMeds = medications.slice(0, 6);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tarjeta de Emergencias</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Shield Icon */}
        <View style={styles.shieldWrapper}>
          <View style={styles.shieldCircle}>
            <Ionicons name="shield" size={40} color={Colors.alert} />
          </View>
        </View>

        {/* Nombre */}
        <Text style={styles.memberName}>{`${member.first_name}${member.last_name ? ' ' + member.last_name : ''}`}</Text>
        <Text style={styles.memberSubtitle}>Información de emergencia</Text>

        {/* Datos críticos */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Datos críticos</Text>

          {/* Sangre */}
          <View style={styles.dataRow}>
            <View style={[styles.dataIcon, { backgroundColor: Colors.alertBg }]}>
              <Ionicons name="water" size={16} color={Colors.alert} />
            </View>
            <View style={styles.dataContent}>
              <Text style={styles.dataLabel}>Tipo de sangre</Text>
              {member.blood_type ? (
                <Text style={[styles.dataValue, { color: Colors.alert, fontWeight: Typography.bold }]}>
                  {member.blood_type}
                </Text>
              ) : (
                <Text style={[styles.dataValue, { color: Colors.textMuted }]}>No registrado</Text>
              )}
            </View>
          </View>

          {/* Alergias */}
          <View style={[styles.dataRow, styles.alertRow]}>
            <View style={[styles.dataIcon, { backgroundColor: Colors.alertBg }]}>
              <Ionicons name="alert-circle" size={16} color={Colors.alert} />
            </View>
            <View style={styles.dataContent}>
              <Text style={styles.dataLabel}>Alergias</Text>
              <Text style={[styles.dataValue, { color: member.allergies ? Colors.alert : Colors.textMuted }]}>
                {member.allergies ?? 'Sin alergias registradas'}
              </Text>
            </View>
          </View>

          {/* Condiciones */}
          <View style={[styles.dataRow, styles.warningRow]}>
            <View style={[styles.dataIcon, { backgroundColor: Colors.warningBg }]}>
              <Ionicons name="medical" size={16} color={Colors.warning} />
            </View>
            <View style={styles.dataContent}>
              <Text style={styles.dataLabel}>Condiciones crónicas</Text>
              <Text style={[styles.dataValue, { color: member.chronic_conditions ? Colors.warning : Colors.textMuted }]}>
                {member.chronic_conditions ?? 'Sin condiciones registradas'}
              </Text>
            </View>
          </View>

          {/* Contacto emergencia */}
          {(member.emergency_contact_name || member.emergency_contact_phone) && (
            <View style={styles.dataRow}>
              <View style={[styles.dataIcon, { backgroundColor: Colors.infoBg ?? Colors.surface }]}>
                <Ionicons name="call" size={16} color={Colors.info} />
              </View>
              <View style={styles.dataContent}>
                <Text style={styles.dataLabel}>Contacto de emergencia</Text>
                <Text style={styles.dataValue}>
                  {[member.emergency_contact_name, member.emergency_contact_phone].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Medicamentos activos */}
        {visibleMeds.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="medkit" size={16} color={Colors.healthy} />
              <Text style={[styles.cardTitle, { marginLeft: Spacing.xs }]}>
                Medicamentos activos ({medications.length})
              </Text>
            </View>
            {visibleMeds.map((med, idx) => (
              <View key={idx} style={styles.medRow}>
                <View style={styles.medDot} />
                <Text style={styles.medText}>
                  {med.medication_name}
                  {med.dose_amount ? ` ${med.dose_amount}${med.dose_unit ?? ''}` : ''}
                  {med.frequency_text ? ` — ${med.frequency_text}` : ''}
                </Text>
              </View>
            ))}
            {medications.length > 6 && (
              <Text style={styles.moreMeds}>+{medications.length - 6} más...</Text>
            )}
          </View>
        )}

        {/* QR y compartir */}
        <View style={styles.qrCard}>
          <Text style={styles.cardTitle}>Código QR — Historial completo</Text>

          {generatingToken && !tokenData ? (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginVertical: Spacing.xl }} />
          ) : shareUrl ? (
            <>
              <View style={styles.qrWrapper}>
                <QRCode
                  value={shareUrl}
                  size={180}
                  color={Colors.textPrimary}
                  backgroundColor={Colors.surface}
                />
              </View>
              <Text style={styles.qrCaption}>Escanea para ver historial completo</Text>
              {tokenData?.expires_at && (
                <Text style={styles.qrExpiry}>
                  Válido hasta {formatCalendarDate(tokenData.expires_at, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </Text>
              )}
              <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
                <Ionicons name="share-outline" size={18} color={Colors.textPrimary} />
                <Text style={styles.shareBtnText}>Compartir enlace</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.noTokenMsg}>
              <Ionicons name="link-outline" size={32} color={Colors.textMuted} />
              <Text style={styles.noTokenText}>No se pudo generar el QR. Intenta nuevamente.</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={generateToken}>
                <Text style={styles.retryBtnText}>Reintentar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    marginTop: Spacing.sm,
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    textAlign: 'center',
  },
  backBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  backBtnText: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },
  shieldWrapper: {
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.base,
  },
  shieldCircle: {
    width: 80,
    height: 80,
    borderRadius: Radius.full,
    backgroundColor: Colors.alertBg,
    borderWidth: 2,
    borderColor: Colors.alert,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberName: {
    color: Colors.textPrimary,
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  memberSubtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
    ...Shadow.card,
  },
  cardTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    marginBottom: Spacing.md,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  alertRow: {
    backgroundColor: Colors.alertBg,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    marginHorizontal: -Spacing.sm,
  },
  warningRow: {
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    marginHorizontal: -Spacing.sm,
  },
  dataIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
    marginTop: 2,
  },
  dataContent: {
    flex: 1,
  },
  dataLabel: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  dataValue: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.regular,
    lineHeight: 18,
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
  },
  medDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.healthy,
    marginRight: Spacing.sm,
  },
  medText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    flex: 1,
  },
  moreMeds: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    marginTop: Spacing.xs,
    fontStyle: 'italic',
  },
  qrCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
    alignItems: 'center',
    ...Shadow.card,
  },
  qrWrapper: {
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  qrCaption: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  qrExpiry: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    textAlign: 'center',
    marginBottom: Spacing.base,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  shareBtnText: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  noTokenMsg: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  noTokenText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    textAlign: 'center',
  },
  retryBtn: {
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    marginTop: Spacing.xs,
  },
  retryBtnText: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
});
