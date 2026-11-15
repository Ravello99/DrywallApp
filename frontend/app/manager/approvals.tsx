import React, { useCallback, useState } from 'react';
import { ScrollView, RefreshControl, Text, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { ManpowerRequest, MaterialRequest } from '../../src/types/features';
import { manpowerApi, materialsApi, projectsApi, apiError } from '../../src/services/pmService';
import { useAuthStore } from '../../src/store/authStore';
import ManpowerRequestCard from '../../src/components/ManpowerRequestCard';
import Footer from '../../src/components/Footer';
import { Card, Pill, Row, Button, Sheet, Field, Empty, Loading, SectionTitle, Segments, shortDate, todayISO, timeOf, ui } from '../../src/components/ui';

export default function ApprovalsScreen() {
  const { user } = useAuthStore();
  const canApprove = ['admin', 'project_manager'].includes(user?.role || '');
  const canRelease = ['admin', 'project_manager', 'project_coordinator'].includes(user?.role || '');
  const [tab, setTab] = useState('materials');
  const [materials, setMaterials] = useState<MaterialRequest[] | null>(null);
  const [manpower, setManpower] = useState<ManpowerRequest[]>([]);
  const [flagged, setFlagged] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [releasing, setReleasing] = useState<MaterialRequest | null>(null);
  const [amount, setAmount] = useState('');
  const [supplier, setSupplier] = useState('');
  const [po, setPo] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, mp, fl] = await Promise.all([
        materialsApi.requests({ status: 'pending,approved' }),
        manpowerApi.requests({ status: 'pending' }),
        projectsApi.flagged().catch(() => []),
      ]);
      setMaterials(m);
      setManpower(mp);
      setFlagged(fl);
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

  const decide = async (r: MaterialRequest, approve: boolean) => {
    try {
      if (approve) await materialsApi.approve(r.id);
      else await materialsApi.reject(r.id);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    }
  };

  const release = async () => {
    if (!releasing) return;
    const a = parseFloat(amount.replace(/[$,]/g, ''));
    if (isNaN(a) || a < 0) return Alert.alert('Enter the material cost');
    setSaving(true);
    try {
      await materialsApi.release(releasing.id, { amount: a, supplier: supplier || null, po_number: po || null, released_on: todayISO() });
      setReleasing(null);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const review = async (id: string) => {
    try {
      await projectsApi.reviewFlagged(id);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    }
  };

  if (!materials) return <Loading />;
  const pendingMaterials = materials.filter((m) => m.status === 'pending');
  const toRelease = materials.filter((m) => m.status === 'approved');

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <Segments
        options={[
          { value: 'materials', label: 'Materials', badge: pendingMaterials.length || undefined },
          { value: 'manpower', label: 'Manpower', badge: manpower.length || undefined },
          { value: 'flagged', label: 'Flagged clock-ins', badge: flagged.length || undefined },
        ]}
        value={tab}
        onChange={setTab}
      />
      <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {tab === 'materials' ? (
          <>
            <SectionTitle title={`Waiting for approval (${pendingMaterials.length})`} />
            {pendingMaterials.length === 0 ? <Empty icon="task-alt" text="All caught up" /> : null}
            {pendingMaterials.map((r) => (
              <Card key={r.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={[ui.title, { flex: 1 }]}>{r.site_name}</Text>
                  {r.priority === 'urgent' ? <Pill label="urgent" /> : null}
                </Row>
                <Text style={ui.muted}>
                  {r.requested_by_name} · {shortDate(r.created_at)}
                  {r.needed_by ? ` · needed by ${shortDate(r.needed_by)}` : ''}
                </Text>
                {r.items.map((i, idx) => (
                  <Text key={idx} style={ui.body}>
                    • {i.quantity} {i.unit} — {i.description}
                  </Text>
                ))}
                {r.notes ? <Text style={ui.muted}>{r.notes}</Text> : null}
                {canApprove ? (
                  <Row style={{ marginTop: 10 }}>
                    <Button title="Approve" kind="success" small onPress={() => decide(r, true)} />
                    <Button title="Reject" kind="danger" small onPress={() => decide(r, false)} />
                  </Row>
                ) : null}
              </Card>
            ))}
            {canRelease ? (
              <>
                <SectionTitle title={`Approved, not released yet (${toRelease.length})`} />
                {toRelease.map((r) => (
                  <Card key={r.id}>
                    <Text style={ui.title}>{r.site_name}</Text>
                    {r.items.map((i, idx) => (
                      <Text key={idx} style={ui.body}>
                        • {i.quantity} {i.unit} — {i.description}
                      </Text>
                    ))}
                    <Button title="Release to site" icon="local-shipping" small onPress={() => { setReleasing(r); setAmount(''); setSupplier(''); setPo(''); }} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
                  </Card>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {tab === 'manpower' ? (
          manpower.length === 0 ? (
            <Empty icon="task-alt" text="No manpower requests waiting" />
          ) : (
            manpower.map((r) => <ManpowerRequestCard key={r.id} request={r} canApprove={canApprove} onChanged={load} showSite />)
          )
        ) : null}

        {tab === 'flagged' ? (
          <>
            <Text style={[ui.muted, { marginBottom: 10 }]}>
              Clock-ins the server couldn't fully check: site had no GPS location, or an offline clock-in was outside the radius / at a shut-down site.
            </Text>
            {flagged.length === 0 ? <Empty icon="verified" text="Nothing flagged" /> : null}
            {flagged.map((f) => (
              <Card key={f.id}>
                <Text style={ui.title}>
                  {f.user_name} · {f.site_name}
                </Text>
                <Text style={ui.muted}>
                  {shortDate(f.clock_in)} {timeOf(f.clock_in)}
                  {f.total_hours != null ? ` · ${f.total_hours} h` : ' · still on'}
                  {f.distance_m != null ? ` · ${f.distance_m} m from site` : ''}
                </Text>
                <Text style={ui.body}>{f.flag_reason}</Text>
                <Button title="Mark reviewed" kind="ghost" small onPress={() => review(f.id)} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
              </Card>
            ))}
          </>
        ) : null}
        <Footer />
      </ScrollView>

      <Sheet visible={!!releasing} title={`Release to ${releasing?.site_name || ''}`} onClose={() => setReleasing(null)} onSubmit={release} submitLabel="Record release" loading={saving}>
        <Field label="Material cost ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Field label="Supplier" value={supplier} onChangeText={setSupplier} />
        <Field label="PO number" value={po} onChangeText={setPo} />
        <Text style={ui.muted}>Counts toward the job's materials-vs-billing check.</Text>
      </Sheet>
    </SafeAreaView>
  );
}
