// Set a new password. Required on first sign-in and after a manager gives a temporary password
// (the app sends people here and won't let them past until it's done); also reachable from
// More > Change password.
import React, { useEffect, useState } from 'react';
import { Text, ScrollView, KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { authService } from '../src/services/authService';
import { apiError } from '../src/services/pmService';
import { clearSessionCache, homeFor, resolveSession, SessionUser } from '../src/services/session';
import { useAuthStore } from '../src/store/authStore';
import { COLORS, COMPANY } from '../src/constants/colors';
import { Button, Card, Field, Loading, ui } from '../src/components/ui';
import PasswordRules, { passwordIssues } from '../src/components/PasswordRules';

export default function ChangePassword() {
  const router = useRouter();
  const { setUser, logout } = useAuthStore();
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined);
  const remembered = authService.signInPassword();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    resolveSession(true).then(setMe);
  }, []);

  if (me === undefined) return <Loading />;
  if (me === null) return <Redirect href="/" />;
  const forced = !!me.must_change_password;

  const submit = async () => {
    const cur = forced && remembered ? remembered : current;
    if (!cur) return setError(forced ? 'Enter the temporary password you signed in with.' : 'Enter your current password.');
    if (passwordIssues(pw, confirm).some((r) => !r.ok)) return setError('Check the password rules below.');
    setBusy(true);
    setError('');
    try {
      const { user } = await authService.changePassword(cur, pw);
      setUser(user);
      clearSessionCache();
      router.replace(homeFor(user.role));
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await authService.logout();
    clearSessionCache();
    logout();
    router.replace('/');
  };

  return (
    <SafeAreaView style={[ui.screen, { backgroundColor: COLORS.primary }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
          <Card style={{ maxWidth: 440, width: '100%', alignSelf: 'center', padding: 22 }}>
            <MaterialIcons name={forced ? 'verified-user' : 'password'} size={36} color={COLORS.primary} />
            <Text style={[ui.title, { fontSize: 20, marginTop: 8, marginBottom: 6 }]}>{forced ? 'Set your own password' : 'Change password'}</Text>
            {forced ? (
              <Text style={[ui.body, { marginBottom: 16, lineHeight: 20 }]}>
                Welcome{me.name ? `, ${me.name.split(' ')[0]}` : ''}. You signed in with a temporary password. Choose your own to start using the {COMPANY.name.split(' ')[0]} app.
              </Text>
            ) : (
              <View style={{ height: 8 }} />
            )}
            {!(forced && remembered) ? (
              <Field label={forced ? 'Temporary password' : 'Current password'} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
            ) : null}
            <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" />
            <Field label="New password again" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" onSubmitEditing={submit} />
            <PasswordRules password={pw} confirm={confirm} />
            {error ? <Text style={{ color: COLORS.error, marginBottom: 10 }}>{error}</Text> : null}
            <Button title={busy ? 'Saving…' : 'Save password'} onPress={submit} disabled={busy} />
            <View style={{ height: 10 }} />
            {forced ? (
              <Button title="Sign out" kind="ghost" onPress={signOut} />
            ) : (
              <Button title="Cancel" kind="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace(homeFor(me.role)))} />
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
