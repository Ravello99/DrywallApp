// Receipts & expenses: snap a receipt and log it to a job or "Office". Used by the office
// (More > Receipts & Expenses) and foremen (More > Receipts). Accounting (admin / coordinators)
// approves, rejects and marks personal purchases reimbursed.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, Image, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { expensesApi, apiError } from '../services/pmService';
import { siteService } from '../services/siteService';
import { COLORS } from '../constants/colors';
import { Button, Card, Chips, Empty, Field, Loading, Pill, Row, Segments, Sheet, money, shortDate, statusLabel, todayISO, ui } from './ui';

const STATUS_COLOR: Record<string, string> = {
  submitted: COLORS.warning,
  approved: COLORS.success,
  rejected: COLORS.error,
  reimbursed: COLORS.info,
};

/** On the web, shrink the photo before upload (phone photos are several MB). */
async function shrinkForUpload(uri: string, base64?: string | null, mime?: string | null): Promise<{ data: string; type: string }> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return { data: base64 || '', type: mime || 'image/jpeg' };
  }
  if (mime === 'application/pdf') return { data: base64 || uri, type: mime };
  return new Promise((resolve) => {
    const img = new (window as any).Image();
    img.onload = () => {
      const max = 1800;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ data: canvas.toDataURL('image/jpeg', 0.72), type: 'image/jpeg' });
    };
    img.onerror = () => resolve({ data: base64 ? `data:${mime || 'image/jpeg'};base64,${base64}` : uri, type: mime || 'image/jpeg' });
    img.src = base64 ? `data:${mime || 'image/jpeg'};base64,${base64}` : uri;
  });
}

export default function ExpensesScreen() {
  const [meta, setMeta] = useState<any>(null);
  const [tab, setTab] = useState('mine');
  const [rows, setRows] = useState<any[] | null>(null);
  const [counts, setCounts] = useState({ review: 0, reimburse: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [sites, setSites] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<any>(null);

  useEffect(() => {
    expensesApi.meta().then(setMeta).catch((e) => Alert.alert('Could not load', apiError(e)));
    siteService.getSites().then(setSites).catch(() => setSites([]));
  }, []);

  const load = useCallback(async () => {
    if (!meta) return;
    try {
      const params =
        tab === 'mine' ? { mine: true } : tab === 'review' ? { status: 'submitted' } : tab === 'reimburse' ? { status: 'to_reimburse' } : {};
      setRows(await expensesApi.list(params));
      if (meta.can_review) {
        const [r, p] = await Promise.all([expensesApi.list({ status: 'submitted' }), expensesApi.list({ status: 'to_reimburse' })]);
        setCounts({ review: r.length, reimburse: p.length });
      }
    } catch (e) {
      Alert.alert('Could not load receipts', apiError(e));
      setRows([]);
    } finally {
      setRefreshing(false);
    }
  }, [tab, meta]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!meta) return <Loading />;
  const tabs = [{ value: 'mine', label: 'My receipts' }];
  if (meta.sees_all) tabs.push({ value: 'all', label: 'All' });
  if (meta.can_review) {
    tabs.push({ value: 'review', label: 'To review', badge: counts.review } as any);
    tabs.push({ value: 'reimburse', label: 'To reimburse', badge: counts.reimburse } as any);
  }
  const total = (rows || []).filter((r) => r.status !== 'rejected').reduce((t, r) => t + r.amount, 0);

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      {tabs.length > 1 ? <Segments value={tab} onChange={setTab} options={tabs} /> : null}
      <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <Button title="Add a receipt" icon="photo-camera" onPress={() => setAdding(true)} />
        <View style={{ height: 14 }} />
        {rows === null ? <Loading /> : null}
        {rows && rows.length === 0 ? (
          <Empty icon="receipt-long" text={tab === 'review' ? 'Nothing waiting for review' : tab === 'reimburse' ? 'Nobody waiting to be paid back' : 'No receipts yet'} sub={tab === 'mine' ? 'Tap "Add a receipt" and take a photo of it.' : undefined} />
        ) : null}
        {rows && rows.length ? <Text style={[ui.muted, { marginBottom: 8 }]}>{rows.length} receipt{rows.length === 1 ? '' : 's'} · {money(total, 2)}{tab === 'reimburse' ? ' to pay back' : ''}</Text> : null}
        {(rows || []).map((r) => (
          <Card key={r.id} onPress={() => setOpen(r)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={[ui.title, { flex: 1 }]}>{r.vendor}</Text>
              <Text style={ui.title}>{money(r.amount, 2)}</Text>
            </Row>
            <Text style={ui.muted}>
              {r.site_name} · {shortDate(r.date)} · {r.category_label}
              {tab !== 'mine' ? ` · ${r.submitted_by_name}` : ''}
            </Text>
            <Row style={{ marginTop: 6 }}>
              <Pill label={statusLabel(r.status)} color={STATUS_COLOR[r.status]} />
              {r.paid_with === 'personal' ? <Pill label={r.status === 'reimbursed' ? 'Paid back' : 'Pay back'} color={COLORS.accentDark} /> : null}
            </Row>
          </Card>
        ))}
      </ScrollView>
      {adding ? <AddSheet meta={meta} sites={sites} onClose={() => setAdding(false)} onDone={() => { setAdding(false); setTab('mine'); load(); }} /> : null}
      {open ? <DetailSheet expense={open} meta={meta} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); }} /> : null}
    </SafeAreaView>
  );
}

