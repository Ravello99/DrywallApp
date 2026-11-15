import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, RefreshControl, Text, View, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Site } from '../../src/types';
import { MaterialRequest, ManpowerRequest, CrewAssignment } from '../../src/types/features';
import { siteService } from '../../src/services/siteService';
import { materialsApi, manpowerApi, apiError } from '../../src/services/pmService';
import { SPECIALTY_OPTIONS, specialtyLabel } from '../../src/constants/roles';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';
import { Card, Pill, Row, Button, Sheet, Field, Chips, Check, Empty, Loading, Segments, shortDate, todayISO, ui } from '../../src/components/ui';

type Item = { description: string; quantity: string; unit: string };
const UNITS = ['sheets', 'pcs', 'boxes', 'bundles', 'lf', 'pails', 'rolls', 'ea'];

export default function RequestsScreen() {
  const [tab, setTab] = useState('materials');
  const [sites, setSites] = useState<Site[]>([]);
  const [materials, setMaterials] = useState<MaterialRequest[] | null>(null);
  const [manpower, setManpower] = useState<ManpowerRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  // material form
  const [mOpen, setMOpen] = useState(false);
  const [mSite, setMSite] = useState('');
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: '', unit: 'sheets' }]);
  const [neededBy, setNeededBy] = useState('');
  const [priority, setPriority] = useState('normal');
  const [mNotes, setMNotes] = useState('');
  // manpower form
  const [pOpen, setPOpen] = useState(false);
  const [pSite, setPSite] = useState('');
  const [kind, setKind] = useState('request');
  const [specialty, setSpecialty] = useState('drywaller');
  const [count, setCount] = useState('1');
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState('');
  const [pNotes, setPNotes] = useState('');
  const [siteCrew, setSiteCrew] = useState<CrewAssignment[]>([]);
  const [release, setRelease] = useState<string[]>([]);

  useEffect(() => {
    siteService
      .getSites()
      .then((s: Site[]) => {
        setSites(s);
        if (s.length) {
          setMSite(s[0].id);
          setPSite(s[0].id);
        }
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([materialsApi.requests(), manpowerApi.requests()]);
      setMaterials(m);
      setManpower(p);
    } catch (e) {
      Alert.alert('Error', apiError(e));
      setMaterials([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!pOpen || kind !== 'release' || !pSite) return;
    manpowerApi
      .assignments({ site_id: pSite, current_only: true })
      .then(setSiteCrew)
      .catch(() => setSiteCrew([]));
  }, [pOpen, kind, pSite]);

  const setItem = (i: number, key: keyof Item, value: string) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [key]: value } : it)));

  const submitMaterials = async () => {
    const clean = items
      .filter((i) => i.description.trim())
      .map((i) => ({ description: i.description.trim(), quantity: parseFloat(i.quantity), unit: i.unit }));
    if (!mSite) return Alert.alert('Pick a site');
    if (!clean.length) return Alert.alert('Add at least one item');
    if (clean.some((i) => isNaN(i.quantity) || i.quantity <= 0)) return Alert.alert('Each item needs a quantity');
    setSaving(true);
    try {
      await materialsApi.createRequest({ site_id: mSite, items: clean, needed_by: neededBy || null, priority, notes: mNotes || null });
      setMOpen(false);
      setItems([{ description: '', quantity: '', unit: 'sheets' }]);
      setNeededBy('');
      setMNotes('');
      setPriority('normal');
      Alert.alert('Sent', 'Your PM has been notified.');
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const submitManpower = async () => {
    if (!pSite) return Alert.alert('Pick a site');
    const data: any = { site_id: pSite, kind, start_date: start || null, end_date: end || null, notes: pNotes || null };
    if (kind === 'request') {
      data.specialty = specialty;
      data.count = parseInt(count, 10) || 1;
    } else {
      if (!release.length) return Alert.alert('Pick who to release');
      data.user_ids = release;
      data.end_date = end || todayISO();
    }
    setSaving(true);
    try {
      await manpowerApi.createRequest(data);
      setPOpen(false);
      setRelease([]);
      setPNotes('');
      setEnd('');
      Alert.alert('Sent', 'Your PM has been notified.');
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const delivered = async (r: MaterialRequest) => {
    try {
      await materialsApi.delivered(r.id);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    }
  };

  if (!materials) return <Loading />;
  const siteOptions = sites.map((s) => ({ value: s.id, label: s.name }));

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <Segments
        options={[
          { value: 'materials', label: 'Materials' },
          { value: 'manpower', label: 'Manpower' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {tab === 'materials' ? (
          <>
            <Button title="Request materials" icon="add-shopping-cart" onPress={() => setMOpen(true)} style={{ marginBottom: 14 }} />
            {materials.length === 0 ? <Empty icon="inventory" text="No material requests yet" /> : null}
            {materials.map((r) => (
              <Card key={r.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={[ui.title, { flex: 1 }]}>{r.site_name}</Text>
                  <Pill label={r.status} />
                </Row>
                {r.items.map((i, idx) => (
                  <Text key={idx} style={ui.body}>
                    • {i.quantity} {i.unit} — {i.description}
                  </Text>
                ))}
                <Text style={ui.muted}>
                  {shortDate(r.created_at)}
                  {r.needed_by ? ` · needed ${shortDate(r.needed_by)}` : ''}
                  {r.decided_by_name ? ` · ${r.status} by ${r.decided_by_name}` : ''}
                </Text>
                {r.decision_notes ? <Text style={ui.body}>PM: {r.decision_notes}</Text> : null}
                {r.status === 'released' ? <Button title="Mark delivered" small kind="success" icon="done" onPress={() => delivered(r)} style={{ marginTop: 8, alignSelf: 'flex-start' }} /> : null}
              </Card>
            ))}
          </>
        ) : (
          <>
            <Row style={{ marginBottom: 14 }}>
              <Button title="Request crew" icon="group-add" onPress={() => { setKind('request'); setPOpen(true); }} style={{ flex: 1 }} />
              <Button title="Release crew" icon="group-remove" kind="ghost" onPress={() => { setKind('release'); setPOpen(true); }} style={{ flex: 1 }} />
            </Row>
            {manpower.length === 0 ? <Empty icon="groups" text="No manpower requests yet" /> : null}
            {manpower.map((r) => (
              <Card key={r.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={[ui.title, { flex: 1 }]}>
                    {r.kind === 'request' ? `${r.count} × ${specialtyLabel(r.specialty) || 'crew'}` : `Release ${(r.user_names || []).join(', ')}`}
                  </Text>
                  <Pill label={r.status} />
                </Row>
                <Text style={ui.muted}>
                  {r.site_name}
                  {r.start_date ? ` · from ${shortDate(r.start_date)}` : ''}
                  {r.end_date ? ` · to ${shortDate(r.end_date)}` : ''}
                </Text>
                {r.assigned_user_names?.length ? <Text style={ui.body}>Coming: {r.assigned_user_names.join(', ')}</Text> : null}
                {r.decision_notes ? <Text style={ui.body}>PM: {r.decision_notes}</Text> : null}
              </Card>
            ))}
          </>
        )}
        <Footer />
      </ScrollView>

      <Sheet visible={mOpen} title="Request materials" onClose={() => setMOpen(false)} onSubmit={submitMaterials} submitLabel="Send to PM" loading={saving}>
        {sites.length > 1 ? (
          <>
            <Text style={ui.fieldLabel}>Site</Text>
            <Chips options={siteOptions} value={mSite} onChange={setMSite} />
          </>
        ) : null}
        {items.map((it, i) => (
          <View key={i} style={[ui.card, { padding: 10 }]}>
            <Row>
              <TextInput style={[ui.input, { flex: 1 }]} placeholder='Item (e.g. 5/8" Type X 4x12)' value={it.description} onChangeText={(v) => setItem(i, 'description', v)} placeholderTextColor={COLORS.gray400} />
              {items.length > 1 ? <MaterialIcons name="delete-outline" size={24} color={COLORS.error} onPress={() => setItems(items.filter((_, idx) => idx !== i))} /> : null}
            </Row>
            <Row style={{ marginTop: 8 }}>
              <TextInput style={[ui.input, { width: 90 }]} placeholder="Qty" value={it.quantity} onChangeText={(v) => setItem(i, 'quantity', v)} keyboardType="decimal-pad" placeholderTextColor={COLORS.gray400} />
              <View style={{ flex: 1 }}>
                <Chips options={UNITS.map((u) => ({ value: u, label: u }))} value={it.unit} onChange={(v: string) => setItem(i, 'unit', v)} />
              </View>
            </Row>
          </View>
        ))}
        <Button title="Add another item" kind="ghost" small icon="add" onPress={() => setItems([...items, { description: '', quantity: '', unit: 'pcs' }])} style={{ alignSelf: 'flex-start', marginBottom: 12 }} />
        <Text style={ui.fieldLabel}>Priority</Text>
        <Chips options={[{ value: 'urgent', label: 'Urgent' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }]} value={priority} onChange={setPriority} />
        <Field label="Needed by (YYYY-MM-DD)" value={neededBy} onChangeText={setNeededBy} placeholder="optional" />
        <Field label="Notes" value={mNotes} onChangeText={setMNotes} placeholder="e.g. deliver to level 3 loading bay" />
      </Sheet>

      <Sheet visible={pOpen} title={kind === 'request' ? 'Request crew' : 'Release crew'} onClose={() => setPOpen(false)} onSubmit={submitManpower} submitLabel="Send to PM" loading={saving}>
        {sites.length > 1 ? (
          <>
            <Text style={ui.fieldLabel}>Site</Text>
            <Chips options={siteOptions} value={pSite} onChange={setPSite} />
          </>
        ) : null}
        {kind === 'request' ? (
          <>
            <Text style={ui.fieldLabel}>Trade needed</Text>
            <Chips options={SPECIALTY_OPTIONS} value={specialty} onChange={setSpecialty} />
            <Field label="How many" value={count} onChangeText={setCount} keyboardType="number-pad" />
            <Row>
              <View style={{ flex: 1 }}>
                <Field label="Start (YYYY-MM-DD)" value={start} onChangeText={setStart} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Until (optional)" value={end} onChangeText={setEnd} />
              </View>
            </Row>
          </>
        ) : (
          <>
            <Text style={ui.fieldLabel}>Who to release</Text>
            {siteCrew.length === 0 ? <Text style={ui.muted}>No crew assigned to this site.</Text> : null}
            {siteCrew.map((a) => (
              <Check key={a.id} checked={release.includes(a.user_id)} label={a.user_name} onPress={() => setRelease(release.includes(a.user_id) ? release.filter((x) => x !== a.user_id) : [...release, a.user_id])} />
            ))}
            <Field label="Last day (YYYY-MM-DD)" value={end} onChangeText={setEnd} placeholder={todayISO()} />
          </>
        )}
        <Field label="Notes" value={pNotes} onChangeText={setPNotes} multiline />
      </Sheet>
    </SafeAreaView>
  );
}
