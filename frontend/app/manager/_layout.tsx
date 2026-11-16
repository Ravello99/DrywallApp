import '../../src/utils/webAlert'; // browser-friendly Alert.alert (must load first)
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/colors';
import { useAuthStore } from '../../src/store/authStore';
import { authService } from '../../src/services/authService';
import { isOfficeRole } from '../../src/constants/roles';

export default function ManagerLayout() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    try {
      // Check if user is in store
      if (user && isOfficeRole(user.role)) {
        setChecking(false);
        return;
      }

      // Try to get stored user
      const storedUser = await authService.getStoredUser();
      const token = await authService.getStoredToken();

      if (!token || !storedUser) {
        // Not logged in - redirect to login
        router.replace('/');
        return;
      }

      if (!isOfficeRole(storedUser.role)) {
        // Not a manager - redirect to worker or login
        if (storedUser.role) {
          router.replace('/worker');
        } else {
          router.replace('/');
        }
        return;
      }

      // Valid manager - set user and continue
      setUser(storedUser);
      setChecking(false);
    } catch (error) {
      console.error('Access check error:', error);
      router.replace('/');
    }
  };

  const role = user?.role || '';
  const canBid = ['admin', 'project_coordinator', 'estimator', 'project_manager'].includes(role);
  const canApprove = ['admin', 'project_manager'].includes(role);

  if (checking) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.gray400,
        // No fixed height: the tab bar sizes itself to fit icon + label and adds the phone's
        // bottom safe-area space (a fixed 60px cut the labels off).
        tabBarStyle: {
          backgroundColor: COLORS.white,
          borderTopWidth: 1,
          borderTopColor: COLORS.gray200,
        },
        tabBarItemStyle: {
          paddingTop: 4,
          paddingBottom: 2,
        },
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
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
