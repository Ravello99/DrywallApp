// Time & attendance (admin, project managers, coordinators): who's on site now, force clock-out,
// fix a shift's times or job, add a missed shift. Every change asks for a reason, is kept on the
// shift's history, and the employee gets a notification.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { timeclockApi, apiError } from '../../src/services/pmService';
import { siteService } from '../../src/services/siteService';
import { userService } from '../../src/services/userService';
import { useAuthStore } from '../../src/store/authStore';
import { COLORS } from '../../src/constants/colors';
import { Card, Pill, Segments, Loading, Empty, Row, Button, Field, Chips, Sheet, hrs, ui } from '../../src/components/ui';
import { fromServer, localDate, localTime, parseLocal, fmtDateTime, fmtTime, weekStart, addDaysTo } from '../../src/utils/localTime';

const REASONS = ['Forgot to clock out', 'Forgot to clock in', 'Phone died / no signal', 'Wrong job selected', 'Left site early'];

type Shift = any;

export default function TimeScreen() {
  const { user } = useAuthStore();
  const canDelete = ['admin', 'project_coordinator'].includes(user?.role || '');
  const [tab, setTab] = useState('now');
  const [open, setOpen] = useState<Shift[] | null>(null);
  const [week, setWeek] = useState(() => weekStart(new Date()));
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sites, setSites] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [forcing, setForcing] = useState<Shift | null>(null);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<string | null>(null);

  const loadOpen = useCallback(async () => {
    try {
      setOpen(await timeclockApi.open());
    } catch (e) {
      Alert.alert('Could not load', apiError(e));
      setOpen([]);
    }
  }, []);
  const loadShifts = useCallback(async () => {
    try {
      setShifts(await timeclockApi.records(week.toISOString(), addDaysTo(week, 7).toISOString()));
    } catch (e) {
      Alert.alert('Could not load', apiError(e));
      setShifts([]);
    }
  }, [week]);
  const reload = useCallback(async () => {
    await Promise.all([loadOpen(), loadShifts()]);
    setRefreshing(false);
  }, [loadOpen, loadShifts]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  useEffect(() => {
    siteService.getSites().then(setSites).catch(() => setSites([]));
    userService.getUsers().then((u: any[]) => setPeople(u.filter((x) => x.active !== false))).catch(() => setPeople([]));
  }, []);

  const filtered = useMemo(
    () => (shifts || []).filter((s) => !search.trim() || `${s.user_name} ${s.site_name}`.toLowerCase().includes(search.trim().toLowerCase())),
    [shifts, search],
  );
  const byDay = useMemo(() => {
    const groups: Record<string, Shift[]> = {};
    filtered.forEach((s) => {
      const d = fromServer(s.clock_in)!;
      (groups[localDate(d)] = groups[localDate(d)] || []).push(s);
    });
    return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  if (open === null) return <Loading />;
  const thisWeek = localDate(week) === localDate(weekStart(new Date()));

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <Segments
        value={tab}
        onChange={setTab}
        options={[
          { value: 'now', label: 'On site now', badge: open.length },
          { value: 'shifts', label: 'Shifts & hours' },
        ]}
      />
      <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} />}>
        {tab === 'now' ? (
          <>
            <Text style={[ui.muted, { marginBottom: 10 }]}>Everyone clocked in right now. Clock someone out who forgot, with the time they actually left.</Text>
            {open.length === 0 ? <Empty icon="schedule" text="Nobody is clocked in" /> : null}
            {open.map((s) => {
              const since = fromServer(s.clock_in)!;
              const long = s.hours >= 12;
              return (
                <Card key={s.id} style={long ? { borderLeftWidth: 4, borderLeftColor: COLORS.warning } : undefined}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={[ui.title, { flex: 1 }]}>{s.user_name}</Text>
                    <Text style={[ui.title, long && { color: COLORS.warning }]}>{hrs(s.hours)}</Text>
                  </Row>
                  <Text style={ui.muted}>
                    {s.site_name} · since {fmtDateTime(since)}
                    {s.task_title ? ` · ${s.task_title}` : ''}
                  </Text>
                  {long ? <Text style={[ui.muted, { color: COLORS.warning, fontWeight: '700' }]}>Open over 12 hours: probably forgot to clock out</Text> : null}
                  <Row style={{ marginTop: 10 }}>
                    <Button title="Clock out" small kind="danger" icon="exit-to-app" onPress={() => setForcing(s)} />
                  </Row>
                </Card>
              );
            })}
          </>
        ) : (
          <>
            <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <TouchableOpacity accessibilityLabel="Previous week" onPress={() => setWeek(addDaysTo(week, -7))} style={{ padding: 8 }}>
                <MaterialIcons name="chevron-left" size={28} color={COLORS.primary} />
              </TouchableOpacity>
              <Text style={ui.title}>
                Week of {week.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </Text>
              <TouchableOpacity accessibilityLabel="Next week" disabled={thisWeek} onPress={() => setWeek(addDaysTo(week, 7))} style={{ padding: 8, opacity: thisWeek ? 0.3 : 1 }}>
                <MaterialIcons name="chevron-right" size={28} color={COLORS.primary} />
              </TouchableOpacity>
            </Row>
            <Field placeholder="Search by name or job" value={search} onChangeText={setSearch} />
            <Button title="Add a missed shift" icon="add" kind="secondary" onPress={() => setAdding(true)} />
            <View style={{ height: 12 }} />
            {shifts === null ? <Loading /> : null}
            {shifts && byDay.length === 0 ? <Empty icon="event-busy" text="No shifts this week" /> : null}
            {byDay.map(([day, list]) => (
              <View key={day}>
                <Text style={[ui.fieldLabel, { marginTop: 8 }]}>
                  {parseLocal(day, '12:00')!.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · {hrs(list.reduce((t, s) => t + s.hours, 0))}
                </Text>
                {list.map((s) => (
                  <Card key={s.id} onPress={() => setEditing(s)}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text style={[ui.title, { flex: 1 }]}>{s.user_name}</Text>
                      <Text style={ui.title}>{hrs(s.hours)}</Text>
                    </Row>
                    <Text style={ui.muted}>
                      {s.site_name} · {fmtTime(fromServer(s.clock_in))} – {s.clock_out ? fmtTime(fromServer(s.clock_out)) : 'still clocked in'}
                    </Text>
                    <Row style={{ marginTop: 6, flexWrap: 'wrap' }}>
                      {s.edited ? <Pill label={s.manual ? 'Added by office' : 'Edited'} color={COLORS.info} /> : null}
                      {s.flagged ? <Pill label="Flagged" color={COLORS.warning} /> : null}
                      {s.auto_clock_out_reason && !s.edited ? <Pill label="Auto clock-out" color={COLORS.gray500} /> : null}
                      {s.edits?.length ? (
                        <TouchableOpacity onPress={() => setHistory(history === s.id ? null : s.id)}>
                          <Text style={[ui.muted, { color: COLORS.primary, fontWeight: '600' }]}>{history === s.id ? 'Hide changes' : `${s.edits.length} change${s.edits.length === 1 ? '' : 's'}`}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </Row>
                    {history === s.id
                      ? s.edits.map((e: any, i: number) => (
                          <Text key={i} style={[ui.muted, { marginTop: 4 }]}>
                            {fmtDateTime(fromServer(e.at))}: {e.by_name}, {e.action === 'force_clock_out' ? 'clocked out' : e.action === 'added' ? 'added shift' : 'edited'}. {e.reason}
                          </Text>
                        ))
                      : null}
                  </Card>
                ))}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {forcing ? <ForceOutSheet shift={forcing} onClose={() => setForcing(null)} onDone={() => { setForcing(null); reload(); }} /> : null}
      {editing ? (
        <ShiftSheet shift={editing} sites={sites} canDelete={canDelete} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />
      ) : null}
      {adding ? <ShiftSheet sites={sites} people={people} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} /> : null}
    </SafeAreaView>
  );
}

function ReasonPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Text style={ui.fieldLabel}>Reason (the employee sees this)</Text>
      <Chips options={REASONS.map((r) => ({ value: r, label: r }))} value={REASONS.includes(value) ? value : ''} onChange={onChange} />
      <Field placeholder="Or type a reason" value={REASONS.includes(value) ? '' : value} onChangeText={onChange} />
    </>
  );
}

function ForceOutSheet({ shift, onClose, onDone }: { shift: Shift; onClose: () => void; onDone: () => void }) {
  const now = new Date();
  const [date, setDate] = useState(localDate(now));
  const [time, setTime] = useState(localTime(now));
  const [reason, setReason] = useState('Forgot to clock out');
  const [saving, setSaving] = useState(false);
  const since = fromServer(shift.clock_in)!;
  const out = parseLocal(date, time);
  const preview = out ? Math.max(0, (out.getTime() - since.getTime()) / 3600000) : null;

  const save = async () => {
    if (!out) return Alert.alert('Check the time', 'Use YYYY-MM-DD for the date and HH:MM (24-hour) for the time.');
    if (reason.trim().length < 3) return Alert.alert('Add a reason');
    setSaving(true);
    try {
      const r = await timeclockApi.forceOut(shift.id, reason.trim(), out.toISOString());
      Alert.alert('Clocked out', `${shift.user_name}: ${r.total_hours} h recorded at ${shift.site_name}.`);
      onDone();
    } catch (e) {
      Alert.alert("Couldn't clock out", apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible title={`Clock out ${shift.user_name}`} onClose={onClose} onSubmit={save} submitLabel="Clock out" submitKind="danger" loading={saving}>
      <Text style={[ui.body, { marginBottom: 12 }]}>
        Clocked in at {shift.site_name} {fmtDateTime(since)}. Set the time they actually left.
      </Text>
      <Row>
        <View style={{ flex: 1 }}>
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Time left (HH:MM)" value={time} onChangeText={setTime} />
        </View>
      </Row>
      {preview !== null ? <Text style={[ui.muted, { marginBottom: 12 }]}>Shift length: {hrs(preview)}</Text> : null}
      <ReasonPicker value={reason} onChange={setReason} />
    </Sheet>
  );
}

function ShiftSheet({ shift, sites, people, canDelete, onClose, onDone }: { shift?: Shift; sites: any[]; people?: any[]; canDelete?: boolean; onClose: () => void; onDone: () => void }) {
  const adding = !shift;
  const cin = shift ? fromServer(shift.clock_in)! : new Date(new Date().setHours(7, 0, 0, 0));
  const cout = shift?.clock_out ? fromServer(shift.clock_out)! : adding ? new Date(new Date().setHours(15, 30, 0, 0)) : null;
  const [date, setDate] = useState(localDate(cin));
  const [start, setStart] = useState(localTime(cin));
  const [end, setEnd] = useState(cout ? localTime(cout) : '');
  const [siteId, setSiteId] = useState(shift?.site_id || '');
  const [userId, setUserId] = useState('');
  const [who, setWho] = useState('');
  const [reason, setReason] = useState(adding ? 'Forgot to clock in' : '');
  const [saving, setSaving] = useState(false);

  const startAt = parseLocal(date, start);
  let endAt = end ? parseLocal(date, end) : null;
  const overnight = !!(startAt && endAt && endAt <= startAt);
  if (overnight && endAt) endAt = addDaysTo(endAt, 1);
  const length = startAt && endAt ? (endAt.getTime() - startAt.getTime()) / 3600000 : null;
  const matches = (people || []).filter((p) => !who.trim() || p.name.toLowerCase().includes(who.trim().toLowerCase())).slice(0, 12);

  const save = async () => {
    if (!startAt || (end && !endAt)) return Alert.alert('Check the times', 'Use YYYY-MM-DD for the date and HH:MM (24-hour) for times.');
    if ((adding || shift?.clock_out) && !endAt) return Alert.alert('Enter the time they finished');
    if (adding && !userId) return Alert.alert('Choose the employee');
    if (!siteId) return Alert.alert('Choose the job');
    if (reason.trim().length < 3) return Alert.alert('Add a reason');
    setSaving(true);
    try {
      if (adding) {
        await timeclockApi.add({ user_id: userId, site_id: siteId, clock_in: startAt.toISOString(), clock_out: endAt!.toISOString(), reason: reason.trim() });
      } else {
        await timeclockApi.edit(shift.id, {
          clock_in: startAt.toISOString(),
          clock_out: endAt ? endAt.toISOString() : null,
          site_id: siteId,
          reason: reason.trim(),
        });
      }
      onDone();
    } catch (e) {
      Alert.alert("Couldn't save", apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert('Delete shift', `Delete this shift for ${shift.user_name}? Only do this for a shift entered by mistake.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await timeclockApi.remove(shift.id, reason.trim().length >= 3 ? reason.trim() : 'Entered by mistake');
            onDone();
          } catch (e) {
            Alert.alert("Couldn't delete", apiError(e));
          }
        },
      },
    ]);

  return (
    <Sheet visible title={adding ? 'Add a missed shift' : `Edit ${shift.user_name}'s shift`} onClose={onClose} onSubmit={save} submitLabel={adding ? 'Add shift' : 'Save changes'} loading={saving}>
      {adding ? (
        <>
          <Field label="Employee" placeholder="Type a name" value={who} onChangeText={setWho} />
          <Chips options={matches.map((p) => ({ value: p.id, label: p.name }))} value={userId} onChange={setUserId} />
        </>
      ) : null}
      <Text style={ui.fieldLabel}>Job</Text>
      <Chips options={sites.map((s) => ({ value: s.id, label: s.name }))} value={siteId} onChange={setSiteId} />
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Row>
        <View style={{ flex: 1 }}>
          <Field label="Start (HH:MM)" value={start} onChangeText={setStart} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Finish (HH:MM)" value={end} onChangeText={setEnd} placeholder={adding ? '' : 'still clocked in'} />
        </View>
      </Row>
      {length !== null ? (
        <Text style={[ui.muted, { marginBottom: 12 }]}>
          {hrs(length)}
          {overnight ? ' (finishes the next day)' : ''}
          {!adding && shift.hours ? `, was ${hrs(shift.hours)}` : ''}
        </Text>
      ) : null}
      <ReasonPicker value={reason} onChange={setReason} />
      {!adding && canDelete ? <Button title="Delete this shift" kind="ghost" icon="delete" onPress={remove} /> : null}
    </Sheet>
  );
}
