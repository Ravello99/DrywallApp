// Opened from the reset link in the email: /reset-password?token=...
import React, { useState } from 'react';
import { Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { authService } from '../src/services/authService';
import { apiError } from '../src/services/pmService';
import { clearSessionCache, landingFor } from '../src/services/session';
import { useAuthStore } from '../src/store/authStore';
import { COLORS } from '../src/constants/colors';
import { Button, Card, Field, ui } from '../src/components/ui';
import PasswordRules, { passwordIssues } from '../src/components/PasswordRules';

export default function ResetPassword() {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (passwordIssues(pw, confirm).some((r) => !r.ok)) return setError('Check the password rules below.');
    setBusy(true);
    setError('');
    try {
      const { user } = await authService.resetPassword(String(token || ''), pw);
      setUser(user);
      clearSessionCache();
      router.replace(landingFor(user) as any);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[ui.screen, { backgroundColor: COLORS.primary }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
          <Card style={{ maxWidth: 440, width: '100%', alignSelf: 'center', padding: 22 }}>
            <MaterialIcons name="password" size={36} color={COLORS.primary} />
            <Text style={[ui.title, { fontSize: 20, marginTop: 8, marginBottom: 14 }]}>Choose a new password</Text>
            {!token ? (
              <>
                <Text style={[ui.body, { marginBottom: 16 }]}>This link is incomplete. Open the link from the email again, or ask for a new one.</Text>
                <Button title="Ask for a new link" onPress={() => router.replace('/forgot-password')} />
              </>
            ) : (
              <>
                <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" />
                <Field label="New password again" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" onSubmitEditing={submit} />
                <PasswordRules password={pw} confirm={confirm} />
                {error ? <Text style={{ color: COLORS.error, marginBottom: 10 }}>{error}</Text> : null}
                <Button title={busy ? 'Saving…' : 'Save password and sign in'} onPress={submit} disabled={busy} />
                {/expired|used/i.test(error) ? (
                  <>
                    <Text style={{ height: 10 }} />
                    <Button title="Ask for a new link" kind="ghost" onPress={() => router.replace('/forgot-password')} />
                  </>
                ) : null}
              </>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
