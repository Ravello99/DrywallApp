// Roles, trades and levels. Keep in step with ALL_ROLES / SPECIALTIES / LEVELS in backend/server.py.
import { UserRole } from '../types';
import { BRAND } from './colors';

export const OFFICE_ROLES: UserRole[] = ['admin', 'project_coordinator', 'estimator', 'project_manager'];
export const FIELD_ROLES: UserRole[] = ['foreman', 'employee'];
export const PAY_RATE_VIEWERS: UserRole[] = ['admin', 'project_manager', 'project_coordinator'];
export const SHUTDOWN_ROLES: UserRole[] = ['admin', 'project_coordinator', 'project_manager'];

export const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'employee', label: 'Employee' },
  { value: 'foreman', label: 'Foreman' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'project_coordinator', label: 'Project Coordinator' },
  { value: 'estimator', label: 'Estimator' },
  { value: 'admin', label: 'Admin' },
];

export const SPECIALTY_OPTIONS = [
  { value: 'steel_framer', label: 'Steel Stud Framer' },
  { value: 'drywaller', label: 'Drywaller (Boarder)' },
  { value: 'taper_finisher', label: 'Taper / Finisher' },
  { value: 'insulator', label: 'Insulator' },
  { value: 'acoustic_ceilings', label: 'Acoustic Ceilings' },
  { value: 'labourer', label: 'Labourer' },
  { value: 'general', label: 'General' },
];

export const LEVEL_OPTIONS = [
  { value: 'apprentice', label: 'Apprentice' },
  { value: 'journeyman', label: 'Journeyman' },
  { value: 'lead_hand', label: 'Lead Hand' },
];

export const JOB_TYPE_OPTIONS = [
  { value: 'multi_family', label: 'Multi-Family Residential' },
  { value: 'commercial_fit_out', label: 'Small Commercial Fit-Out' },
  { value: 'institutional', label: 'Institutional' },
  { value: 'other', label: 'Other' },
];

export const isOfficeRole = (role?: string | null) => !!role && (OFFICE_ROLES as string[]).includes(role);
export const isFieldRole = (role?: string | null) => !!role && (FIELD_ROLES as string[]).includes(role);
export const canSeePayRates = (role?: string | null) => !!role && (PAY_RATE_VIEWERS as string[]).includes(role);
export const canShutDownSites = (role?: string | null) => !!role && (SHUTDOWN_ROLES as string[]).includes(role);

const label = (opts: { value: string; label: string }[], v?: string | null) =>
  opts.find((o) => o.value === v)?.label || v || '';

export const roleLabel = (role?: string | null) => label(ROLE_OPTIONS, role);
export const specialtyLabel = (s?: string | null) => label(SPECIALTY_OPTIONS, s);
export const levelLabel = (l?: string | null) => label(LEVEL_OPTIONS, l);
export const jobTypeLabel = (j?: string | null) => label(JOB_TYPE_OPTIONS, j);

export const roleColor = (role?: string | null): string => {
  switch (role) {
    case 'admin': return BRAND.navyDark;
    case 'project_manager': return BRAND.navy;
    case 'project_coordinator': return BRAND.navyLight;
    case 'estimator': return BRAND.slate;
    case 'foreman': return BRAND.goldDark;
    default: return BRAND.gold;
  }
};
