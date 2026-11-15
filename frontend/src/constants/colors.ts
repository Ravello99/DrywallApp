// VanGuard Drywall & Acoustics brand colors (flat navy + flat gold, sampled from the logo).
// Use these names everywhere instead of hex codes so a rebrand is one-file change.
export const BRAND = {
  navy: '#0B2556',
  navyLight: '#1E3A70',
  navyDark: '#061838',
  navyTint: '#E7ECF5',
  gold: '#B4973A',
  goldLight: '#CDB466',
  goldDark: '#8C7428',
  goldTint: '#F6F0DC',
  slate: '#5B6E7C',
  slateTint: '#ECEFF2',
  charcoal: '#202732',
};

export const COLORS = {
  // Primary = navy (buttons, headers, active tabs); accent = gold (highlights)
  primary: BRAND.navy,
  primaryLight: BRAND.navyLight,
  primaryDark: BRAND.navyDark,
  primaryTint: BRAND.navyTint,
  accent: BRAND.gold,
  accentLight: BRAND.goldLight,
  accentDark: BRAND.goldDark,
  accentTint: BRAND.goldTint,
  slate: BRAND.slate,

  // Announcement Types
  siteInstruction: BRAND.gold,
  hazard: '#C62828',
  general: BRAND.slate,

  // Status colors (kept distinct from the brand so warnings still read as warnings)
  success: '#2E7D32',
  error: '#C62828',
  warning: '#D98E04',
  info: BRAND.navyLight,

  // Expiry warnings
  expiringSoon: '#D98E04',
  expiringCritical: '#C62828',

  // Neutral Colors
  white: '#FFFFFF',
  black: '#000000',
  gray100: '#F4F5F7',
  gray200: '#E1E4E8',
  gray300: '#C9CED4',
  gray400: '#98A1AB',
  gray500: '#5B6E7C',
  gray600: '#2B3440',

  // Background
  background: '#F4F5F7',
  cardBackground: '#FFFFFF',

  // Text
  textPrimary: '#1C2430',
  textSecondary: '#5B6E7C',
  textLight: '#98A1AB',
};

export const ANNOUNCEMENT_COLORS = {
  site_instruction: {
    bg: BRAND.goldTint,
    text: BRAND.goldDark,
    border: BRAND.gold,
  },
  hazard: {
    bg: '#FDECEC',
    text: '#C62828',
    border: '#C62828',
  },
  general: {
    bg: BRAND.navyTint,
    text: BRAND.navy,
    border: BRAND.navy,
  },
};

export const COMPANY = {
  name: 'VanGuard Drywall & Acoustics',
  shortName: 'VanGuard',
};
