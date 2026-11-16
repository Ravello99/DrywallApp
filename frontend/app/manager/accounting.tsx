// Accounting: this week's labour payout by job and employee (with overtime), progress draws and
// receivables, and bulk Excel downloads of hours for records. Admin and project coordinators.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { accountingApi, drawApi, apiError } from '../../src/services/pmService';
import { siteService } from '../../src/services/siteService';
import { userService } from '../../src/services/userService';
import { openServerDocument } from '../../src/utils/openDocument';
import { COLORS } from '../../src/constants/colors';
import { Card, SectionTitle, Pill, Stat, StatRow, Segments, Loading, Empty, Row, Button, Field, Chips, money, hrs, shortDate, statusLabel, ui } from '../../src/components/ui';

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default function AccountingScreen() {
  const [tab, setTab] = useState('payroll');
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openUser, setOpenUser] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await accountingApi.overview(week));
    } catch (e) {
      Alert.alert('Could not load accounting', apiError(e));
    } finally {
      setRefreshing(false);
    }
  }, [week]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <Loading />;
  const { labour, draws } = data;
  const thisWeek = data.week.start <= data.week.today && data.week.today <= data.week.end;

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <Segments
        value={tab}
        onChange={setTab}
        options={[
          { value: 'payroll', label: 'Labour & payroll' },
          { value: 'draws', label: 'Progress draws', badge: draws.outstanding.filter((d: any) => d.overdue_days).length },
          { value: 'downloads', label: 'Downloads' },
        ]}
      />
      <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {tab === 'payroll' ? (
          <>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <TouchableOpacity accessibilityLabel="Previous week" onPress={() => setWeek(addDays(data.week.start, -7))} style={{ padding: 8 }}>
                <MaterialIcons name="chevron-left" size={28} color={COLORS.primary} />
              </TouchableOpacity>
              <View style={{ alignItems: 'center' }}>
                <Text style={ui.title}>
                  {shortDate(data.week.start)} – {shortDate(data.week.end)}
                </Text>
                <Text style={ui.muted}>{thisWeek ? 'This pay week (so far)' : 'Pay week'}</Text>
              </View>
              <TouchableOpacity accessibilityLabel="Next week" disabled={thisWeek} onPress={() => setWeek(addDays(data.week.start, 7))} style={{ padding: 8, opacity: thisWeek ? 0.3 : 1 }}>
                <MaterialIcons name="chevron-right" size={28} color={COLORS.primary} />
              </TouchableOpacity>
            </Row>
            <StatRow>
              <Stat label="Labour payout" value={money(labour.totals.pay, 2)} />
              <Stat label="Hours" value={hrs(labour.totals.hours)} />
              <Stat label="Overtime" value={hrs(labour.totals.overtime_hours)} color={labour.totals.overtime_hours > 0 ? COLORS.warning : undefined} />
            </StatRow>
            <Text style={[ui.muted, { marginBottom: 8 }]}>
              Gross wages before deductions. Overtime after {data.week.overtime_after_hours} h/week at {data.week.overtime_multiplier}x, charged to the job it was worked on.
            </Text>
            {labour.warnings.map((w: string, i: number) => (
              <Card key={i} style={{ borderLeftWidth: 4, borderLeftColor: COLORS.warning }}>
                <Text style={ui.body}>{w}</Text>
              </Card>
            ))}

            {data.expenses && (data.expenses.total > 0 || data.expenses.pending_review > 0) ? (
              <Card>
                <Text style={ui.fieldLabel}>Receipts this week</Text>
                <Text style={ui.body}>
                  {money(data.expenses.total, 2)} logged
                  {data.expenses.pending_review ? ` · ${data.expenses.pending_review} waiting for review` : ''}
                  {data.expenses.to_reimburse ? ` · ${money(data.expenses.to_reimburse, 2)} to pay back` : ''}
                </Text>
              </Card>
            ) : null}

            <SectionTitle title="By job" />
            {labour.by_site.length === 0 ? <Empty icon="schedule" text="No hours this week" /> : null}
            {labour.by_site.map((s: any) => (
              <Card key={s.site_id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={[ui.title, { flex: 1 }]}>{s.site_name}</Text>
                  <Text style={ui.title}>{money(s.pay, 2)}</Text>
                </Row>
                <Text style={ui.muted}>
                  {hrs(s.hours)} · {s.workers} worker{s.workers === 1 ? '' : 's'} · {s.shifts} shift{s.shifts === 1 ? '' : 's'}
                  {s.overtime_hours ? ` · ${hrs(s.overtime_hours)} overtime` : ''}
                </Text>
              </Card>
            ))}

            <SectionTitle title="By employee" />
            {labour.by_user.map((u: any) => (
              <Card key={u.user_id} onPress={() => setOpenUser(openUser === u.user_id ? null : u.user_id)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={[ui.title, { flex: 1 }]}>{u.user_name}</Text>
                  <Text style={ui.title}>{money(u.pay, 2)}</Text>
                </Row>
                <Text style={ui.muted}>
                  {hrs(u.regular_hours)} regular{u.overtime_hours ? ` + ${hrs(u.overtime_hours)} overtime` : ''}
                  {u.missing_rate ? ' · no pay rate set' : ''}
                  {u.jobs.length > 1 ? ` · ${u.jobs.length} jobs` : ''}
                </Text>
                {openUser === u.user_id
                  ? u.jobs.map((j: any) => (
                      <Row key={j.site_id} style={{ justifyContent: 'space-between', marginTop: 6 }}>
                        <Text style={[ui.body, { flex: 1 }]}>{j.site_name}</Text>
                        <Text style={ui.body}>
                          {hrs(j.hours)} · {money(j.pay, 2)}
                        </Text>
                      </Row>
                    ))
                  : null}
              </Card>
            ))}
          </>
        ) : null}

        {tab === 'draws' ? <DrawsSection draws={draws} /> : null}
        {tab === 'downloads' ? <Downloads weekStart={data.week.start} weekEnd={data.week.end} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DrawsSection({ draws }: { draws: any }) {
  const s = draws.summary;
  return (
    <>
      <StatRow>
        <Stat label="Outstanding" value={money(s.outstanding)} color={s.outstanding > 0 ? COLORS.warning : undefined} />
        <Stat label="Overdue" value={money(draws.overdue_total)} color={draws.overdue_total > 0 ? COLORS.error : undefined} />
        <Stat label="Holdback held" value={money(s.holdback_held)} />
      </StatRow>
      <StatRow>
        <Stat label="Billed (before tax)" value={money(s.billed_gross)} />
        <Stat label="Received" value={money(s.paid)} />
        <Stat label="Received this week" value={money(draws.received_this_week)} />
      </StatRow>
      <Card>
        <Text style={ui.fieldLabel}>Aging of what's owed</Text>
        <Row style={{ justifyContent: 'space-between' }}>
          {Object.entries(s.aging).map(([k, v]: any) => (
            <View key={k} style={{ alignItems: 'center', flex: 1 }}>
              <Text style={ui.title}>{money(v)}</Text>
              <Text style={ui.muted}>{k} days</Text>
            </View>
          ))}
        </Row>
      </Card>

      <SectionTitle title={`Waiting for payment (${draws.outstanding.length})`} />
      {draws.outstanding.length === 0 ? <Empty icon="task-alt" text="Nothing owing" /> : null}
      {draws.outstanding.map((d: any) => (
        <DrawCard key={d.id} d={d} right={money(d.balance, 2)}>
          <Text style={[ui.muted, d.overdue_days ? { color: COLORS.error, fontWeight: '700' } : null]}>
            {d.overdue_days ? `${d.overdue_days} days overdue` : d.due_date ? `Due ${shortDate(d.due_date)}` : ''}
            {d.invoice_date ? ` · sent ${shortDate(d.invoice_date)}` : ''}
            {d.paid_total ? ` · ${money(d.paid_total, 2)} paid so far` : ''}
          </Text>
        </DrawCard>
      ))}

      {draws.drafts.length ? <SectionTitle title={`Drafts not sent yet (${draws.drafts.length})`} /> : null}
      {draws.drafts.map((d: any) => (
        <DrawCard key={d.id} d={d} right={money(d.total_due, 2)}>
          <Text style={ui.muted}>Created by {d.created_by_name}. Send it from the project's Draws tab.</Text>
        </DrawCard>
      ))}

      <SectionTitle title="This week" />
      {draws.sent_this_week.length === 0 && draws.paid_this_week.length === 0 ? <Text style={ui.muted}>No invoices sent or paid this week.</Text> : null}
      {draws.sent_this_week.map((d: any) => (
        <DrawCard key={'s' + d.id} d={d} right={money(d.total_due, 2)}>
          <Text style={ui.muted}>Sent {shortDate(d.invoice_date)}</Text>
        </DrawCard>
      ))}
      {draws.paid_this_week.map((d: any) => (
        <DrawCard key={'p' + d.id} d={d} right={money(d.paid_this_week, 2)}>
          <Text style={[ui.muted, { color: COLORS.success }]}>Payment received this week</Text>
        </DrawCard>
      ))}

      {draws.holdback_by_site.length ? <SectionTitle title="Holdback held by job" /> : null}
      {draws.holdback_by_site.map((h: any) => (
        <Card key={h.site_id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={[ui.body, { flex: 1 }]}>{h.site_name}</Text>
            <Text style={ui.title}>{money(h.holdback, 2)}</Text>
          </Row>
          <Text style={ui.muted}>of {money(h.billed)} billed</Text>
        </Card>
      ))}
    </>
  );
}

function DrawCard({ d, right, children }: { d: any; right: string; children?: React.ReactNode }) {
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[ui.title, { flex: 1 }]}>
          {d.invoice_number} · {d.site_name}
        </Text>
        <Text style={ui.title}>{right}</Text>
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={[ui.muted, { flex: 1 }]}>{(d.bill_to || '').split('\n')[0]}</Text>
        <Pill label={statusLabel(d.status)} />
      </Row>
      {children}
      <Row style={{ marginTop: 8 }}>
        <Button title="View invoice" small kind="ghost" icon="description" onPress={() => openServerDocument(() => drawApi.link(d.id))} />
      </Row>
    </Card>
  );
}

function Downloads({ weekStart, weekEnd }: { weekStart: string; weekEnd: string }) {
  const [start, setStart] = useState(weekStart);
  const [end, setEnd] = useState(weekEnd);
  const [scope, setScope] = useState('all');
  const [sites, setSites] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [siteId, setSiteId] = useState('');
  const [userId, setUserId] = useState('');

  useEffect(() => {
    siteService.getSites().then(setSites).catch(() => setSites([]));
    userService.getUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const presets = (() => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    return [
      { value: 'week', label: 'This week', range: [weekStart, weekEnd] },
      { value: 'lastweek', label: 'Last week', range: [addDays(weekStart, -7), addDays(weekStart, -1)] },
      { value: 'month', label: 'This month', range: [iso(monthStart), iso(today)] },
      { value: 'lastmonth', label: 'Last month', range: [iso(lastMonthStart), iso(lastMonthEnd)] },
      { value: 'year', label: 'This year', range: [`${today.getFullYear()}-01-01`, iso(today)] },
    ];
  })();
  const preset = presets.find((p) => p.range[0] === start && p.range[1] === end)?.value || '';

  const download = (format: 'xlsx' | 'zip') => {
    if (!ISO.test(start) || !ISO.test(end)) return Alert.alert('Enter the dates as YYYY-MM-DD');
    if (scope === 'job' && !siteId) return Alert.alert('Choose a job');
    if (scope === 'person' && !userId) return Alert.alert('Choose an employee');
    openServerDocument(() =>
      accountingApi.exportLink({
        kind: 'hours',
        start,
        end,
        format,
        site_id: scope === 'job' ? siteId : undefined,
        user_id: scope === 'person' ? userId : undefined,
      }),
      { download: true },
    );
  };

  const downloadExpenses = (format: 'xlsx' | 'zip') => {
    if (!ISO.test(start) || !ISO.test(end)) return Alert.alert('Enter the dates as YYYY-MM-DD');
    openServerDocument(() => accountingApi.exportLink({ kind: 'expenses', start, end, format, site_id: scope === 'job' && siteId ? siteId : undefined }), { download: true });
  };

  return (
    <>
      <SectionTitle title="Employee hours" />
      <Card>
        <Text style={ui.fieldLabel}>Period</Text>
        <Chips options={presets.map((p) => ({ value: p.value, label: p.label }))} value={preset} onChange={(v) => { const p = presets.find((x) => x.value === v)!; setStart(p.range[0]); setEnd(p.range[1]); }} />
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="From (YYYY-MM-DD)" value={start} onChangeText={setStart} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="To" value={end} onChangeText={setEnd} />
          </View>
        </Row>
        <Text style={ui.fieldLabel}>Include</Text>
        <Chips options={[{ value: 'all', label: 'Everyone, all jobs' }, { value: 'job', label: 'One job' }, { value: 'person', label: 'One employee' }]} value={scope} onChange={setScope} />
        {scope === 'job' ? <Chips options={sites.map((s) => ({ value: s.id, label: s.name }))} value={siteId} onChange={setSiteId} /> : null}
        {scope === 'person' ? <Chips options={users.filter((u) => u.is_active !== false).map((u) => ({ value: u.id, label: u.name }))} value={userId} onChange={setUserId} /> : null}
        <Button title="Excel workbook" icon="table-view" onPress={() => download('xlsx')} />
        <View style={{ height: 8 }} />
        <Button title="ZIP: a file per job and per employee" kind="secondary" icon="folder-zip" onPress={() => download('zip')} />
        <Text style={[ui.muted, { marginTop: 10 }]}>
          The workbook has a summary by job, a summary by employee, every shift, and a tab for each job and each employee: dates, clock-in and out times, regular and overtime hours, rate and pay.
        </Text>
      </Card>

      <SectionTitle title="Receipts & expenses" />
      <Card>
        <Text style={[ui.body, { marginBottom: 10 }]}>
          Every receipt logged for the period above{scope === 'job' && siteId ? ' (this job only)' : ''}: totals by job and category, and who needs paying back.
        </Text>
        <Button title="Excel workbook" icon="table-view" onPress={() => downloadExpenses('xlsx')} />
        <View style={{ height: 8 }} />
        <Button title="ZIP with every receipt photo" kind="secondary" icon="folder-zip" onPress={() => downloadExpenses('zip')} />
      </Card>

      <SectionTitle title="Progress draws" />
      <Card>
        <Text style={[ui.body, { marginBottom: 10 }]}>Invoice register: every draw with amounts, dates, payments and balance, plus a list of payments received.</Text>
        <Button title="Download invoice register" icon="receipt-long" onPress={() => openServerDocument(() => accountingApi.exportLink({ kind: 'draws' }), { download: true })} />
      </Card>
    </>
  );
}
