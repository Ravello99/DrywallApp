// In-app notifications (approvals, assignments, safety expiry, budgets, bids...).
import React, { useCallback, useState } from 'react';
import { ScrollView, RefreshControl, Text, Alert } from 'react-native';
import { useFocusEffect, useRouter, usePathname } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { AppNotification } from '../types/features';
import { notificationsApi, apiError } from '../services/pmService';
import { COLORS } from '../constants/colors';
import { Card, Row, Button, Empty, Loading, shortDate, timeOf, ui } from './ui';

const ICONS: Record<string, any> = {
  safety: 'health-and-safety',
  budget: 'timer',
  exposure: 'trending-up',
  bid: 'request-quote',
  invoice: 'receipt-long',
  approval: 'pending-actions',
  request: 'inventory',
  assignment: 'event',
  rfi: 'help-outline',
  task: 'checklist',
  form: 'description',
};

// The same alert can go to office staff and foremen (e.g. a task over budget), so point each
// link at the matching screen in the area this person uses.
const OFFICE_EQUIVALENT: Record<string, string> = {
  '/worker/requests': '/manager/approvals',
  '/worker/rfis': '/manager/projects',
  '/worker/calendar': '/manager/projects',
  '/worker/tasks': '/manager/projects',
  '/worker/forms': '/manager/forms',
  '/worker/safety': '/manager/safety',
};
const FIELD_EQUIVALENT: Record<string, string> = {
  '/manager/projects': '/worker',
  '/manager/approvals': '/worker/requests',
  '/manager/bids': '/worker',
};

export function linkFor(link: string, inOffice: boolean): string {
  if (inOffice && link.startsWith('/worker')) return OFFICE_EQUIVALENT[link] || '/manager';
  if (!inOffice && link.startsWith('/manager')) return FIELD_EQUIVALENT[link] || '/worker';
  return link;
}

export default function NotificationsList() {
  const router = useRouter();
  const inOffice = (usePathname() || '').startsWith('/manager');
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await notificationsApi.list();
      setItems(res.items);
    } catch (e) {
      Alert.alert('Error', apiError(e));
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const open = async (n: AppNotification) => {
    if (!n.read) {
      notificationsApi.read(n.id).catch(() => undefined);
      setItems((prev) => (prev || []).map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    if (n.link) router.push(linkFor(n.link, inOffice) as any);
  };

  const readAll = async () => {
    try {
      await notificationsApi.readAll();
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    }
  };

  if (!items) return <Loading />;
  return (
    <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      {items.some((n) => !n.read) ? <Button title="Mark all read" kind="ghost" small onPress={readAll} style={{ alignSelf: 'flex-end', marginBottom: 10 }} /> : null}
      {items.length === 0 ? (
        <Empty icon="notifications-none" text="No notifications yet" />
      ) : (
        items.map((n) => (
          <Card key={n.id} onPress={() => open(n)} style={!n.read ? { borderLeftWidth: 4, borderLeftColor: COLORS.accent } : undefined}>
            <Row style={{ alignItems: 'flex-start' }}>
              <MaterialIcons name={ICONS[n.kind || ''] || 'notifications'} size={22} color={n.read ? COLORS.gray400 : COLORS.primary} />
              <Row style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <Text style={[ui.title, n.read ? { fontWeight: '500' } : null]}>{n.title}</Text>
                {n.body ? <Text style={ui.body}>{n.body}</Text> : null}
                <Text style={ui.muted}>
                  {shortDate(n.created_at)} {timeOf(n.created_at)}
                </Text>
              </Row>
            </Row>
          </Card>
        ))
      )}
    </ScrollView>
  );
}
