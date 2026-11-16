import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/colors';
import BrandTabBar from '../../src/components/BrandTabBar';
import { useAuthStore } from '../../src/store/authStore';
import { resolveSession, homeFor } from '../../src/services/session';
import { isOfficeRole } from '../../src/constants/roles';

export default function ManagerLayout() {
  const { user, setUser } = useAuthStore();
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

  const role = user?.role || '';
  const canBid = ['admin', 'project_coordinator', 'estimator', 'project_manager'].includes(role);
  const canApprove = ['admin', 'project_manager'].includes(role);

  if (target) return <Redirect href={target as any} />;

  if (checking) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

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
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.gray400,
        headerStyle: {
          backgroundColor: COLORS.primary,
        },
        headerTintColor: COLORS.white,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="dashboard" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="apartment" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bids"
        options={{
          title: 'Bids',
          href: canBid ? undefined : null,
          tabBarIcon: ({ color, size }) => <MaterialIcons name="request-quote" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          href: canApprove ? undefined : null,
          tabBarIcon: ({ color, size }) => <MaterialIcons name="pending-actions" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'Team & Sites',
          tabBarLabel: 'Team',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="menu" size={size} color={color} />,
        }}
      />
      {/* Reached from the dashboard / More / project cards, not the tab bar */}
      <Tabs.Screen name="timesheets" options={{ href: null, title: 'Timesheets' }} />
      <Tabs.Screen name="safety" options={{ href: null, title: 'Safety Documents' }} />
      <Tabs.Screen name="announcements" options={{ href: null, title: 'Announcements' }} />
      <Tabs.Screen name="tasks" options={{ href: null, title: 'All Tasks' }} />
      <Tabs.Screen name="forms" options={{ href: null, title: 'Forms' }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
      <Tabs.Screen name="project/[id]" options={{ href: null, title: 'Project' }} />
    </Tabs>
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
