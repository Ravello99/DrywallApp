import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { RFI } from '../../types/features';
import { rfiApi, apiError } from '../../services/pmService';
import { COLORS } from '../../constants/colors';
import { Card, SectionTitle, Pill, Sheet, Field, Chips, Empty, Loading, Row, Button, Check, shortDate, ui } from '../ui';

/** RFI list for one site (siteId) or all of the user's sites. Office can answer; foremen can raise. */
export default function RfisTab({ siteId, sites, canRespond, canCreate }: { siteId?: string; sites?: { id: string; name: string }[]; canRespond: boolean; canCreate: boolean }) {
  const [rfis, setRfis] = useState<RFI[] | null>(null);
  const [filter, setFilter] = useState('open');
  const [viewing, setViewing] = useState<(RFI & { photo?: string | null }) | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  // respond
  const [response, setResponse] = useState('');
  const [closeIt, setCloseIt] = useState(true);
  const [gcRef, setGcRef] = useState('');
  // create
  const [newSite, setNewSite] = useState(siteId || '');
  const [subject, setSubject] = useState('');
  const [question, setQuestion] = useState('');
  const [drawingRef, setDrawingRef] = useState('');
  const [location, setLocation] = useState('');
  const [priority, setPriority] = useState('normal');
  const [neededBy, setNeededBy] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRfis(await rfiApi.list(siteId ? { site_id: siteId } : {}));
    } catch (e) {
      Alert.alert('Error', apiError(e));
      setRfis([]);
    }
  }, [siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (r: RFI) => {
    setResponse(r.response || '');
    setGcRef(r.gc_reference || '');
    setCloseIt(true);
    try {
      setViewing(await rfiApi.get(r.id));
    } catch {
      setViewing(r);
    }
  };

  const respond = async () => {
    if (!viewing || !response.trim()) {
      Alert.alert('Write the answer first');
      return;
    }
    setSaving(true);
    try {
      await rfiApi.respond(viewing.id, { response: response.trim(), close: closeIt, gc_reference: gcRef || undefined });
      setViewing(null);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const markSent = async () => {
    if (!viewing) return;
    try {
      await rfiApi.forward(viewing.id, { gc_reference: gcRef || null });
      setViewing(null);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    }
  };

  const closeRfi = async () => {
    if (!viewing) return;
    try {
      await rfiApi.close(viewing.id);
      setViewing(null);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    }
  };

  const pickPhoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: ['images'] });
      if (!res.canceled && res.assets?.[0]?.base64) setPhoto(`data:image/jpeg;base64,${res.assets[0].base64}`);
    } catch {
      Alert.alert('Photo', 'Could not open your photos.');
    }
  };

  const create = async () => {
    if (!newSite) {
      Alert.alert('Pick a site');
      return;
    }
    if (subject.trim().length < 3 || question.trim().length < 3) {
      Alert.alert('Add a subject and the question');
      return;
    }
    setSaving(true);
    try {
      await rfiApi.create({
        site_id: newSite,
        subject: subject.trim(),
        question: question.trim(),
        drawing_ref: drawingRef || null,
        location: location || null,
        priority,
        needed_by: neededBy || null,
        photo,
      });
      setCreating(false);
      setSubject('');
      setQuestion('');
      setDrawingRef('');
      setLocation('');
      setNeededBy('');
      setPhoto(null);
      setPriority('normal');
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!rfis) return <Loading />;
  const shown = rfis.filter((r) => (filter === 'open' ? r.status !== 'closed' : filter === 'closed' ? r.status === 'closed' : true));

  return (
    <View style={ui.pad}>
      <SectionTitle title="RFIs" action={canCreate ? 'New RFI' : undefined} onAction={() => setCreating(true)} />
      <Chips
        options={[
          { value: 'open', label: `Open (${rfis.filter((r) => r.status !== 'closed').length})` },
          { value: 'closed', label: 'Closed' },
          { value: 'all', label: 'All' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {shown.length === 0 ? (
        <Empty icon="help-outline" text="No RFIs here" />
      ) : (
        shown.map((r) => (
          <Card key={r.id} onPress={() => open(r)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={[ui.title, { flex: 1 }]}>
                #{r.number} {r.subject}
              </Text>
              <Pill label={r.status} />
            </Row>
            <Text style={ui.muted} numberOfLines={2}>
              {r.question}
            </Text>
            <Text style={[ui.muted, { marginTop: 4 }]}>
              {[siteId ? null : r.site_name, r.submitted_by_name, shortDate(r.created_at), r.sent_to_gc ? 'sent to GC' : null, r.priority === 'urgent' ? 'URGENT' : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {r.overdue ? <Text style={{ color: COLORS.error, fontSize: 12, marginTop: 4 }}>Answer overdue (needed {shortDate(r.needed_by)})</Text> : null}
          </Card>
        ))
      )}

      <Sheet
        visible={!!viewing}
        title={viewing ? `RFI #${viewing.number}: ${viewing.subject}` : ''}
        onClose={() => setViewing(null)}
        onSubmit={canRespond && viewing && viewing.status !== 'closed' ? respond : undefined}
        submitLabel="Send answer"
        loading={saving}
      >
        {viewing ? (
          <>
            <Text style={ui.muted}>
              {viewing.site_name} · {viewing.submitted_by_name} · {shortDate(viewing.created_at)}
            </Text>
            <Text style={[ui.body, { marginVertical: 10 }]}>{viewing.question}</Text>
            {viewing.drawing_ref || viewing.location ? (
              <Text style={ui.muted}>{[viewing.drawing_ref ? `Drawing: ${viewing.drawing_ref}` : null, viewing.location ? `Location: ${viewing.location}` : null].filter(Boolean).join(' · ')}</Text>
            ) : null}
            {viewing.photo ? <Image source={{ uri: viewing.photo }} style={{ width: '100%', height: 220, borderRadius: 8, marginTop: 10 }} resizeMode="contain" /> : null}
            {viewing.response ? (
              <View style={[ui.infoBox, { marginTop: 12 }]}>
                <Text style={[ui.body, { fontWeight: '700' }]}>Answer from {viewing.responded_by_name}</Text>
                <Text style={ui.body}>{viewing.response}</Text>
              </View>
            ) : null}
            {canRespond && viewing.status !== 'closed' ? (
              <>
                <View style={ui.divider} />
                <Field label="Answer" value={response} onChangeText={setResponse} multiline />
                <Field label="GC / consultant reference (optional)" value={gcRef} onChangeText={setGcRef} />
                <Check checked={closeIt} label="Close the RFI with this answer" onPress={() => setCloseIt(!closeIt)} />
                {!viewing.sent_to_gc ? <Button title="Mark as sent to GC (answer later)" kind="ghost" small onPress={markSent} style={{ marginTop: 8, alignSelf: 'flex-start' }} /> : null}
              </>
            ) : null}
            {!canRespond && viewing.status === 'answered' ? <Button title="Close RFI" small onPress={closeRfi} style={{ marginTop: 12, alignSelf: 'flex-start' }} /> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet visible={creating} title="New RFI" onClose={() => setCreating(false)} onSubmit={create} submitLabel="Submit RFI" loading={saving}>
        {!siteId && sites ? (
          <>
            <Text style={ui.fieldLabel}>Site</Text>
            <Chips options={sites.map((s) => ({ value: s.id, label: s.name }))} value={newSite} onChange={setNewSite} />
          </>
        ) : null}
        <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Bulkhead height at corridor C" />
        <Field label="Question" value={question} onChangeText={setQuestion} multiline placeholder="What's unclear and what you need to know" />
        <Field label="Drawing / detail" value={drawingRef} onChangeText={setDrawingRef} placeholder="e.g. A-301, detail 4" />
        <Field label="Location on site" value={location} onChangeText={setLocation} placeholder="e.g. Level 3, unit 304" />
        <Text style={ui.fieldLabel}>Priority</Text>
        <Chips options={[{ value: 'urgent', label: 'Urgent' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }]} value={priority} onChange={setPriority} />
        <Field label="Answer needed by (YYYY-MM-DD)" value={neededBy} onChangeText={setNeededBy} placeholder="optional" />
        <Button title={photo ? 'Photo attached ✓ (change)' : 'Attach a photo'} kind="ghost" small icon="photo-camera" onPress={pickPhoto} style={{ alignSelf: 'flex-start' }} />
      </Sheet>
    </View>
  );
}
