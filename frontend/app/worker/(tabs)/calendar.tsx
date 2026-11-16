import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Calendar } from 'react-native-calendars';
import { manpowerApi, apiError } from '../../../src/services/pmService';
import { COLORS } from '../../../src/constants/colors';
import Footer from '../../../src/components/Footer';
import { Card, Empty, Loading, SectionTitle, shortDate, todayISO, ui } from '../../../src/components/ui';

type Day = { date: string; sites: { site_id: string; site_name: string; shut_down: boolean }[]; tasks_due: { id: string; title: string; site_name?: string }[] };

export default function CalendarScreen() {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [days, setDays] = useState<Day[] | null>(null);
  const [selected, setSelected] = useState(todayISO());
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const first = new Date(`${month}-01T12:00:00`);
    const start = new Date(first);
    start.setDate(start.getDate() - 7);
    const end = new Date(first);
    end.setMonth(end.getMonth() + 1);
    end.setDate(end.getDate() + 7);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    try {
      const res = await manpowerApi.calendar(iso(start), iso(end));
      setDays(res.days);
      setError('');
    } catch (e) {
      setError(apiError(e));
      setDays([]);
    } finally {
      setRefreshing(false);
    }
  }, [month]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const marked = useMemo(() => {
    const m: Record<string, any> = {};
    (days || []).forEach((d) => {
      m[d.date] = {
        marked: true,
        dotColor: d.sites.some((s) => s.shut_down) ? COLORS.error : d.tasks_due.length ? COLORS.accent : COLORS.primary,
      };
    });
    m[selected] = { ...(m[selected] || {}), selected: true, selectedColor: COLORS.primary };
    return m;
  }, [days, selected]);

  if (!days) return <Loading />;
  const day = days.find((d) => d.date === selected);
  const upcoming = days.filter((d) => d.date >= todayISO()).slice(0, 10);

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <Calendar
          current={`${month}-01`}
          markedDates={marked}
          onDayPress={(d: any) => setSelected(d.dateString)}
          onMonthChange={(m: any) => setMonth(m.dateString.slice(0, 7))}
          theme={{ todayTextColor: COLORS.accentDark, arrowColor: COLORS.primary, selectedDayBackgroundColor: COLORS.primary }}
        />
        <View style={ui.pad}>
          {error ? <Text style={ui.body}>{error}</Text> : null}
          <SectionTitle title={shortDate(selected)} />
          {!day ? (
            <Empty icon="event-busy" text="Nothing scheduled" sub="Assignments from your PM show up here." />
          ) : (
            <>
              {day.sites.map((s) => (
                <Card key={s.site_id}>
                  <Text style={ui.title}>{s.site_name}</Text>
                  {s.shut_down ? <Text style={{ color: COLORS.error }}>This site is currently shut down</Text> : <Text style={ui.muted}>Assigned</Text>}
                </Card>
              ))}
              {day.tasks_due.map((t) => (
                <Card key={t.id}>
                  <Text style={ui.title}>Task due: {t.title}</Text>
                  <Text style={ui.muted}>{t.site_name}</Text>
                </Card>
              ))}
            </>
          )}
          <SectionTitle title="Coming up" />
          {upcoming.length === 0 ? <Text style={ui.muted}>No upcoming assignments.</Text> : null}
          {upcoming.map((d) => (
            <Text key={d.date} style={[ui.body, { marginBottom: 4 }]}>
              {shortDate(d.date)}: {[...d.sites.map((s) => s.site_name), ...d.tasks_due.map((t) => `task due: ${t.title}`)].join(', ')}
            </Text>
          ))}
        </View>
        <Footer />
      </ScrollView>
    </SafeAreaView>
  );
}
