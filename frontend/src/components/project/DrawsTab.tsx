import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { Draw } from '../../types/features';
import { drawApi, apiError } from '../../services/pmService';
import { openServerDocument } from '../../utils/openDocument';
import { COLORS } from '../../constants/colors';
import { Card, SectionTitle, Pill, Sheet, Field, Chips, Empty, Loading, Row, Button, Stat, StatRow, money, shortDate, todayISO, ui } from '../ui';

export default function DrawsTab({ siteId, canBill, onChanged }: { siteId: string; canBill: boolean; onChanged: () => void }) {
  const [draws, setDraws] = useState<Draw[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Draw | null>(null);
  const [billTo, setBillTo] = useState('');
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [paying, setPaying] = useState<Draw | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('percent');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [holdback, setHoldback] = useState('10');
  const [tax, setTax] = useState('5');
  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [desc, setDesc] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState(todayISO());

  const load = useCallback(async () => {
    try {
      setDraws(await drawApi.list({ site_id: siteId }));
    } catch (e) {
      Alert.alert('Error', apiError(e));
      setDraws([]);
    }
  }, [siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = async () => {
    setEditing(null);
    setMode('percent');
    setPercent('');
    setAmount('');
    setDesc('');
    setPeriodEnd(todayISO());
    setCreating(true);
    try {
      const d = await drawApi.defaults(siteId);
      setBillTo(d.bill_to || '');
      setHoldback(String(d.holdback_pct));
      setTax(String(d.tax_pct));
    } catch {
      /* keep the form's own defaults */
    }
  };

  const openEdit = (d: Draw) => {
    setEditing(d);
    setMode(d.mode || 'percent');
    setPercent(d.percent_complete != null ? String(d.percent_complete) : '');
    setAmount(String(d.gross));
    setHoldback(String(d.holdback_pct));
    setTax(String(d.tax_pct));
    setPeriodEnd(d.period_end || '');
    setDesc(d.description || '');
    setBillTo(d.bill_to || '');
    setCreating(true);
  };

  const viewInvoice = (d: Draw) => openServerDocument(() => drawApi.link(d.id));

  const create = async () => {
    const data: any = {
      site_id: siteId,
      mode,
      holdback_pct: parseFloat(holdback) || 0,
      tax_pct: parseFloat(tax) || 0,
      period_end: periodEnd || null,
      description: desc || null,
      bill_to: billTo.trim() || null,
    };
    if (mode === 'percent') data.percent_complete = parseFloat(percent);
    else data.amount = parseFloat(amount.replace(/[$,]/g, ''));
    if ((mode === 'percent' && isNaN(data.percent_complete)) || (mode === 'amount' && isNaN(data.amount))) {
      Alert.alert(mode === 'percent' ? 'Enter the total % complete' : 'Enter the amount for this draw');
      return;
    }
    setSaving(true);
    try {
      if (editing) await drawApi.update(editing.id, data);
      else await drawApi.create(data);
      setCreating(false);
      setEditing(null);
      setPercent('');
      setAmount('');
      setDesc('');
      load();
      onChanged();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const submit = (d: Draw) =>
    Alert.alert('Send invoice', `Send ${d.invoice_number} (${money(d.total_due, 2)}) to ${(d.bill_to || 'the GC').split('\n')[0]}? It's dated today and can't be changed after this. Open the invoice afterwards to print it or save it as a PDF.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          try {
            await drawApi.submit(d.id);
            load();
            onChanged();
          } catch (e) {
            Alert.alert('Error', apiError(e));
          }
        },
      },
    ]);

  const removeDraft = (d: Draw) =>
    Alert.alert('Delete draft', `Delete ${d.invoice_number}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await drawApi.remove(d.id);
            load();
          } catch (e) {
            Alert.alert('Error', apiError(e));
          }
        },
      },
    ]);

  const openPay = (d: Draw) => {
    setPaying(d);
    setPayAmount(String(d.balance));
    setPayRef('');
    setPayDate(todayISO());
  };

  const pay = async () => {
    if (!paying) return;
    const a = parseFloat(payAmount.replace(/[$,]/g, ''));
    if (isNaN(a) || a <= 0) {
      Alert.alert('Enter the amount received');
      return;
    }
    setSaving(true);
    try {
      await drawApi.pay(paying.id, { amount: a, reference: payRef || null, paid_on: payDate });
      setPaying(null);
      load();
      onChanged();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!draws) return <Loading />;
  const sent = draws.filter((d) => d.status !== 'draft');
  const billed = sent.reduce((s, d) => s + d.gross, 0);
  const outstanding = sent.reduce((s, d) => s + Math.max(d.balance, 0), 0);
  const holdbackHeld = sent.reduce((s, d) => s + d.holdback, 0);

  return (
    <View style={ui.pad}>
      <StatRow>
        <Stat label="Billed (before tax)" value={money(billed)} />
        <Stat label="Outstanding" value={money(outstanding)} color={outstanding > 0 ? COLORS.warning : undefined} />
        <Stat label="Holdback held" value={money(holdbackHeld)} />
      </StatRow>
      <SectionTitle title="Progress draws" action={canBill ? 'New draw' : undefined} onAction={openNew} />
      {draws.length === 0 ? (
        <Empty icon="receipt-long" text="No draws yet" sub={canBill ? 'Set the contract value on the Overview tab, then bill by % complete.' : undefined} />
      ) : (
        draws.map((d) => (
          <Card key={d.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={ui.title}>
                {d.invoice_number} · Draw {d.number}
              </Text>
              <Pill label={d.status} />
            </Row>
            <Text style={ui.body}>
              {money(d.gross, 2)} gross − {money(d.holdback, 2)} holdback + {money(d.tax, 2)} tax = <Text style={{ fontWeight: '700' }}>{money(d.total_due, 2)}</Text>
            </Text>
            <Text style={ui.muted}>
              {[
                d.percent_complete != null ? `${d.percent_complete}% complete` : null,
                d.period_end ? `period to ${shortDate(d.period_end)}` : null,
                d.status !== 'draft' ? `balance ${money(d.balance, 2)}` : null,
                d.days_outstanding != null ? `${d.days_outstanding} days outstanding` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {d.bill_to ? <Text style={ui.muted}>Bill to: {d.bill_to.split('\n')[0]}</Text> : null}
            {d.invoice_date ? (
              <Text style={ui.muted}>
                Invoice dated {shortDate(d.invoice_date)}
                {d.due_date ? `, due ${shortDate(d.due_date)}` : ''}
              </Text>
            ) : null}
            {d.payments.map((p, i) => (
              <Text key={i} style={[ui.muted, { color: COLORS.success }]}>
                Paid {money(p.amount, 2)} on {shortDate(p.paid_on)}
                {p.reference ? ` (${p.reference})` : ''}
              </Text>
            ))}
            {openHistory === d.id
              ? (d.history || []).map((h, i) => (
                  <Text key={i} style={ui.muted}>
                    {shortDate(h.at)}: {h.text} ({h.by})
                  </Text>
                ))
              : null}
            <Row style={{ marginTop: 10, flexWrap: 'wrap' }}>
              <Button title={d.status === 'draft' ? 'Preview invoice' : 'View invoice'} small kind="ghost" icon="description" onPress={() => viewInvoice(d)} />
              {(d.history || []).length ? (
                <Button title={openHistory === d.id ? 'Hide history' : 'History'} small kind="ghost" onPress={() => setOpenHistory(openHistory === d.id ? null : d.id)} />
              ) : null}
              {canBill && d.status === 'draft' ? (
                <>
                  <Button title="Send invoice" small onPress={() => submit(d)} />
                  <Button title="Edit" kind="ghost" small onPress={() => openEdit(d)} />
                  <Button title="Delete" kind="ghost" small onPress={() => removeDraft(d)} />
                </>
              ) : canBill && d.balance > 0 ? (
                <Button title="Record payment" kind="success" small icon="payments" onPress={() => openPay(d)} />
              ) : null}
            </Row>
          </Card>
        ))
      )}

      <Sheet visible={creating} title={editing ? `Edit ${editing.invoice_number}` : 'New progress draw'} onClose={() => { setCreating(false); setEditing(null); }} onSubmit={create} submitLabel={editing ? 'Save draft' : 'Create draft'} loading={saving}>
        <Chips options={[{ value: 'percent', label: 'By % complete' }, { value: 'amount', label: 'By amount' }]} value={mode} onChange={setMode} />
        {mode === 'percent' ? (
          <Field label="Total % complete to date" value={percent} onChangeText={setPercent} keyboardType="decimal-pad" placeholder="e.g. 45 (earlier draws are subtracted)" />
        ) : (
          <Field label="Amount this period, before holdback & tax ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        )}
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="Holdback %" value={holdback} onChangeText={setHoldback} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Tax % (GST)" value={tax} onChangeText={setTax} keyboardType="decimal-pad" />
          </View>
        </Row>
        <Field label="Period ending (YYYY-MM-DD)" value={periodEnd} onChangeText={setPeriodEnd} />
        <Field label="Description (optional)" value={desc} onChangeText={setDesc} placeholder="Shown on the invoice" />
        <Field label="Bill to (GC name and billing address)" value={billTo} onChangeText={setBillTo} multiline placeholder={'Northline Builders Inc.\nAttn: Accounts Payable\n200 King St W, Toronto ON'} />
      </Sheet>

      <Sheet visible={!!paying} title={`Payment for ${paying?.invoice_number || ''}`} onClose={() => setPaying(null)} onSubmit={pay} submitLabel="Record payment" submitKind="success" loading={saving}>
        <Field label="Amount received ($)" value={payAmount} onChangeText={setPayAmount} keyboardType="decimal-pad" />
        <Field label="Cheque / EFT reference" value={payRef} onChangeText={setPayRef} />
        <Field label="Date received (YYYY-MM-DD)" value={payDate} onChangeText={setPayDate} />
      </Sheet>
    </View>
  );
}
