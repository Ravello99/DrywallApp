import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { ChangeOrder } from '../../types/features';
import { changeOrderApi, apiError } from '../../services/pmService';
import { Card, SectionTitle, Pill, Sheet, Field, Chips, Empty, Loading, Row, Button, money, shortDate, ui } from '../ui';

const REASONS = [
  { value: 'owner_request', label: 'Owner request' },
  { value: 'design_change', label: 'Design change' },
  { value: 'site_condition', label: 'Site condition' },
  { value: 'rfi_result', label: 'From an RFI' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'other', label: 'Other' },
];

export default function ChangesTab({ siteId, canEdit, onChanged }: { siteId: string; canEdit: boolean; onChanged: () => void }) {
  const [cos, setCos] = useState<ChangeOrder[] | null>(null);
  const [form, setForm] = useState<ChangeOrder | 'new' | null>(null);
  const [deciding, setDeciding] = useState<ChangeOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('owner_request');
  const [gcRef, setGcRef] = useState('');
  const [decision, setDecision] = useState('approved');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      setCos(await changeOrderApi.list({ site_id: siteId }));
    } catch (e) {
      Alert.alert('Error', apiError(e));
      setCos([]);
    }
  }, [siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const openForm = (co: ChangeOrder | 'new') => {
    setForm(co);
    setTitle(co === 'new' ? '' : co.title);
    setDesc(co === 'new' ? '' : co.description || '');
    setAmount(co === 'new' ? '' : String(co.amount));
    setReason(co === 'new' ? 'owner_request' : co.reason);
    setGcRef(co === 'new' ? '' : co.gc_reference || '');
  };

  const save = async () => {
    const a = parseFloat(amount.replace(/[$,]/g, ''));
    if (title.trim().length < 3 || isNaN(a)) {
      Alert.alert('Add a title and an amount', 'Use a negative amount for a credit.');
      return;
    }
    const data = { title: title.trim(), description: desc || null, amount: a, reason, gc_reference: gcRef || null };
    setSaving(true);
    try {
      if (form === 'new') await changeOrderApi.create({ ...data, site_id: siteId });
      else if (form) await changeOrderApi.update(form.id, data);
      setForm(null);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const submit = async (co: ChangeOrder) => {
    try {
      await changeOrderApi.submit(co.id);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    }
  };

  const openDecision = (co: ChangeOrder) => {
    setDeciding(co);
    setDecision('approved');
    setApprovedAmount(String(co.amount));
    setNotes('');
  };

  const decide = async () => {
    if (!deciding) return;
    const a = parseFloat(approvedAmount.replace(/[$,]/g, ''));
    setSaving(true);
    try {
      await changeOrderApi.respond(deciding.id, {
        decision,
        approved_amount: decision === 'approved' && !isNaN(a) ? a : undefined,
        response_notes: notes || null,
      });
      setDeciding(null);
      load();
      onChanged();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!cos) return <Loading />;
  const approvedTotal = cos.filter((c) => c.status === 'approved').reduce((s, c) => s + (c.approved_amount || 0), 0);
  const pendingTotal = cos.filter((c) => c.status === 'submitted').reduce((s, c) => s + c.amount, 0);

  return (
    <View style={ui.pad}>
      <SectionTitle title="Change orders" action={canEdit ? 'New' : undefined} onAction={() => openForm('new')} />
      <Text style={[ui.muted, { marginBottom: 12 }]}>
        Approved {money(approvedTotal)} · Waiting on GC {money(pendingTotal)}
      </Text>
      {cos.length === 0 ? (
        <Empty icon="swap-horiz" text="No change orders" />
      ) : (
        cos.map((c) => (
          <Card key={c.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={[ui.title, { flex: 1 }]}>
                CO #{c.number} {c.title}
              </Text>
              <Pill label={c.status} />
            </Row>
            <Text style={ui.body}>
              {money(c.amount, 2)}
              {c.status === 'approved' && c.approved_amount !== c.amount ? ` (approved ${money(c.approved_amount, 2)})` : ''}
            </Text>
            <Text style={ui.muted}>
              {[REASONS.find((r) => r.value === c.reason)?.label, c.gc_reference ? `GC ref ${c.gc_reference}` : null, shortDate(c.created_at)].filter(Boolean).join(' · ')}
            </Text>
            {c.response_notes ? <Text style={[ui.body, { marginTop: 4 }]}>GC: {c.response_notes}</Text> : null}
            {canEdit && (c.status === 'draft' || c.status === 'submitted') ? (
              <Row style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <Button title="Edit" kind="ghost" small onPress={() => openForm(c)} />
                {c.status === 'draft' ? <Button title="Mark sent to GC" small onPress={() => submit(c)} /> : null}
                <Button title="Record GC answer" kind="secondary" small onPress={() => openDecision(c)} />
              </Row>
            ) : null}
          </Card>
        ))
      )}

      <Sheet visible={!!form} title={form === 'new' ? 'New change order' : 'Edit change order'} onClose={() => setForm(null)} onSubmit={save} loading={saving}>
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Extra bulkheads, Level 3" />
        <Field label="Description" value={desc} onChangeText={setDesc} multiline />
        <Field label="Amount ($)" value={amount} onChangeText={setAmount} keyboardType="numbers-and-punctuation" placeholder="negative for a credit" />
        <Text style={ui.fieldLabel}>Reason</Text>
        <Chips options={REASONS} value={reason} onChange={setReason} />
        <Field label="GC reference (optional)" value={gcRef} onChangeText={setGcRef} />
      </Sheet>

      <Sheet visible={!!deciding} title="GC's answer" onClose={() => setDeciding(null)} onSubmit={decide} submitLabel="Save answer" loading={saving}>
        <Chips options={[{ value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }]} value={decision} onChange={setDecision} />
        {decision === 'approved' ? <Field label="Approved amount ($)" value={approvedAmount} onChangeText={setApprovedAmount} keyboardType="numbers-and-punctuation" /> : null}
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
        {decision === 'approved' ? <Text style={ui.muted}>The approved amount is added to this job's contract value.</Text> : null}
      </Sheet>
    </View>
  );
}
