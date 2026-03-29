// ============================================================
// Assets — Family Health Tracker IA
// Exporta todas las imágenes e iconos extraídos de los assets
// ============================================================

// Ilustración principal
export const FamilyIllustration = require('./family-illustration.png');

// Iconos 3D (128x128 con fondo transparente)
export const Icons = {
  heart:          require('./icon-heart.png'),
  bell:           require('./icon-bell.png'),
  calendar:       require('./icon-calendar.png'),
  location:       require('./icon-location.png'),
  stethoscope:    require('./icon-stethoscope.png'),
  medicineBottle: require('./icon-medicine-bottle.png'),
  medicineJar:    require('./icon-medicine-jar.png'),
  clipboard:      require('./icon-clipboard.png'),
  heartrate:      require('./icon-heartrate.png'),
  shieldCheck:    require('./icon-shield-check.png'),
  checklist:      require('./icon-checklist.png'),
  folder:         require('./icon-folder.png'),
  heartPlus:      require('./icon-heart-plus.png'),
} as const;

export type IconName = keyof typeof Icons;
