// Manager area: checks who is signed in, then shows the tabs with every other page stacked on top.
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, Redirect } from 'expo-router';
import { COLORS } from '../../src/constants/colors';
import { useAuthStore } from '../../src/store/authStore';
import { resolveSession, homeFor } from '../../src/services/session';
import { isOfficeRole } from '../../src/constants/roles';
import HeaderBack from '../../src/components/HeaderBack';

export default function ManagerLayout() {
  const { setUser } = useAuthStore();
  const [checking, setChecking] = useState(true);
  // Redirects are rendered (<Redirect>) rather than called from an effect, so they work
  // with Expo Router 58's navigation core.
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    resolveSession().then((u) => {
      if (!live) return;
      if (!u) return setTarget('/');
      if (!(isOfficeRole(u.role))) return setTarget(homeFor(u.role));
      setUser(u);
      setChecking(false);
    });
    return () => {
      live = false;
    };
  }, []);

  if (target) return <Redirect href={target as any} />;

  if (checking) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.primary },
        headerTintColor: COLORS.white,
        headerTitleStyle: { fontWeight: 'bold' },
        headerLeft: () => <HeaderBack fallback="/manager" />,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="timesheets" options={{ title: 'Timesheets' }} />
        <Stack.Screen name="safety" options={{ title: 'Safety Documents' }} />
        <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
        <Stack.Screen name="tasks" options={{ title: 'All Tasks' }} />
        <Stack.Screen name="forms" options={{ title: 'Forms' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="accounting" options={{ title: 'Accounting' }} />
        <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
