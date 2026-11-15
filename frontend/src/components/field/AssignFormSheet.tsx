// Foreman: send one of the PM's forms (toolbox talk, FLHA, inspection...) to crew on their sites.
import React, { useEffect, useState } from 'react';
import { Text, Alert } from 'react-native';
import { formService } from '../../services/formService';
import { manpowerApi, apiError } from '../../services/pmService';
import { Sheet, Chips, Check, Field, Empty, Loading, ui } from '../ui';

export default function AssignFormSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [forms, setForms] = useState<any[] | null>(null);
  const [crew, setCrew] = useState<{ id: string; name: string; sites: string[] }[]>([]);
  const [formId, setFormId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPicked([]);
    setDue('');
    Promise.all([formService.getFormTemplates(), manpowerApi.assignments({ current_only: true })])
      .then(([f, a]) => {
        setForms(f);
        if (f.length) setFormId(f[0].id);
        const byUser: Record<string, { id: string; name: string; sites: string[] }> = {};
        a.forEach((x: any) => {
          byUser[x.user_id] = byUser[x.user_id] || { id: x.user_id, name: x.user_name, sites: [] };
          if (!byUser[x.user_id].sites.includes(x.site_name)) byUser[x.user_id].sites.push(x.site_name);
        });
        setCrew(Object.values(byUser).sort((p, q) => p.name.localeCompare(q.name)));
      })
      .catch((e) => {
        Alert.alert('Error', apiError(e));
        setForms([]);
      });
  }, [visible]);

  const send = async () => {
    if (!formId) return Alert.alert('Pick a form');
    if (!picked.length) return Alert.alert('Pick who should fill it out');
    setSaving(true);
    try {
      await formService.assignForm({ form_id: formId, assigned_to: picked, due_date: due || undefined });
      Alert.alert('Sent', `Form sent to ${picked.length} crew member(s).`);
      onClose();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} title="Send a form to crew" onClose={onClose} onSubmit={send} submitLabel={`Send${picked.length ? ` to ${picked.length}` : ''}`} loading={saving}>
      {!forms ? (
        <Loading />
      ) : forms.length === 0 ? (
        <Empty icon="description" text="No forms yet" sub="Your PM creates forms in the office app." />
      ) : (
        <>
          <Text style={ui.fieldLabel}>Form</Text>
          <Chips options={forms.map((f) => ({ value: f.id, label: f.title }))} value={formId} onChange={setFormId} />
          <Text style={ui.fieldLabel}>Crew</Text>
          <Check checked={picked.length === crew.length && crew.length > 0} label="Everyone on my sites" onPress={() => setPicked(picked.length === crew.length ? [] : crew.map((c) => c.id))} />
          {crew.map((c) => (
            <Check key={c.id} checked={picked.includes(c.id)} label={c.name} sub={c.sites.join(', ')} onPress={() => setPicked(picked.includes(c.id) ? picked.filter((x) => x !== c.id) : [...picked, c.id])} />
          ))}
          {crew.length === 0 ? <Text style={ui.muted}>No crew assigned to your sites right now.</Text> : null}
          <Field label="Due date (YYYY-MM-DD)" value={due} onChangeText={setDue} placeholder="optional" />
        </>
      )}
    </Sheet>
  );
}
