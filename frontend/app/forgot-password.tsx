// "Forgot password?" from the sign-in screen. Emails a reset link when email is set up on the
// server; either way the office is told so a manager can give a temporary password.
import React, { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { authService } from '../src/services/authService';
import { apiError } from '../src/services/pmService';
import { COLORS } from '../src/constants/colors';
import { Button, Card, Field, ui } from '../src/components/ui';

export default function ForgotPassword() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<null | { email_enabled: boolean }>(null);

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter the email address you sign in with.');
    setBusy(true);
    setError('');
    try {
      setSent(await authService.forgotPassword(email.trim()));
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
            <MaterialIcons name="lock-reset" size={36} color={COLORS.primary} />
            <Text style={[ui.title, { fontSize: 20, marginTop: 8, marginBottom: 6 }]}>Reset your password</Text>
            {sent ? (
              <>
                <Text style={[ui.body, { marginBottom: 12, lineHeight: 20 }]}>
                  {sent.email_enabled
                    ? `If ${email.trim()} has an account, we've emailed a link to set a new password. It works for 60 minutes. Check your junk folder if you don't see it.`
                    : `We've let the office know. A project manager or coordinator will give you a temporary password, usually by phone or text.`}
                </Text>
                <Text style={[ui.muted, { marginBottom: 16 }]}>
                  {sent.email_enabled ? "No email after a few minutes? Ask your PM or coordinator to reset it for you." : 'Sign in with the temporary password and you\'ll be asked to choose your own.'}
                </Text>
                <Button title="Back to sign in" onPress={() => router.replace('/')} />
              </>
            ) : (
              <>
                <Text style={[ui.body, { marginBottom: 16, lineHeight: 20 }]}>Enter the email you sign in with and we'll help you get back in.</Text>
                <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" onSubmitEditing={submit} />
                {error ? <Text style={{ color: COLORS.error, marginBottom: 10 }}>{error}</Text> : null}
                <Button title={busy ? 'Sending…' : 'Reset password'} onPress={submit} disabled={busy} />
                <View style={{ height: 10 }} />
                <Button title="Back to sign in" kind="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
              </>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
