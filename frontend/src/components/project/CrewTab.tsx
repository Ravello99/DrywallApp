import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { CrewAssignment, ManpowerRequest } from '../../types/features';
import { manpowerApi, apiError } from '../../services/pmService';
import ManpowerRequestCard from '../ManpowerRequestCard';
import CrewPicker from '../CrewPicker';
import { Card, SectionTitle, Sheet, Field, Empty, Loading, Row, Button, shortDate, todayISO, ui } from '../ui';

export default function CrewTab({ siteId, canApprove, onChanged }: { siteId: string; canApprove: boolean; onChanged: () => void }) {
  const [assignments, setAssignments] = useState<CrewAssignment[] | null>(null);
  const [requests, setRequests] = useState<ManpowerRequest[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([manpowerApi.assignments({ site_id: siteId, current_only: true }), manpowerApi.requests({ site_id: siteId })]);
      setAssignments(a);
      setRequests(r);
    } catch (e) {
      Alert.alert('Error', apiError(e));
      setAssignments([]);
    }
  }, [siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = () => {
    load();
    onChanged();
  };

  const assign = async () => {
    if (!picked.length) {
      Alert.alert('Pick crew');
      return;
    }
    setSaving(true);
    try {
      for (const uid of picked) await manpowerApi.assign({ user_id: uid, site_id: siteId, start_date: start, end_date: end || null });
      setAssigning(false);
      setPicked([]);
      changed();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = (a: CrewAssignment) =>
    Alert.alert('Remove from site', `Take ${a.user_name} off this site?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await manpowerApi.removeAssignment(a.id);
            changed();
          } catch (e) {
            Alert.alert('Error', apiError(e));
          }
        },
      },
    ]);

  if (!assignments) return <Loading />;
  const pending = requests.filter((r) => r.status === 'pending');
  const history = requests.filter((r) => r.status !== 'pending').slice(0, 10);

  return (
    <View style={ui.pad}>
      {pending.length ? (
        <>
          <SectionTitle title={`Waiting for approval (${pending.length})`} />
          {pending.map((r) => (
            <ManpowerRequestCard key={r.id} request={r} canApprove={canApprove} onChanged={changed} />
          ))}
        </>
      ) : null}

      <SectionTitle title={`Assigned crew (${assignments.length})`} action={canApprove ? 'Assign' : undefined} onAction={() => setAssigning(true)} />
      {assignments.length === 0 ? (
        <Empty icon="groups" text="No crew assigned" sub="Assigned crew can clock in here and see it on their calendar." />
      ) : (
        assignments.map((a) => (
          <Card key={a.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={ui.title}>{a.user_name}</Text>
              {canApprove ? <Button title="Remove" kind="ghost" small onPress={() => remove(a)} /> : null}
            </Row>
            <Text style={ui.muted}>
              From {shortDate(a.start_date)}
              {a.end_date ? ` until ${shortDate(a.end_date)}` : ' (ongoing)'}
            </Text>
          </Card>
        ))
      )}

      {history.length ? (
        <>
          <SectionTitle title="Recent requests" />
          {history.map((r) => (
            <ManpowerRequestCard key={r.id} request={r} canApprove={false} onChanged={changed} />
          ))}
        </>
      ) : null}

      <Sheet visible={assigning} title="Assign crew to this site" onClose={() => setAssigning(false)} onSubmit={assign} submitLabel="Assign" loading={saving}>
        <Row>
          <View style={{ flex: 1 }}>
            <Field label="Start (YYYY-MM-DD)" value={start} onChangeText={setStart} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="End (optional)" value={end} onChangeText={setEnd} />
          </View>
        </Row>
        <CrewPicker startDate={start} endDate={end || null} selected={picked} onChange={setPicked} />
      </Sheet>
    </View>
  );
}
