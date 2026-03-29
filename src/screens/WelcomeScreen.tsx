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
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../components/ui/Button';
import { Colors, Typography, Spacing, Radius } from '../theme';
import { FamilyIllustration, Icons } from '../assets';

const { width } = Dimensions.get('window');

interface WelcomeScreenProps {
  onLogin:    () => void;
  onRegister: () => void;
}

export function WelcomeScreen({ onLogin, onRegister }: WelcomeScreenProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Logo */}
        <View style={styles.logoRow}>
          <View style={styles.logoIcon}>
            <Ionicons name="heart" size={22} color={Colors.alert} />
          </View>
          <Text style={styles.logoText}>Family Health Tracker <Text style={styles.logoIA}>IA</Text></Text>
        </View>

        {/* Ilustración */}
        <View style={styles.illustrationWrap}>
          {/* Círculo de fondo */}
          <View style={styles.illustrationCircle} />
          <Image
            source={FamilyIllustration}
            style={styles.illustration}
            resizeMode="contain"
          />
          {/* Iconos flotantes decorativos — assets reales */}
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
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxxl,
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
    width: width * 0.75,
    height: width * 0.75,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  illustrationCircle: {
    position: 'absolute',
    width: width * 0.68,
    height: width * 0.68,
    borderRadius: width * 0.34,
    backgroundColor: Colors.surface,
    opacity: 0.6,
  },
  illustration: {
    width: width * 0.65,
    height: width * 0.65,
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
  },
  btnSolid: {
    width: '100%',
  },
  btnOutline: {
    width: '100%',
  },
});
