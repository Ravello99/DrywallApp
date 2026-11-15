// Small shared building blocks so every screen looks the same (VanGuard navy + gold).
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ViewStyle,
  TextInputProps,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';

// ------------------------------------------------------------------ formatting

export const money = (v?: number | null, decimals = 0) =>
  v == null
    ? '—'
    : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-CA', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;

export const pct = (v?: number | null) => (v == null ? '—' : `${v.toFixed(v % 1 === 0 ? 0 : 1)}%`);

export const hrs = (v?: number | null) => (v == null ? '—' : `${(Math.round(v * 10) / 10).toLocaleString()} h`);

export const shortDate = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const timeOf = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v.endsWith('Z') || v.includes('+') ? v : `${v}Z`);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
};

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const STATUS_COLORS: Record<string, string> = {
  pending: COLORS.warning,
  approved: COLORS.success,
  rejected: COLORS.error,
  released: COLORS.info,
  delivered: COLORS.slate,
  open: COLORS.warning,
  answered: COLORS.info,
  closed: COLORS.slate,
  draft: COLORS.gray400,
  submitted: COLORS.info,
  partially_paid: COLORS.warning,
  paid: COLORS.success,
  invited: COLORS.accentDark,
  reviewing: COLORS.warning,
  won: COLORS.success,
  lost: COLORS.error,
  declined: COLORS.gray400,
  active: COLORS.success,
  shutdown: COLORS.error,
  completed: COLORS.gray400,
  todo: COLORS.gray400,
  in_progress: COLORS.info,
  complete: COLORS.success,
  ok: COLORS.success,
  warning: COLORS.warning,
  over: COLORS.error,
  no_budget: COLORS.gray400,
  urgent: COLORS.error,
};

