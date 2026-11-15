import React, { useCallback, useState } from 'react';
import { ScrollView, RefreshControl, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { fieldApi, apiError } from '../../src/services/pmService';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';
import { Card, Row, Empty, Loading, shortDate, ui } from '../../src/components/ui';

export default function CrewSafety() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await fieldApi.crewSafety());
      setError('');
    } catch (e) {
      setError(apiError(e));
      setRows([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!rows) return <Loading />;
  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <Text style={[ui.muted, { marginBottom: 12 }]}>Crew on your sites with safety documents that are expired or expire within 7 days. People on site right now are listed first.</Text>
        {error ? <Text style={ui.body}>{error}</Text> : null}
        {rows.length === 0 ? <Empty icon="verified" text="Everyone's documents are current" /> : null}
        {rows.map((r) => (
          <Card key={`${r.user_id}-${r.id}`} style={r.expired ? { borderLeftWidth: 4, borderLeftColor: COLORS.error } : { borderLeftWidth: 4, borderLeftColor: COLORS.warning }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={ui.title}>{r.user_name}</Text>
              {r.on_site_now ? (
                <Row style={{ gap: 4 }}>
                  <MaterialIcons name="engineering" size={16} color={COLORS.primary} />
                  <Text style={ui.muted}>on site now</Text>
                </Row>
              ) : null}
            </Row>
            <Text style={ui.body}>{r.name}</Text>
            <Text style={{ color: r.expired ? COLORS.error : COLORS.warning, fontWeight: '700' }}>
              {r.expired ? `EXPIRED ${shortDate(r.expiry_date)}` : `Expires ${shortDate(r.expiry_date)} (${r.days_until_expiry} day(s))`}
            </Text>
          </Card>
        ))}
        <Footer />
      </ScrollView>
    </SafeAreaView>
  );
}
