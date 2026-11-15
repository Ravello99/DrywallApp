import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { MaterialRequest, MaterialRelease } from '../../types/features';
import { materialsApi, apiError } from '../../services/pmService';
import { Card, SectionTitle, Pill, Sheet, Field, Button, Empty, Loading, Row, money, shortDate, todayISO, ui } from '../ui';

type Props = { siteId: string; canApprove: boolean; canRelease: boolean; onChanged: () => void };

export default function MaterialsTab({ siteId, canApprove, canRelease, onChanged }: Props) {
  const [requests, setRequests] = useState<MaterialRequest[] | null>(null);
  const [releases, setReleases] = useState<MaterialRelease[]>([]);
  const [releasing, setReleasing] = useState<MaterialRequest | 'manual' | null>(null);
  const [amount, setAmount] = useState('');
  const [supplier, setSupplier] = useState('');
  const [po, setPo] = useState('');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, rel] = await Promise.all([materialsApi.requests({ site_id: siteId }), canRelease ? materialsApi.releases(siteId) : Promise.resolve([])]);
      setRequests(r);
      setReleases(rel);
    } catch (e) {
      Alert.alert('Error', apiError(e));
      setRequests([]);
    }
  }, [siteId, canRelease]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (r: MaterialRequest, approve: boolean) => {
    try {
      if (approve) await materialsApi.approve(r.id);
      else await materialsApi.reject(r.id);
      load();
      onChanged();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    }
  };

  const openRelease = (r: MaterialRequest | 'manual') => {
    setReleasing(r);
    setAmount('');
    setSupplier('');
    setPo('');
    setDesc('');
    setDate(todayISO());
  };

  const saveRelease = async () => {
    const a = parseFloat(amount.replace(/[$,]/g, ''));
    if (isNaN(a) || a < 0) {
      Alert.alert('Enter the material cost', 'This is what the released material cost, e.g. 18450');
      return;
    }
    const data = { amount: a, supplier: supplier || null, po_number: po || null, description: desc || null, released_on: date };
    setSaving(true);
    try {
      if (releasing === 'manual') await materialsApi.createRelease({ ...data, site_id: siteId });
      else if (releasing) await materialsApi.release(releasing.id, data);
      setReleasing(null);
      load();
      onChanged();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!requests) return <Loading />;
  const totalReleased = releases.reduce((s, r) => s + r.amount, 0);

  return (
    <View style={ui.pad}>
      <SectionTitle title="Requests from site" />
      {requests.length === 0 ? (
        <Empty icon="inventory" text="No material requests" />
      ) : (
        requests.map((r) => (
          <Card key={r.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={ui.title}>{r.requested_by_name}</Text>
              <Row>
                {r.priority === 'urgent' ? <Pill label="urgent" /> : null}
                <Pill label={r.status} />
              </Row>
            </Row>
            {r.items.map((i, idx) => (
              <Text key={idx} style={ui.body}>
                • {i.quantity} {i.unit} — {i.description}
              </Text>
            ))}
            <Text style={[ui.muted, { marginTop: 4 }]}>
              {shortDate(r.created_at)}
              {r.needed_by ? ` · needed by ${shortDate(r.needed_by)}` : ''}
              {r.notes ? ` · ${r.notes}` : ''}
            </Text>
            {r.status === 'pending' && canApprove ? (
              <Row style={{ marginTop: 10 }}>
                <Button title="Approve" kind="success" small onPress={() => decide(r, true)} />
                <Button title="Reject" kind="danger" small onPress={() => decide(r, false)} />
                {canRelease ? <Button title="Release now" kind="ghost" small onPress={() => openRelease(r)} /> : null}
              </Row>
            ) : null}
            {r.status === 'approved' && canRelease ? (
              <Button title="Release to site" icon="local-shipping" small onPress={() => openRelease(r)} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
            ) : null}
          </Card>
        ))
      )}

      {canRelease ? (
        <>
          <SectionTitle title={`Released (${money(totalReleased)})`} action="Record release" onAction={() => openRelease('manual')} />
          {releases.length === 0 ? (
            <Empty icon="local-shipping" text="Nothing released yet" />
          ) : (
            releases.map((r) => (
              <Card key={r.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={ui.title}>{money(r.amount)}</Text>
                  <Text style={ui.muted}>{shortDate(r.released_on)}</Text>
                </Row>
                <Text style={ui.body}>{r.description}</Text>
                <Text style={ui.muted}>
                  {[r.supplier, r.po_number ? `PO ${r.po_number}` : null, `by ${r.released_by_name}`].filter(Boolean).join(' · ')}
                </Text>
              </Card>
            ))
          )}
        </>
      ) : null}

      <Sheet visible={!!releasing} title="Release materials" onClose={() => setReleasing(null)} onSubmit={saveRelease} submitLabel="Record release" loading={saving}>
        {releasing && releasing !== 'manual' ? (
          <View style={ui.infoBox}>
            {releasing.items.map((i, idx) => (
              <Text key={idx} style={ui.body}>
                • {i.quantity} {i.unit} — {i.description}
              </Text>
            ))}
          </View>
        ) : (
          <Field label="What was released" value={desc} onChangeText={setDesc} placeholder='e.g. Initial stocking: studs, track, 5/8" board' />
        )}
        <Field label="Material cost ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Field label="Supplier" value={supplier} onChangeText={setSupplier} />
        <Field label="PO number" value={po} onChangeText={setPo} />
        <Field label="Release date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
        <Text style={ui.muted}>The cost counts toward this job's materials-vs-billing check.</Text>
      </Sheet>
    </View>
  );
}