export const statusLabel = (s?: string | null) =>
  (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ components

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.8} style={[ui.card, style]} onPress={onPress}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[ui.card, style]}>{children}</View>;
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={ui.sectionRow}>
      <Text style={ui.sectionTitle}>{title}</Text>
      {action && onAction ? (
        <TouchableOpacity onPress={onAction} style={ui.sectionAction}>
          <MaterialIcons name="add" size={18} color={COLORS.primary} />
          <Text style={ui.sectionActionText}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function Pill({ label, color }: { label: string; color?: string }) {
  const c = color || STATUS_COLORS[label] || COLORS.slate;
  return (
    <View style={[ui.pill, { backgroundColor: c + '1F' }]}>
      <Text style={[ui.pillText, { color: c }]}>{statusLabel(label)}</Text>
    </View>
  );
}

export function Stat({ label, value, sub, color, style }: { label: string; value: string; sub?: string; color?: string; style?: ViewStyle }) {
  return (
    <View style={[ui.stat, style]}>
      <Text style={[ui.statValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={ui.statLabel}>{label}</Text>
      {sub ? <Text style={ui.statSub}>{sub}</Text> : null}
    </View>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <View style={ui.statRow}>{children}</View>;
}

export function ProgressBar({ value, color, height = 8 }: { value?: number | null; color?: string; height?: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <View style={[ui.barTrack, { height }]}>
      <View style={[ui.barFill, { width: `${v}%`, backgroundColor: color || COLORS.accent, height }]} />
    </View>
  );
}

/** Two bars: used vs budget (turns amber at 90%, red when over). */
export function BudgetBar({ actual, budget }: { actual: number; budget?: number | null }) {
  if (!budget) return <Text style={ui.muted}>{hrs(actual)} used · no budget set</Text>;
  const used = (actual / budget) * 100;
  const color = used > 100 ? COLORS.error : used >= 90 ? COLORS.warning : COLORS.success;
  return (
    <View>
      <ProgressBar value={used} color={color} />
      <Text style={[ui.muted, { marginTop: 4 }]}>
        {hrs(actual)} of {hrs(budget)} ({Math.round(used)}%)
      </Text>
    </View>
  );
}

export function Empty({ icon = 'inbox', text, sub }: { icon?: any; text: string; sub?: string }) {
  return (
    <View style={ui.empty}>
      <MaterialIcons name={icon} size={40} color={COLORS.gray300} />
      <Text style={ui.emptyText}>{text}</Text>
      {sub ? <Text style={ui.emptySub}>{sub}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={ui.loading}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  loading,
  small,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  icon?: any;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: ViewStyle;
}) {
  const bg = { primary: COLORS.primary, secondary: COLORS.accent, danger: COLORS.error, success: COLORS.success, ghost: 'transparent' }[kind];
  const fg = kind === 'ghost' ? COLORS.primary : COLORS.white;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        ui.button,
        small && ui.buttonSmall,
        { backgroundColor: bg },
        kind === 'ghost' && { borderWidth: 1, borderColor: COLORS.primary },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <MaterialIcons name={icon} size={small ? 16 : 18} color={fg} /> : null}
          <Text style={[ui.buttonText, small && { fontSize: 13 }, { color: fg }]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export function Field({ label, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={ui.fieldLabel}>{label}</Text> : null}
      <TextInput placeholderTextColor={COLORS.gray400} {...props} style={[ui.input, props.multiline && { minHeight: 80, textAlignVertical: 'top' }, props.style]} />
    </View>
  );
}

export function Chips({
  options,
  value,
  onChange,
  multi,
}: {
  options: { value: string; label: string }[];
  value: string | string[];
  onChange: (v: any) => void;
  multi?: boolean;
}) {
  const selected = (v: string) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <View style={ui.chips}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.value}
          onPress={() => {
            if (multi && Array.isArray(value)) onChange(selected(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value]);
            else onChange(o.value);
          }}
          style={[ui.chip, selected(o.value) && ui.chipOn]}
        >
          <Text style={[ui.chipText, selected(o.value) && ui.chipTextOn]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Horizontal tab strip for switching sections inside a screen. */
export function Segments({ options, value, onChange }: { options: { value: string; label: string; badge?: number }[]; value: string; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ui.segments} contentContainerStyle={{ paddingHorizontal: 12 }}>
      {options.map((o) => (
        <TouchableOpacity key={o.value} onPress={() => onChange(o.value)} style={[ui.segment, value === o.value && ui.segmentOn]}>
          <Text style={[ui.segmentText, value === o.value && ui.segmentTextOn]}>{o.label}</Text>
          {o.badge ? (
            <View style={ui.badge}>
              <Text style={ui.badgeText}>{o.badge}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

/** Bottom-sheet style form: title, scrollable body, Cancel + main action. */
export function Sheet({
  visible,
  title,
  onClose,
  onSubmit,
  submitLabel = 'Save',
  submitKind = 'primary',
  loading,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  submitKind?: 'primary' | 'danger' | 'success' | 'secondary';
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ui.sheetOverlay}>
        <View style={ui.sheet}>
          <View style={ui.sheetHeader}>
            <Text style={ui.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={24} color={COLORS.gray500} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {onSubmit ? (
            <View style={ui.sheetButtons}>
              <Button title="Cancel" kind="ghost" onPress={onClose} style={{ flex: 1 }} />
              <Button title={submitLabel} kind={submitKind} onPress={onSubmit} loading={loading} style={{ flex: 1 }} />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;
}

export function Check({ checked, label, sub, onPress }: { checked: boolean; label: string; sub?: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={ui.check} onPress={onPress}>
      <MaterialIcons name={checked ? 'check-box' : 'check-box-outline-blank'} size={24} color={checked ? COLORS.primary : COLORS.gray400} />
      <View style={{ flex: 1 }}>
        <Text style={ui.checkLabel}>{label}</Text>
        {sub ? <Text style={ui.muted}>{sub}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  pad: { padding: 16 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: COLORS.primary },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingHorizontal: 8 },
  sectionActionText: { color: COLORS.primary, fontWeight: '600' },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  muted: { fontSize: 12, color: COLORS.textSecondary },
  body: { fontSize: 14, color: COLORS.textPrimary },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '700' },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.accent,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: COLORS.primary },
  statLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  statSub: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  barTrack: { backgroundColor: COLORS.gray200, borderRadius: 4, overflow: 'hidden' },
  barFill: { borderRadius: 4 },
  empty: { alignItems: 'center', padding: 28 },
  emptyText: { fontSize: 15, fontWeight: '600', color: COLORS.textSecondary, marginTop: 8 },
  emptySub: { fontSize: 13, color: COLORS.textLight, marginTop: 4, textAlign: 'center' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  buttonSmall: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
  buttonText: { fontWeight: '700', fontSize: 15 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.gray100,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: COLORS.gray300, backgroundColor: COLORS.white },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 13, color: COLORS.textPrimary },
  chipTextOn: { color: COLORS.white, fontWeight: '600' },
  segments: { backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.gray200, flexGrow: 0 },
  segment: { paddingVertical: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  segmentOn: { borderBottomColor: COLORS.accent },
  segmentText: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '600' },
  segmentTextOn: { color: COLORS.primary },
  badge: { backgroundColor: COLORS.error, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: COLORS.white, fontSize: 11, fontWeight: '700' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(6,24,56,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxWidth: 720, width: '100%', alignSelf: 'center' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: COLORS.primary, flex: 1, marginRight: 8 },
  sheetButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checkLabel: { fontSize: 15, color: COLORS.textPrimary },
  divider: { height: 1, backgroundColor: COLORS.gray200, marginVertical: 10 },
  warnBox: { backgroundColor: '#FDF3E1', borderLeftWidth: 4, borderLeftColor: COLORS.warning, padding: 10, borderRadius: 8, marginBottom: 12 },
  dangerBox: { backgroundColor: '#FDECEC', borderLeftWidth: 4, borderLeftColor: COLORS.error, padding: 10, borderRadius: 8, marginBottom: 12 },
  infoBox: { backgroundColor: COLORS.primaryTint, borderLeftWidth: 4, borderLeftColor: COLORS.primary, padding: 10, borderRadius: 8, marginBottom: 12 },
});