function AddSheet({ meta, sites, onClose, onDone }: { meta: any; sites: any[]; onClose: () => void; onDone: () => void }) {
  const [photo, setPhoto] = useState<{ data: string; type: string; preview: string } | null>(null);
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0].id : '');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('');
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState('materials');
  const [paidWith, setPaidWith] = useState('company_card');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);

  const pick = async (camera: boolean) => {
    try {
      if (camera && Platform.OS !== 'web') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) return Alert.alert('Camera access needed', 'Allow camera access in Settings to photograph receipts, or choose a photo instead.');
      }
      const opts: any = { base64: true, quality: Platform.OS === 'web' ? 1 : 0.5, mediaTypes: ['images'] };
      // On the web the library picker also offers "Take Photo" on phones.
      const res = camera && Platform.OS !== 'web' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.length) return;
      setWorking(true);
      const a = res.assets[0];
      const out = await shrinkForUpload(a.uri, a.base64, a.mimeType);
      const preview = out.data.startsWith('data:') ? out.data : `data:${out.type};base64,${out.data}`;
      setPhoto({ ...out, preview });
    } catch (e) {
      Alert.alert("Couldn't get the photo", String((e as any)?.message || e));
    } finally {
      setWorking(false);
    }
  };

  const save = async () => {
    const amt = parseFloat(amount.replace(/[$,\s]/g, ''));
    const tx = tax.trim() ? parseFloat(tax.replace(/[$,\s]/g, '')) : null;
    if (!photo) return Alert.alert('Add a photo of the receipt');
    if (!siteId) return Alert.alert('Choose a job, or Office');
    if (!vendor.trim()) return Alert.alert('Enter the store or supplier');
    if (!(amt > 0)) return Alert.alert('Enter the receipt total');
    if (tx !== null && !(tx >= 0 && tx <= amt)) return Alert.alert('Check the tax amount');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Alert.alert('Enter the date as YYYY-MM-DD');
    setSaving(true);
    try {
      await expensesApi.create({
        site_id: siteId, vendor: vendor.trim(), amount: amt, tax: tx, date, category, paid_with: paidWith,
        notes: notes.trim() || null, receipt_image: photo.data, receipt_type: photo.type,
      });
      Alert.alert('Receipt saved', paidWith === 'personal' ? "Accounting will review it and pay you back." : 'Accounting will review it.');
      onDone();
    } catch (e) {
      Alert.alert("Couldn't save the receipt", apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible title="Add a receipt" onClose={onClose} onSubmit={save} submitLabel="Save receipt" loading={saving}>
      {photo ? (
        <View style={{ marginBottom: 12 }}>
          <Image source={{ uri: photo.preview }} style={{ width: '100%', height: 220, borderRadius: 8, backgroundColor: COLORS.gray100 }} resizeMode="contain" />
          <Button title="Retake" small kind="ghost" icon="refresh" onPress={() => pick(true)} />
        </View>
      ) : (
        <View style={{ marginBottom: 14, gap: 8 }}>
          {working ? <ActivityIndicator color={COLORS.primary} /> : null}
          <Button title="Take a photo of the receipt" icon="photo-camera" onPress={() => pick(true)} />
          {Platform.OS !== 'web' ? <Button title="Choose from photos" icon="photo-library" kind="secondary" onPress={() => pick(false)} /> : null}
          <Text style={ui.muted}>Lay it flat, in good light, with the total and date readable.</Text>
        </View>
      )}
      <Text style={ui.fieldLabel}>Charge to</Text>
      <Chips options={[{ value: 'office', label: 'Office' }, ...sites.map((s) => ({ value: s.id, label: s.name }))]} value={siteId} onChange={setSiteId} />
      <Field label="Store or supplier" value={vendor} onChangeText={setVendor} placeholder="e.g. Home Depot" />
      <Row>
        <View style={{ flex: 1 }}>
          <Field label="Total (with tax)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="GST/HST (optional)" value={tax} onChangeText={setTax} keyboardType="decimal-pad" placeholder="0.00" />
        </View>
      </Row>
      <Field label="Date on receipt (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Text style={ui.fieldLabel}>Category</Text>
      <Chips options={meta.categories} value={category} onChange={setCategory} />
      <Text style={ui.fieldLabel}>Paid with</Text>
      <Chips options={meta.paid_with} value={paidWith} onChange={setPaidWith} />
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="What it was for" />
    </Sheet>
  );
}

function DetailSheet({ expense, meta, onClose, onDone }: { expense: any; meta: any; onClose: () => void; onDone: () => void }) {
  const [img, setImg] = useState<string | null | undefined>(undefined);
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    expensesApi
      .receipt(expense.id)
      .then((r) => {
        setImg(r.data_uri);
        setType(r.content_type);
      })
      .catch(() => setImg(null));
  }, [expense.id]);

  const act = async (action: 'approve' | 'reject' | 'reimbursed' | 'reopen') => {
    if (action === 'reject' && !note.trim()) return Alert.alert('Add a reason', 'Say what needs fixing so they can resubmit.');
    setBusy(true);
    try {
      await expensesApi.review(expense.id, action, note.trim() || undefined);
      onDone();
    } catch (e) {
      Alert.alert("Couldn't update", apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert('Delete receipt', `Delete the ${expense.vendor} receipt?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await expensesApi.remove(expense.id);
            onDone();
          } catch (e) {
            Alert.alert("Couldn't delete", apiError(e));
          }
        },
      },
    ]);

  const openFull = () => {
    if (Platform.OS === 'web' && img) {
      const w = window.open('', '_blank');
      if (w) w.document.write(type === 'application/pdf' ? `<iframe src="${img}" style="border:0;width:100%;height:100vh"></iframe>` : `<img src="${img}" style="max-width:100%">`);
    }
  };

  return (
    <Sheet visible title={`${expense.vendor} · ${money(expense.amount, 2)}`} onClose={onClose}>
      {img === undefined ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} /> : null}
      {img === null ? <Text style={[ui.muted, { marginBottom: 10 }]}>No receipt photo.</Text> : null}
      {img && type !== 'application/pdf' ? (
        <Image source={{ uri: img }} style={{ width: '100%', height: 320, borderRadius: 8, backgroundColor: COLORS.gray100, marginBottom: 6 }} resizeMode="contain" />
      ) : null}
      {img && Platform.OS === 'web' ? <Button title="Open full size" small kind="ghost" icon="open-in-new" onPress={openFull} /> : null}
      <Card>
        <Text style={ui.body}>Charged to: {expense.site_name}</Text>
        <Text style={ui.body}>Date: {shortDate(expense.date)}</Text>
        <Text style={ui.body}>Category: {expense.category_label}</Text>
        <Text style={ui.body}>
          Subtotal {money(expense.subtotal, 2)}
          {expense.tax != null ? ` + tax ${money(expense.tax, 2)}` : ''} = {money(expense.amount, 2)}
        </Text>
        <Text style={ui.body}>Paid with: {expense.paid_with_label}</Text>
        <Text style={ui.body}>Submitted by: {expense.submitted_by_name}</Text>
        {expense.notes ? <Text style={[ui.body, { marginTop: 6 }]}>{expense.notes}</Text> : null}
        <Row style={{ marginTop: 8 }}>
          <Pill label={statusLabel(expense.status)} color={STATUS_COLOR[expense.status]} />
        </Row>
        {expense.review_note ? <Text style={[ui.muted, { marginTop: 6 }]}>Note from {expense.reviewed_by_name}: {expense.review_note}</Text> : null}
      </Card>
      {(expense.history || []).map((h: any, i: number) => (
        <Text key={i} style={ui.muted}>
          {shortDate(h.at)}: {h.text} ({h.by})
        </Text>
      ))}
      {meta.can_review ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          {expense.status === 'submitted' ? (
            <>
              <Field label="Note (needed to reject)" value={note} onChangeText={setNote} placeholder="e.g. Total isn't readable, please retake" />
              <Button title="Approve" kind="success" icon="check" onPress={() => act('approve')} loading={busy} />
              <Button title="Reject" kind="danger" icon="close" onPress={() => act('reject')} loading={busy} />
            </>
          ) : null}
          {expense.status === 'approved' && expense.paid_with === 'personal' ? (
            <Button title={`Mark paid back to ${expense.submitted_by_name.split(' ')[0]}`} icon="payments" onPress={() => act('reimbursed')} loading={busy} />
          ) : null}
          {expense.status !== 'submitted' ? <Button title="Reopen for review" kind="ghost" onPress={() => act('reopen')} loading={busy} /> : null}
        </View>
      ) : null}
      {expense.status === 'submitted' && !meta.can_review ? <Button title="Delete receipt" kind="ghost" icon="delete" onPress={remove} /> : null}
      <View style={{ height: 8 }} />
    </Sheet>
  );
}
