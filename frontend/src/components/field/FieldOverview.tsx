// Top of the crew dashboard: hours this week, where I'm working, my safety documents, and for
// foremen each of their sites at a glance (men on site, progress, outstanding tasks).
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { fieldApi } from '../../services/pmService';
import { COLORS } from '../../constants/colors';
import { specialtyLabel } from '../../constants/roles';
import { Card, ProgressBar, Row, Stat, StatRow, SectionTitle, Pill, hrs, pct, shortDate, timeOf, ui } from '../ui';

export default function FieldOverview() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [openSite, setOpenSite] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      fieldApi
        .dashboard()
        .then(setData)
        .catch(() => setData(null));
    }, []),
  );

  if (!data) return null;
  const go = (href: string) => router.push(href as any);

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <StatRow>
        <TouchableOpacity style={{ flexGrow: 1, flexBasis: '45%' }} onPress={() => go('/worker/hours')}>
          <Stat label="Hours this week" value={hrs(data.hours_this_week)} sub="tap for history" style={{ flexBasis: 'auto' }} />
        </TouchableOpacity>
        <TouchableOpacity style={{ flexGrow: 1, flexBasis: '45%' }} onPress={() => go('/worker/calendar')}>
          <Stat
            label="Working today at"
            value={data.assigned_today.length ? data.assigned_today.map((a: any) => a.site_name).join(', ') : '—'}
            sub="tap for calendar"
            style={{ flexBasis: 'auto' }}
          />
        </TouchableOpacity>
      </StatRow>

      {data.pending_forms > 0 || data.my_open_tasks > 0 || data.unread_notifications > 0 ? (
        <Row style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          {data.pending_forms > 0 ? <Chip icon="description" text={`${data.pending_forms} form(s) to fill out`} onPress={() => go('/worker/forms')} /> : null}
          {data.my_open_tasks > 0 ? <Chip icon="checklist" text={`${data.my_open_tasks} open task(s)`} onPress={() => go('/worker/tasks')} /> : null}
          {data.unread_notifications > 0 ? <Chip icon="notifications-active" text={`${data.unread_notifications} new notification(s)`} onPress={() => go('/worker/notifications')} /> : null}
        </Row>
      ) : null}

      {data.my_safety.length ? (
        <TouchableOpacity style={data.my_safety.some((d: any) => d.expired || d.days_until_expiry <= 7) ? ui.dangerBox : ui.warnBox} onPress={() => go('/worker/safety')}>
          <Text style={[ui.body, { fontWeight: '700' }]}>Your safety documents</Text>
          {data.my_safety.map((d: any) => (
            <Text key={d.id} style={ui.body}>
              {d.name}: {d.expired ? `EXPIRED ${shortDate(d.expiry_date)}` : `expires in ${d.days_until_expiry} day(s)`}
            </Text>
          ))}
          <Text style={ui.muted}>Tap to upload the renewed document.</Text>
        </TouchableOpacity>
      ) : null}

      {data.sites ? (
        <>
          <SectionTitle title="My sites" />
          {data.pending_requests ? <Text style={[ui.muted, { marginBottom: 8 }]}>{data.pending_requests} of your requests waiting for the PM</Text> : null}
          {data.sites.length === 0 ? <Text style={ui.muted}>You're not assigned to a site yet.</Text> : null}
          {data.sites.map((s: any) => {
            const problems = s.crew.filter((c: any) => c.safety_expired || c.safety_expiring_7).length;
            const expanded = openSite === s.id;
            return (
              <Card key={s.id} onPress={() => setOpenSite(expanded ? null : s.id)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={[ui.title, { flex: 1 }]}>{s.name}</Text>
                  {s.status !== 'active' ? <Pill label={s.status} /> : null}
                </Row>
                {s.status === 'shutdown' ? <Text style={{ color: COLORS.error }}>Shut down: {s.shutdown_reason}</Text> : null}
                <Row style={{ marginTop: 8, gap: 14 }}>
                  <Row style={{ gap: 4 }}>
                    <MaterialIcons name="engineering" size={20} color={COLORS.primary} />
                    <Text style={[ui.title, { color: COLORS.primary }]}>{s.men_on_site}</Text>
                    <Text style={ui.muted}>on site</Text>
                  </Row>
                  <Text style={ui.muted}>{s.outstanding_count} open tasks</Text>
                  {s.open_rfis ? <Text style={ui.muted}>{s.open_rfis} open RFI(s)</Text> : null}
                </Row>
                <View style={{ marginTop: 8 }}>
                  <Text style={ui.muted}>Progress {pct(s.progress_pct)}</Text>
                  <ProgressBar value={s.progress_pct} color={COLORS.primary} />
                </View>
                {problems ? (
                  <Row style={{ marginTop: 6 }}>
                    <MaterialIcons name="health-and-safety" size={16} color={COLORS.error} />
                    <Text style={{ color: COLORS.error, fontSize: 13 }}>{problems} on site with expired / expiring safety docs</Text>
                  </Row>
                ) : null}
                {expanded ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={[ui.muted, { fontWeight: '700' }]}>On site now</Text>
                    {s.crew.length === 0 ? <Text style={ui.muted}>Nobody clocked in</Text> : null}
                    {s.crew.map((c: any) => (
                      <Text key={c.user_id} style={[ui.body, c.safety_expired ? { color: COLORS.error } : null]}>
                        • {c.name} ({c.specialties.map(specialtyLabel).join(', ') || 'crew'}) since {timeOf(c.clock_in)}
                        {c.task_title ? ` — ${c.task_title}` : ''}
                        {c.safety_expired ? ' ⚠ expired safety doc' : c.safety_expiring_7 ? ' ⚠ doc expiring' : ''}
                      </Text>
                    ))}
                    <Text style={[ui.muted, { fontWeight: '700', marginTop: 8 }]}>Outstanding tasks</Text>
                    {s.outstanding_tasks.slice(0, 12).map((t: any) => (
                      <Text key={t.id} style={ui.body}>
                        • {t.title} — {t.progress_pct || 0}%
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text style={[ui.muted, { marginTop: 6 }]}>Tap for crew and tasks</Text>
                )}
              </Card>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

function Chip({ icon, text, onPress }: { icon: any; text: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.accentTint, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 }}>
      <MaterialIcons name={icon} size={16} color={COLORS.accentDark} />
      <Text style={{ color: COLORS.accentDark, fontWeight: '600', fontSize: 13 }}>{text}</Text>
    </TouchableOpacity>
  );
}
