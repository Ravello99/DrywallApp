// "More" tab: links to the screens that don't fit in the tab bar, plus sign out.
import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, COMPANY } from '../constants/colors';
import { roleLabel } from '../constants/roles';
import { useAuthStore } from '../store/authStore';
import { authService } from '../services/authService';
import { notificationsApi } from '../services/pmService';
import Footer from './Footer';
import { ui } from './ui';

export type MoreLink = { label: string; sub?: string; icon: any; href: string; show?: boolean };

export default function MoreMenu({ links }: { links: MoreLink[] }) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      notificationsApi
        .list(true)
        .then((r) => setUnread(r.unread))
        .catch(() => undefined);
    }, []),
  );

  const signOut = async () => {
    await authService.logout();
    logout();
    router.replace('/');
  };

  const all: MoreLink[] = [{ label: 'Notifications', icon: 'notifications', href: 'notifications', sub: unread ? `${unread} unread` : undefined }, ...links];

  return (
    <ScrollView contentContainerStyle={ui.pad}>
      <View style={[ui.card, { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}>
        <Text style={{ color: COLORS.white, fontSize: 18, fontWeight: '800' }}>{user?.name}</Text>
        <Text style={{ color: COLORS.accentLight, marginTop: 2 }}>
          {roleLabel(user?.role)} · {COMPANY.name}
        </Text>
      </View>
      {all
        .filter((l) => l.show !== false)
        .map((l) => (
          <TouchableOpacity key={l.href} style={[ui.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]} onPress={() => router.push(l.href as any)}>
            <MaterialIcons name={l.icon} size={24} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={ui.title}>{l.label}</Text>
              {l.sub ? <Text style={ui.muted}>{l.sub}</Text> : null}
            </View>
            <MaterialIcons name="chevron-right" size={22} color={COLORS.gray400} />
          </TouchableOpacity>
        ))}
      <TouchableOpacity style={[ui.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]} onPress={signOut}>
        <MaterialIcons name="logout" size={24} color={COLORS.error} />
        <Text style={[ui.title, { color: COLORS.error }]}>Sign out</Text>
      </TouchableOpacity>
      <Footer />
    </ScrollView>
  );
}
