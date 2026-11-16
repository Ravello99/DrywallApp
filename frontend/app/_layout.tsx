// Root layout: one stack holding the login screen and the office / field areas.
// (Expo Router needs a mounted root before screens can redirect.)
import '../src/utils/webViewportFix'; // size the web app to the visible screen
import '../src/utils/webAlert'; // browser-friendly Alert.alert
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="manager" />
        <Stack.Screen name="worker" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="change-password" />
      </Stack>
    </SafeAreaProvider>
  );
}
