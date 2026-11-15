import React, { useCallback, useState } from 'react';
import { ScrollView, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { fieldApi, apiError } from '../../src/services/pmService';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';
import { Card, Row, Loading, Stat, StatRow, hrs, shortDate, timeOf, ui } from '../../src/components/ui';

export default function HoursScreen() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fieldApi.hours(12);
      setData(d);
      setOpen((prev) => prev ?? d.weeks[0]?.week_start ?? null);
      setError('');
    } catch (e) {
      setError(apiError(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!data && !error) return <Loading />;
  const weeks = data?.weeks || [];
  const avg = weeks.length ? weeks.slice(1, 5).reduce((s: number, w: any) => s + w.hours, 0) / Math.max(1, Math.min(4, weeks.length - 1)) : 0;
  const max = Math.max(1, ...weeks.map((w: any) => w.hours));

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {error ? <Text style={ui.body}>{error}</Text> : null}
        <StatRow>
          <Stat label="This week" value={hrs(data?.this_week)} />
          <Stat label="Average (last 4 weeks)" value={hrs(avg)} />
        </StatRow>
        {weeks.map((w: any) => (
          <Card key={w.week_start} onPress={() => setOpen(open === w.week_start ? null : w.week_start)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={ui.title}>
                {shortDate(w.week_start)} – {shortDate(w.week_end)}
              </Text>
              <Text style={[ui.title, { color: COLORS.primary }]}>{hrs(w.hours)}</Text>
            </Row>
            <View style={{ height: 6, backgroundColor: COLORS.gray200, borderRadius: 3, marginTop: 6 }}>
              <View style={{ width: `${(w.hours / max) * 100}%`, height: 6, backgroundColor: w.hours > 40 ? COLORS.accent : COLORS.primary, borderRadius: 3 }} />
            </View>
            {open === w.week_start ? (
              <View style={{ marginTop: 10 }}>
                {w.records.length === 0 ? <Text style={ui.muted}>No hours this week</Text> : null}
                {w.records.map((r: any) => (
                  <View key={r.id} style={{ marginBottom: 8 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text style={ui.body}>
                        {shortDate(r.clock_in)} · {r.site_name}
                      </Text>
                      <Text style={ui.body}>{r.open ? 'on now' : hrs(r.hours)}</Text>
                    </Row>
                    <Text style={ui.muted}>
                      {timeOf(r.clock_in)} – {r.clock_out ? timeOf(r.clock_out) : '…'}
                      {r.task_title ? ` · ${r.task_title}` : ''}
                      {r.auto_clock_out_reason ? ` · ${r.auto_clock_out_reason}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ))}
        <Footer />
      </ScrollView>
    </SafeAreaView>
  );
}
