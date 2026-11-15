import '../../src/utils/webAlert'; // browser-friendly Alert.alert (must load first)
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/colors';
import { useAuthStore } from '../../src/store/authStore';
import { authService } from '../../src/services/authService';
import { isOfficeRole } from '../../src/constants/roles';

export default function WorkerLayout() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    try {
      // Check if user is in store and is a worker (non-manager)
      if (user && !isOfficeRole(user.role)) {
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

      if (isOfficeRole(storedUser.role)) {
        // Is a manager - redirect to manager area
        router.replace('/manager');
        return;
      }

      // Valid worker - set user and continue
      setUser(storedUser);
      setChecking(false);
    } catch (error) {
      console.error('Access check error:', error);
      router.replace('/');
    }
  };

  const isForeman = user?.role === 'foreman';

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
        tabBarStyle: {
          backgroundColor: COLORS.white,
          borderTopWidth: 1,
          borderTopColor: COLORS.gray200,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
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
          title: 'Home',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="clock"
        options={{
          title: 'Clock In/Out',
          tabBarLabel: 'Clock',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="access-time" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'My Calendar',
          tabBarLabel: 'Calendar',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="event" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: isForeman ? 'Site Tasks' : 'My Tasks',
          tabBarLabel: 'Tasks',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="checklist" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
          href: isForeman ? undefined : null,
          tabBarIcon: ({ color, size }) => <MaterialIcons name="local-shipping" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, size }) => <MaterialIcons name="menu" size={size} color={color} />,
        }}
      />
      {/* Reached from Home / More, not the tab bar */}
      <Tabs.Screen name="forms" options={{ href: null, title: 'Forms' }} />
      <Tabs.Screen name="safety" options={{ href: null, title: 'Safety Documents' }} />
      <Tabs.Screen name="announcements" options={{ href: null, title: 'Announcements' }} />
      <Tabs.Screen name="profile" options={{ href: null, title: 'Profile' }} />
      <Tabs.Screen name="hours" options={{ href: null, title: 'My Hours' }} />
      <Tabs.Screen name="rfis" options={{ href: null, title: 'RFIs' }} />
      <Tabs.Screen name="crew-safety" options={{ href: null, title: 'Crew Safety' }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
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
