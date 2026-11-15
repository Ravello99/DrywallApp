import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import NotificationsList from '../../src/components/NotificationsList';
import { ui } from '../../src/components/ui';

export default function NotificationsScreen() {
  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <NotificationsList />
    </SafeAreaView>
  );
}
