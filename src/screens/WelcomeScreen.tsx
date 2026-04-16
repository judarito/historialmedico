// ============================================================
// Pantalla 1: Bienvenido — Welcome / Auth gate
// Dark navy, logo, ilustración familiar, dos botones
// ============================================================
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../components/ui/Button';
import { Colors, Typography, Spacing, Radius } from '../theme';
import { FamilyIllustration, Icons } from '../assets';

interface WelcomeScreenProps {
  onLogin:    () => void;
  onRegister: () => void;
}

export function WelcomeScreen({ onLogin, onRegister }: WelcomeScreenProps) {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 768;
  const isDesktop = width >= 1024;
  const illustrationSize = Math.min(
    width * (isDesktop ? 0.34 : isTablet ? 0.5 : 0.75),
    height * (isDesktop ? 0.5 : isTablet ? 0.42 : 0.36),
    isDesktop ? 460 : isTablet ? 400 : 320,
  );
  const circleSize = illustrationSize * 0.9;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { minHeight: height }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>
          {/* Logo */}
          <View style={styles.logoRow}>
            <View style={styles.logoIcon}>
              <Ionicons name="heart" size={22} color={Colors.alert} />
            </View>
            <Text style={styles.logoText}>Family Health Tracker <Text style={styles.logoIA}>IA</Text></Text>
          </View>

          {/* Ilustración */}
          <View style={[styles.illustrationWrap, { width: illustrationSize, height: illustrationSize }]}>
            <View
              style={[
                styles.illustrationCircle,
                {
                  width: circleSize,
                  height: circleSize,
                  borderRadius: circleSize / 2,
                },
              ]}
            />
            <Image
              source={FamilyIllustration}
              style={[styles.illustration, { width: illustrationSize * 0.9, height: illustrationSize * 0.9 }]}
              resizeMode="contain"
            />
            <View style={[styles.floatingIcon, styles.floatingTopLeft]}>
              <Image source={Icons.stethoscope} style={styles.floatingImg} />
            </View>
            <View style={[styles.floatingIcon, styles.floatingTopRight]}>
              <Image source={Icons.heartrate} style={styles.floatingImg} />
            </View>
            <View style={[styles.floatingIcon, styles.floatingBottomLeft]}>
              <Image source={Icons.medicineBottle} style={styles.floatingImg} />
            </View>
            <View style={[styles.floatingIcon, styles.floatingBottomRight]}>
              <Image source={Icons.shieldCheck} style={styles.floatingImg} />
            </View>
          </View>

          {/* Título */}
          <View style={styles.textBlock}>
            <Text style={styles.title}>Bienvenido</Text>
            <Text style={styles.subtitle}>Cuida la salud de tu familia</Text>
          </View>

          {/* Botones */}
          <View style={styles.buttons}>
            <Button
              label="Iniciar Sesión"
              onPress={onLogin}
              variant="solid"
              style={styles.btnSolid}
            />
            <Button
              label="Crear Cuenta"
              onPress={onRegister}
              variant="outline"
              style={styles.btnOutline}
            />
            <Text style={styles.helperText}>
              Si te invitaron a una familia, crea tu cuenta con ese mismo correo para entrar automáticamente.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
    gap: Spacing.lg,
  },

  // Logo
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    alignSelf: 'center',
    marginTop: Spacing.md,
  },
  logoIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.alertBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
  logoIA: {
    color: Colors.primary,
  },

  // Ilustración
  illustrationWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    alignSelf: 'center',
  },
  illustrationCircle: {
    position: 'absolute',
    backgroundColor: Colors.surface,
    opacity: 0.6,
  },
  illustration: {
    zIndex: 1,
  },
  floatingIcon: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  floatingTopLeft:    { top: 20,  left: 0   },
  floatingTopRight:   { top: 10,  right: 0  },
  floatingBottomLeft: { bottom: 30, left: 10  },
  floatingBottomRight:{ bottom: 20, right: 5  },
  floatingImg: {
    width: 24,
    height: 24,
  },

  // Texto
  textBlock: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: Typography.xxxl,
    fontWeight: Typography.extrabold,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    textAlign: 'center',
  },

  // Botones
  buttons: {
    width: '100%',
    gap: Spacing.md,
    maxWidth: 420,
  },
  btnSolid: {
    width: '100%',
  },
  btnOutline: {
    width: '100%',
  },
  helperText: {
    color: Colors.textMuted,
    fontSize: Typography.sm,
    textAlign: 'center',
    lineHeight: 18,
  },
});
