// The worker area's tab buttons. Other pages (forms, notifications, ...) are stacked on top of
// these tabs by ../_layout.tsx, so they open with a back button instead of being hidden tabs
// (hidden tabs stopped opening reliably in Expo Router 58).
import React from 'react';
import { Tabs } from 'expo-router';
import { COLORS } from '../../../src/constants/colors';
import BrandTabBar from '../../../src/components/BrandTabBar';
import { useAuthStore } from '../../../src/store/authStore';
import LocationPrompt from '../../../src/components/LocationPrompt';

export default function WorkerTabs() {
  const { user } = useAuthStore();
  const isForeman = user?.role === 'foreman';

  return (
    <>
    <LocationPrompt mode="modal" />
    <Tabs
      tabBar={() => (
        <BrandTabBar
          base="/worker"
          aliases={{}}
          tabs={[
            { name: 'index', label: 'Home', icon: 'home' },
            { name: 'clock', label: 'Clock', icon: 'access-time' },
            { name: 'calendar', label: 'Calendar', icon: 'event' },
            { name: 'tasks', label: 'Tasks', icon: 'checklist' },
            ...(isForeman ? [{ name: 'requests', label: 'Requests', icon: 'local-shipping' }] : []),
            { name: 'more', label: 'More', icon: 'menu' },
          ]}
        />
      )}
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.primary },
        headerTintColor: COLORS.white,
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="clock" options={{ title: 'Clock In/Out' }} />
      <Tabs.Screen name="calendar" options={{ title: 'My Calendar' }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks' }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
    </>
  );
}
