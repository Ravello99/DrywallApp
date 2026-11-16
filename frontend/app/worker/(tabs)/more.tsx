import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import MoreMenu from '../../../src/components/MoreMenu';
import { useAuthStore } from '../../../src/store/authStore';
import { ui } from '../../../src/components/ui';

export default function WorkerMore() {
  const { user } = useAuthStore();
  const foreman = user?.role === 'foreman';
  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <MoreMenu
        links={[
          { label: 'Crew Safety', sub: 'Expired / expiring documents on your sites', icon: 'health-and-safety', href: '/worker/crew-safety', show: foreman },
          { label: 'RFIs', sub: 'Ask the PM a question and track the answer', icon: 'help-outline', href: '/worker/rfis', show: foreman },
          { label: 'Receipts', sub: 'Snap a receipt for materials or supplies', icon: 'receipt-long', href: '/worker/expenses', show: foreman },
          { label: 'Forms', sub: foreman ? 'Fill out forms or send them to your crew' : 'Forms to fill out', icon: 'description', href: '/worker/forms' },
          { label: 'My Hours', sub: 'Hours per week and history', icon: 'timer', href: '/worker/hours' },
          { label: 'Safety Documents', sub: 'Upload and renew your certificates', icon: 'security', href: '/worker/safety' },
          { label: 'Announcements', icon: 'campaign', href: '/worker/announcements' },
          { label: 'Profile', icon: 'person', href: '/worker/profile' },
        ]}
      />
    </SafeAreaView>
  );
}
