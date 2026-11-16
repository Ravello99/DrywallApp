// The manager area's tab buttons. Other pages (forms, notifications, ...) are stacked on top of
// these tabs by ../_layout.tsx, so they open with a back button instead of being hidden tabs
// (hidden tabs stopped opening reliably in Expo Router 58).
import React from 'react';
import { Tabs } from 'expo-router';
import { COLORS } from '../../../src/constants/colors';
import BrandTabBar from '../../../src/components/BrandTabBar';
import { useAuthStore } from '../../../src/store/authStore';

export default function ManagerTabs() {
  const { user } = useAuthStore();
  const role = user?.role || '';
  const canBid = ['admin', 'project_coordinator', 'estimator', 'project_manager'].includes(role);
  const canApprove = ['admin', 'project_manager', 'project_coordinator'].includes(role);

  return (
    <Tabs
      tabBar={() => (
        <BrandTabBar
          base="/manager"
          aliases={{ project: 'projects' }}
          tabs={[
            { name: 'index', label: 'Dashboard', icon: 'dashboard' },
            { name: 'projects', label: 'Projects', icon: 'apartment' },
            ...(canBid ? [{ name: 'bids', label: 'Bids', icon: 'request-quote' }] : []),
            ...(canApprove ? [{ name: 'approvals', label: 'Approvals', icon: 'pending-actions' }] : []),
            { name: 'members', label: 'Team', icon: 'people' },
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
      <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="projects" options={{ title: 'Projects' }} />
      <Tabs.Screen name="bids" options={{ title: 'Bids' }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals' }} />
      <Tabs.Screen name="members" options={{ title: 'Team & Sites' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
