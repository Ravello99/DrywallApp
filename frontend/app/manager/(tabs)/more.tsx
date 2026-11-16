import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import MoreMenu from '../../../src/components/MoreMenu';
import { ui } from '../../../src/components/ui';
import { useAuthStore } from '../../../src/store/authStore';

export default function ManagerMore() {
  const { user } = useAuthStore();
  const accounting = ['admin', 'project_coordinator'].includes(user?.role || '');
  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <MoreMenu
        links={[
          { label: 'Accounting', sub: 'Labour payouts, progress draws, hour downloads', icon: 'account-balance', href: '/manager/accounting', show: accounting },
          { label: 'Time & Attendance', sub: 'Who is on site, clock people out, fix hours', icon: 'more-time', href: '/manager/time', show: ['admin', 'project_manager', 'project_coordinator'].includes(user?.role || '') },
          { label: 'Receipts & Expenses', sub: 'Snap a receipt for a job or the office', icon: 'receipt-long', href: '/manager/expenses' },
          { label: 'Team & Sites', sub: 'Employees, sites, shut down / reopen', icon: 'people', href: '/manager/members' },
          { label: 'Timesheets', sub: 'Hours and Excel export', icon: 'schedule', href: '/manager/timesheets' },
          { label: 'Safety Documents', sub: 'Expiring and expired certificates', icon: 'verified-user', href: '/manager/safety' },
          { label: 'Forms', sub: 'Build forms and send them out', icon: 'description', href: '/manager/forms' },
          { label: 'All Tasks', icon: 'checklist', href: '/manager/tasks' },
          { label: 'Announcements', icon: 'campaign', href: '/manager/announcements' },
        ]}
      />
    </SafeAreaView>
  );
}
