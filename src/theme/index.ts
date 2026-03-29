// ============================================================
// Design System — Family Health Tracker IA
// Basado en el diseño dark navy de la app
// ============================================================

export const Colors = {
  // Fondos
  background:       '#0B1628',   // fondo principal azul marino profundo
  surface:          '#132039',   // cards y superficies elevadas
  surfaceHigh:      '#1A2D4A',   // hover / estado activo
  border:           '#1E3355',   // bordes sutiles

  // Primario
  primary:          '#2D7DD2',   // azul primario (botones, links)
  primaryLight:     '#4A9AE8',

  // Estados de salud
  alert:            '#E85D4A',   // fiebre alta / alerta crítica (coral-rojo)
  alertBg:          '#2A1218',   // fondo de card de alerta
  warning:          '#F5A623',   // recordatorios / advertencia (ámbar)
  warningBg:        '#2A1E0A',
  healthy:          '#4ECDC4',   // saludable (teal)
  healthyBg:        '#0A2220',
  info:             '#4A90D9',   // informativo (azul)
  infoBg:           '#0F1E35',

  // Texto
  textPrimary:      '#FFFFFF',
  textSecondary:    '#8BA0B8',   // texto secundario gris-azul
  textMuted:        '#4A6080',   // texto deshabilitado

  // Comunes
  white:            '#FFFFFF',
  black:            '#000000',
  transparent:      'transparent',
} as const;

export const Typography = {
  // Tamaños
  xs:   11,
  sm:   13,
  base: 15,
  md:   17,
  lg:   20,
  xl:   24,
  xxl:  30,
  xxxl: 36,

  // Pesos
  regular:    '400' as const,
  medium:     '500' as const,
  semibold:   '600' as const,
  bold:       '700' as const,
  extrabold:  '800' as const,
} as const;

export const Spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  base: 16,
  lg:   20,
  xl:   24,
  xxl:  32,
  xxxl: 48,
} as const;

export const Radius = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  full: 999,
} as const;

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  subtle: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
} as const;
