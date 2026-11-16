// Live checklist under a new-password field (same rules the server enforces).
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';

export function passwordIssues(pw: string, confirm: string) {
  return [
    { ok: pw.length >= 8, text: 'At least 8 characters' },
    { ok: /[a-zA-Z]/.test(pw) && /[^a-zA-Z]/.test(pw), text: 'Letters and at least one number or symbol' },
    { ok: pw.length > 0 && pw === confirm, text: 'Both entries match' },
  ];
}

export default function PasswordRules({ password, confirm }: { password: string; confirm: string }) {
  return (
    <View style={{ marginBottom: 12, gap: 4 }}>
      {passwordIssues(password, confirm).map((r) => (
        <View key={r.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MaterialIcons name={r.ok ? 'check-circle' : 'radio-button-unchecked'} size={16} color={r.ok ? COLORS.success : COLORS.gray400} />
          <Text style={{ fontSize: 13, color: r.ok ? COLORS.textPrimary : COLORS.textSecondary }}>{r.text}</Text>
        </View>
      ))}
    </View>
  );
}
