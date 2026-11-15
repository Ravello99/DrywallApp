// A manpower request with the PM's approve (pick people) / reject actions.
import React, { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { ManpowerRequest } from '../types/features';
import { manpowerApi, apiError } from '../services/pmService';
import { specialtyLabel } from '../constants/roles';
import CrewPicker from './CrewPicker';
import { Card, Pill, Row, Button, Sheet, Field, shortDate, ui } from './ui';

export default function ManpowerRequestCard({ request: r, canApprove, onChanged, showSite }: { request: ManpowerRequest; canApprove: boolean; onChanged: () => void; showSite?: boolean }) {
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const approve = async () => {
    if (r.kind === 'request' && picked.length === 0) {
      Alert.alert('Pick crew', 'Choose who to send to the site.');
      return;
    }
    setSaving(true);
    try {
      await manpowerApi.approve(r.id, picked, notes || undefined);
      setPicking(false);
      onChanged();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const reject = () =>
    Alert.alert('Reject request', 'Reject this manpower request?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          try {
            await manpowerApi.reject(r.id);
            onChanged();
          } catch (e) {
            Alert.alert('Error', apiError(e));
          }
        },
      },
    ]);

  const what =
    r.kind === 'request'
      ? `Needs ${r.count} × ${r.specialty ? specialtyLabel(r.specialty) : 'crew'}`
      : `Release ${(r.user_names || []).join(', ')}`;

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[ui.title, { flex: 1 }]}>{what}</Text>
        <Pill label={r.status} />
      </Row>
      <Text style={ui.muted}>
        {[showSite ? r.site_name : null, `from ${r.requested_by_name}`, r.start_date ? `starting ${shortDate(r.start_date)}` : null, r.end_date ? `until ${shortDate(r.end_date)}` : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {r.notes ? <Text style={[ui.body, { marginTop: 4 }]}>{r.notes}</Text> : null}
      {r.assigned_user_names?.length ? <Text style={[ui.body, { marginTop: 4 }]}>Sent: {r.assigned_user_names.join(', ')}</Text> : null}
      {r.status === 'pending' && canApprove ? (
        <Row style={{ marginTop: 10 }}>
          <Button title={r.kind === 'request' ? 'Pick crew & approve' : 'Approve release'} kind="success" small onPress={() => (r.kind === 'request' ? setPicking(true) : approve())} loading={saving && r.kind === 'release'} />
          <Button title="Reject" kind="danger" small onPress={reject} />
        </Row>
      ) : null}

      <Sheet visible={picking} title={`${what} — ${r.site_name}`} onClose={() => setPicking(false)} onSubmit={approve} submitLabel={`Send ${picked.length || ''}`.trim()} submitKind="success" loading={saving}>
        <CrewPicker specialty={r.specialty} startDate={r.start_date} endDate={r.end_date} selected={picked} onChange={setPicked} max={r.count} />
        <Field label="Note to foreman (optional)" value={notes} onChangeText={setNotes} />
      </Sheet>
    </Card>
  );
}
