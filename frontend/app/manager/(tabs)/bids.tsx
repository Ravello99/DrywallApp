import React, { useCallback, useState } from 'react';
import { ScrollView, RefreshControl, Text, View, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Bid, BidStats } from '../../../src/types/features';
import { bidApi, apiError } from '../../../src/services/pmService';
import { useAuthStore } from '../../../src/store/authStore';
import { COLORS } from '../../../src/constants/colors';
import Footer from '../../../src/components/Footer';
import {
  Card, Pill, Row, Button, Sheet, Field, Chips, Empty, Loading, Stat, StatRow, SectionTitle,
  money, pct, shortDate, todayISO, ui,
} from '../../../src/components/ui';

const CATEGORY_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'multi_family', label: 'Multi-Family' },
  { value: 'commercial_fit_out', label: 'Commercial Fit-Out' },
  { value: 'institutional', label: 'Institutional' },
  { value: 'other', label: 'Other' },
];
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'followups', label: 'Follow-ups due' },
  { value: 'won', label: 'Won' },
  { value: 'lost,declined', label: 'Lost / declined' },
  { value: '', label: 'All' },
];

export default function BidsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [bids, setBids] = useState<Bid[] | null>(null);
  const [stats, setStats] = useState<BidStats | null>(null);
  const [inbox, setInbox] = useState<any>(null);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // sheets
  const [adding, setAdding] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [viewing, setViewing] = useState<Bid | null>(null);
  const [action, setAction] = useState<'' | 'submit' | 'followup' | 'outcome'>('');
  // add form
  const [name, setName] = useState('');
  const [gc, setGc] = useState('');
  const [cat, setCat] = useState('');
  const [loc, setLoc] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  // paste form
  const [pSubject, setPSubject] = useState('');
  const [pBody, setPBody] = useState('');
  const [pFrom, setPFrom] = useState('');
  // actions
  const [amount, setAmount] = useState('');
  const [fuDays, setFuDays] = useState('7');
  const [fuNote, setFuNote] = useState('');
  const [fuNext, setFuNext] = useState('');
  const [outcome, setOutcome] = useState('won');
  const [outcomeNotes, setOutcomeNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const params: any = { category: category || undefined, q: search || undefined };
      if (status === 'open') params.status = 'invited,reviewing';
      else if (status === 'followups') params.followups = true;
      else if (status) params.status = status;
      const [b, s, i] = await Promise.all([bidApi.list(params), bidApi.stats(), bidApi.inboxStatus().catch(() => null)]);
      setBids(b);
      setStats(s);
      setInbox(i);
      setError('');
    } catch (e) {
      setError(apiError(e));
      setBids([]);
    } finally {
      setRefreshing(false);
    }
  }, [category, status, search]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const run = async (fn: () => Promise<any>, after?: () => void) => {
    setSaving(true);
    try {
      await fn();
      after?.();
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const addBid = () => {
    if (name.trim().length < 2) return Alert.alert('Project name needed');
    run(
      () => bidApi.create({ project_name: name.trim(), general_contractor: gc || null, category: cat || null, location: loc || null, due_date: due || null, notes: notes || null }),
      () => {
        setAdding(false);
        setName('');
        setGc('');
        setCat('');
        setLoc('');
        setDue('');
        setNotes('');
      },
    );
  };

  const pasteBid = () => {
    if (!pSubject.trim()) return Alert.alert('Paste at least the email subject');
    run(
      async () => {
        const b = await bidApi.importEmail({ subject: pSubject, body: pBody, sender: pFrom || null });
        Alert.alert('Bid added', `Sorted as ${b.category_label}${b.due_date ? `, due ${shortDate(b.due_date)}` : ''}. Check the details.`);
      },
      () => {
        setPasting(false);
        setPSubject('');
        setPBody('');
        setPFrom('');
      },
    );
  };

  const openBid = async (b: Bid) => {
    try {
      setViewing(await bidApi.get(b.id));
    } catch {
      setViewing(b);
    }
    setAction('');
    setAmount(b.bid_amount != null ? String(b.bid_amount) : '');
  };

  const doAction = () => {
    if (!viewing) return;
    if (action === 'submit') {
      const a = parseFloat(amount.replace(/[$,]/g, ''));
      if (isNaN(a)) return Alert.alert('Enter the bid amount');
      run(() => bidApi.submit(viewing.id, { bid_amount: a, follow_up_days: parseInt(fuDays, 10) || 7 }), () => setViewing(null));
    } else if (action === 'followup') {
      run(() => bidApi.followUp(viewing.id, { note: fuNote || null, next_follow_up: fuNext || null }), () => {
        setViewing(null);
        setFuNote('');
        setFuNext('');
      });
    } else if (action === 'outcome') {
      run(() => bidApi.outcome(viewing.id, { outcome, notes: outcomeNotes || null }), () => {
        setViewing(null);
        setOutcomeNotes('');
      });
    }
  };

  const createProject = () => {
    if (!viewing) return;
    run(async () => {
      const res = await bidApi.createProject(viewing.id);
      setViewing(null);
      Alert.alert('Project created', res.message);
      router.push(`/manager/project/${res.project_id}` as any);
    });
  };

  const checkInbox = () =>
    run(async () => {
      const r = await bidApi.checkInbox();
      Alert.alert('Bid inbox', r.error || r.message || `${r.imported} new bid invite(s) found.`);
    });

  if (!bids) return <Loading />;
  const canCreateProject = ['admin', 'project_manager', 'project_coordinator'].includes(user?.role || '');

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {stats ? (
          <StatRow>
            <Stat label="Submitted this week" value={String(stats.submitted_this_week)} />
            <Stat label="Win rate" value={pct(stats.win_rate)} sub={`${stats.won} won · ${stats.lost} lost`} />
            <Stat label="Follow-ups due" value={String(stats.followups_due)} color={stats.followups_due ? COLORS.warning : undefined} />
            <Stat label="Pipeline (submitted)" value={money(stats.pipeline_value)} sub={`${stats.due_this_week} bid(s) due this week`} />
          </StatRow>
        ) : null}

        {stats ? (
          <Card>
            <Text style={[ui.muted, { marginBottom: 8 }]}>Bids submitted per week (last 12)</Text>
            <Row style={{ alignItems: 'flex-end', height: 70, gap: 4 }}>
              {stats.weekly.map((w) => {
                const max = Math.max(1, ...stats.weekly.map((x) => x.submitted));
                return (
                  <View key={w.week_start} style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 10, color: COLORS.textSecondary }}>{w.submitted || ''}</Text>
                    <View style={{ width: '80%', height: Math.max(3, (w.submitted / max) * 50), backgroundColor: w.won ? COLORS.accent : COLORS.primary, borderRadius: 3 }} />
                  </View>
                );
              })}
            </Row>
            <Row style={{ marginTop: 8, flexWrap: 'wrap', gap: 10 }}>
              {Object.entries(stats.by_category).map(([k, v]) => (
                <Text key={k} style={ui.muted}>
                  {stats.categories[k]}: {v.open} open · win {pct(v.win_rate)}
                </Text>
              ))}
            </Row>
          </Card>
        ) : null}

        <Row style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          <Button title="Add bid" icon="add" small onPress={() => setAdding(true)} />
          <Button title="Paste invite email" icon="content-paste" kind="ghost" small onPress={() => setPasting(true)} />
          {inbox?.configured ? <Button title="Check inbox" icon="mail" kind="ghost" small onPress={checkInbox} loading={saving} /> : null}
        </Row>
        {inbox ? (
          <Text style={[ui.muted, { marginBottom: 12 }]}>
            {inbox.configured
              ? `Bid inbox: ${inbox.mailbox}${inbox.last_check ? ` · checked ${shortDate(inbox.last_check)}` : ''}${inbox.last_error ? ` · ⚠ ${inbox.last_error}` : ''}`
              : 'Bid inbox not connected yet: invites can be pasted in for now.'}
          </Text>
        ) : null}

        <TextInput style={[ui.input, { marginBottom: 12 }]} placeholder="Search project, GC or location" value={search} onChangeText={setSearch} onSubmitEditing={load} placeholderTextColor={COLORS.gray400} returnKeyType="search" />
        <Chips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <Chips options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
        {error ? <Text style={ui.body}>{error}</Text> : null}

        {bids.length === 0 ? (
          <Empty icon="request-quote" text="No bids here" />
        ) : (
          bids.map((b) => (
            <Card key={b.id} onPress={() => openBid(b)}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={[ui.title, { flex: 1 }]}>{b.project_name}</Text>
                <Pill label={b.status} />
              </Row>
              <Text style={ui.muted}>{[b.category_label, b.general_contractor, b.location].filter(Boolean).join(' · ')}</Text>
              <Row style={{ marginTop: 6, flexWrap: 'wrap', gap: 10 }}>
                {b.due_date ? (
                  <Text style={[ui.muted, b.days_until_due != null && b.days_until_due <= 2 ? { color: COLORS.error, fontWeight: '700' } : null]}>
                    Due {shortDate(b.due_date)}
                    {b.days_until_due != null ? ` (${b.days_until_due < 0 ? 'past' : `${b.days_until_due}d`})` : ''}
                  </Text>
                ) : null}
                {b.bid_amount != null ? <Text style={ui.muted}>{money(b.bid_amount)}</Text> : null}
                {b.follow_up_due ? <Text style={{ fontSize: 12, color: COLORS.warning, fontWeight: '700' }}>Follow up now</Text> : null}
                {b.source === 'email' ? <Text style={ui.muted}>from inbox</Text> : b.source === 'website' ? <Text style={ui.muted}>from website</Text> : null}
              </Row>
            </Card>
          ))
        )}
        <Footer />
      </ScrollView>

      <Sheet visible={adding} title="Add a bid" onClose={() => setAdding(false)} onSubmit={addBid} loading={saving}>
        <Field label="Project name" value={name} onChangeText={setName} />
        <Field label="General contractor" value={gc} onChangeText={setGc} />
        <Text style={ui.fieldLabel}>Type (leave on Auto to sort automatically)</Text>
        <Chips options={[{ value: '', label: 'Auto' }, ...CATEGORY_OPTIONS.slice(1)]} value={cat} onChange={setCat} />
        <Field label="Location" value={loc} onChangeText={setLoc} />
        <Field label="Bid due (YYYY-MM-DD)" value={due} onChangeText={setDue} />
        <Field label="Notes / scope" value={notes} onChangeText={setNotes} multiline />
      </Sheet>

      <Sheet visible={pasting} title="Paste a bid invite" onClose={() => setPasting(false)} onSubmit={pasteBid} submitLabel="Add bid" loading={saving}>
        <Text style={[ui.muted, { marginBottom: 10 }]}>Copy the invite email in. The type and due date are picked out automatically.</Text>
        <Field label="Subject" value={pSubject} onChangeText={setPSubject} />
        <Field label="From (optional)" value={pFrom} onChangeText={setPFrom} placeholder="Jane Doe <jane@gc.com>" />
        <Field label="Email text" value={pBody} onChangeText={setPBody} multiline />
      </Sheet>

      <Sheet visible={!!viewing} title={viewing?.project_name || ''} onClose={() => setViewing(null)} onSubmit={action ? doAction : undefined} submitLabel={action === 'submit' ? 'Mark submitted' : 'Save'} loading={saving}>
        {viewing ? (
          <>
            <Row style={{ marginBottom: 8 }}>
              <Pill label={viewing.status} />
              <Text style={ui.muted}>{viewing.category_label}</Text>
            </Row>
            <Text style={ui.body}>{[viewing.general_contractor, viewing.contact_email, viewing.location].filter(Boolean).join(' · ')}</Text>
            <Text style={ui.muted}>
              {[viewing.due_date ? `Due ${shortDate(viewing.due_date)}` : null, viewing.bid_amount != null ? `Bid ${money(viewing.bid_amount)}` : null, viewing.submitted_at ? `Submitted ${shortDate(viewing.submitted_at)}` : null, viewing.follow_up_date ? `Follow up ${shortDate(viewing.follow_up_date)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {viewing.notes ? <Text style={[ui.body, { marginTop: 8 }]}>{viewing.notes}</Text> : null}
            {viewing.email_body ? (
              <Card style={{ marginTop: 10, backgroundColor: COLORS.gray100 }}>
                <Text style={[ui.muted, { fontWeight: '700' }]}>{viewing.email_subject}</Text>
                <Text style={ui.muted} numberOfLines={12}>
                  {viewing.email_body.trim()}
                </Text>
              </Card>
            ) : null}
            {viewing.activity?.length ? (
              <>
                <SectionTitle title="History" />
                {viewing.activity.slice(-6).map((a, i) => (
                  <Text key={i} style={ui.muted}>
                    {shortDate(a.at)} — {a.text}
                  </Text>
                ))}
              </>
            ) : null}

            <View style={ui.divider} />
            {!action ? (
              <Row style={{ flexWrap: 'wrap' }}>
                {['invited', 'reviewing', 'submitted'].includes(viewing.status) ? <Button title={viewing.status === 'submitted' ? 'Update amount' : 'Mark submitted'} small onPress={() => setAction('submit')} /> : null}
                {viewing.status === 'submitted' ? <Button title="Log follow-up" kind="secondary" small onPress={() => { setAction('followup'); setFuNext(''); }} /> : null}
                {['invited', 'reviewing', 'submitted'].includes(viewing.status) ? <Button title="Won / lost / declined" kind="ghost" small onPress={() => setAction('outcome')} /> : null}
                {viewing.status === 'won' && !viewing.project_id && canCreateProject ? <Button title="Create project" kind="success" icon="apartment" small onPress={createProject} /> : null}
                {viewing.status === 'won' && viewing.project_id ? <Button title="Open project" small onPress={() => { setViewing(null); router.push(`/manager/project/${viewing.project_id}` as any); }} /> : null}
              </Row>
            ) : null}
            {action === 'submit' ? (
              <>
                <Field label="Bid amount ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
                <Field label="Remind me to follow up in (days)" value={fuDays} onChangeText={setFuDays} keyboardType="number-pad" />
              </>
            ) : null}
            {action === 'followup' ? (
              <>
                <Field label="What happened" value={fuNote} onChangeText={setFuNote} placeholder="e.g. Called Jane, decision next week" />
                <Field label="Next follow-up (YYYY-MM-DD, blank for none)" value={fuNext} onChangeText={setFuNext} placeholder={todayISO()} />
              </>
            ) : null}
            {action === 'outcome' ? (
              <>
                <Chips options={[{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }, { value: 'declined', label: 'Declined to bid' }]} value={outcome} onChange={setOutcome} />
                <Field label="Notes" value={outcomeNotes} onChangeText={setOutcomeNotes} multiline placeholder="e.g. Lost on price to ABC Interiors" />
              </>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}
