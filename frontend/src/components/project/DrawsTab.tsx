import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { Draw } from '../../types/features';
import { drawApi, apiError } from '../../services/pmService';
import { COLORS } from '../../constants/colors';
import { Card, SectionTitle, Pill, Sheet, Field, Chips, Empty, Loading, Row, Button, Stat, StatRow, money, shortDate, todayISO, ui } from '../ui';

export default function DrawsTab({ siteId, canBill, onChanged }: { siteId: string; canBill: boolean; onChanged: () => void }) {
  const [draws, setDraws] = useState<Draw[] | null>(null);
  const [creating, setCreating] = useState(false);
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

  const create = async () => {
    const data: any = {
      site_id: siteId,
      mode,
      holdback_pct: parseFloat(holdback) || 0,
      tax_pct: parseFloat(tax) || 0,
      period_end: periodEnd || null,
      description: desc || null,
    };
    if (mode === 'percent') data.percent_complete = parseFloat(percent);
    else data.amount = parseFloat(amount.replace(/[$,]/g, ''));
    if ((mode === 'percent' && isNaN(data.percent_complete)) || (mode === 'amount' && isNaN(data.amount))) {
      Alert.alert(mode === 'percent' ? 'Enter the total % complete' : 'Enter the amount for this draw');
      return;
    }
    setSaving(true);
    try {
      await drawApi.create(data);
      setCreating(false);
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
    Alert.alert('Submit draw', `Mark ${d.invoice_number} (${money(d.total_due, 2)}) as sent to the GC?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Submit',
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
      <SectionTitle title="Progress draws" action={canBill ? 'New draw' : undefined} onAction={() => setCreating(true)} />
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
            {d.payments.map((p, i) => (
              <Text key={i} style={[ui.muted, { color: COLORS.success }]}>
                Paid {money(p.amount, 2)} on {shortDate(p.paid_on)}
                {p.reference ? ` (${p.reference})` : ''}
              </Text>
            ))}
            {canBill ? (
              <Row style={{ marginTop: 10 }}>
                {d.status === 'draft' ? (
                  <>
                    <Button title="Submit to GC" small onPress={() => submit(d)} />
                    <Button title="Delete" kind="ghost" small onPress={() => removeDraft(d)} />
                  </>
                ) : d.balance > 0 ? (
                  <Button title="Record payment" kind="success" small icon="payments" onPress={() => openPay(d)} />
                ) : null}
              </Row>
            ) : null}
          </Card>
        ))
      )}

      <Sheet visible={creating} title="New progress draw" onClose={() => setCreating(false)} onSubmit={create} submitLabel="Create draft" loading={saving}>
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
        <Field label="Description (optional)" value={desc} onChangeText={setDesc} />
      </Sheet>

      <Sheet visible={!!paying} title={`Payment for ${paying?.invoice_number || ''}`} onClose={() => setPaying(null)} onSubmit={pay} submitLabel="Record payment" submitKind="success" loading={saving}>
        <Field label="Amount received ($)" value={payAmount} onChangeText={setPayAmount} keyboardType="decimal-pad" />
        <Field label="Cheque / EFT reference" value={payRef} onChangeText={setPayRef} />
        <Field label="Date received (YYYY-MM-DD)" value={payDate} onChangeText={setPayDate} />
      </Sheet>
    </View>
  );
}
