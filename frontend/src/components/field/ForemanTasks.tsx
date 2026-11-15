// Foreman view of tasks: every task on their sites, update progress, add tasks for the crew.
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, RefreshControl, View, Text, Alert } from 'react-native';
import { PMTask } from '../../types/features';
import { Site } from '../../types';
import { tasksApi, apiError } from '../../services/pmService';
import { siteService } from '../../services/siteService';
import { COLORS } from '../../constants/colors';
import { Card, Chips, Pill, Row, Sheet, Field, Button, Empty, Loading, ProgressBar, BudgetBar, SectionTitle, shortDate, ui } from '../ui';

export default function ForemanTasks() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [tasks, setTasks] = useState<PMTask[] | null>(null);
  const [filter, setFilter] = useState('open');
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<PMTask | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    siteService
      .getSites()
      .then((s: Site[]) => {
        setSites(s);
        if (s.length) setSiteId(s[0].id);
        else setTasks([]);
      })
      .catch(() => setTasks([]));
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      setTasks(await tasksApi.list({ site_id: siteId }));
    } catch (e) {
      Alert.alert('Error', apiError(e));
      setTasks([]);
    } finally {
      setRefreshing(false);
    }
  }, [siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const setProgress = async (t: PMTask, p: number) => {
    try {
      await tasksApi.update(t.id, { progress_pct: p });
      setEditing(null);
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    }
  };

  const add = async () => {
    if (!title.trim()) return Alert.alert('What is the task?');
    setSaving(true);
    try {
      await tasksApi.create({ title: title.trim(), site_id: siteId, due_date: due || null, task_type: 'installation' });
      setAdding(false);
      setTitle('');
      setDue('');
      load();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!tasks) return <Loading />;
  const shown = tasks.filter((t) => (filter === 'open' ? t.status !== 'complete' : filter === 'done' ? t.status === 'complete' : true));
  const groups: Record<string, PMTask[]> = {};
  shown.forEach((t) => ((groups[t.scope_label || 'Other tasks'] = groups[t.scope_label || 'Other tasks'] || []).push(t)));

  return (
    <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      {sites.length > 1 ? <Chips options={sites.map((s) => ({ value: s.id, label: s.name }))} value={siteId} onChange={setSiteId} /> : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Chips
          options={[
            { value: 'open', label: 'Outstanding' },
            { value: 'done', label: 'Done' },
            { value: 'all', label: 'All' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </Row>
      {siteId ? <Button title="Add task" icon="add" small kind="ghost" onPress={() => setAdding(true)} style={{ alignSelf: 'flex-start', marginBottom: 10 }} /> : null}
      {shown.length === 0 ? <Empty icon="checklist" text="No tasks here" /> : null}
      {Object.entries(groups).map(([label, list]) => (
        <View key={label}>
          <SectionTitle title={label} />
          {list.map((t) => (
            <Card key={t.id} onPress={() => setEditing(t)}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[ui.title, { flex: 1 }]}>{t.title}</Text>
                <Pill label={t.status} />
              </Row>
              <Row style={{ marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <ProgressBar value={t.progress_pct} color={COLORS.primary} />
                </View>
                <Text style={ui.muted}>{t.progress_pct}%</Text>
              </Row>
              {t.budget_hours ? (
                <View style={{ marginTop: 8 }}>
                  <BudgetBar actual={t.actual_hours} budget={t.budget_hours} />
                </View>
              ) : null}
              <Text style={[ui.muted, { marginTop: 4 }]}>
                {[t.assigned_to_name, t.due_date ? `due ${shortDate(t.due_date)}` : null].filter(Boolean).join(' · ')}
              </Text>
            </Card>
          ))}
        </View>
      ))}

      <Sheet visible={!!editing} title={editing?.title || ''} onClose={() => setEditing(null)}>
        <Text style={[ui.fieldLabel, { marginBottom: 10 }]}>How far along is it?</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {[0, 25, 50, 75, 100].map((p) => (
            <Button key={p} title={p === 100 ? 'Done ✓' : `${p}%`} kind={editing?.progress_pct === p ? 'primary' : 'ghost'} small onPress={() => editing && setProgress(editing, p)} />
          ))}
        </Row>
        {editing?.budget_status === 'over' ? <Text style={{ color: COLORS.error, marginTop: 12 }}>This task is over its hour budget. Let your PM know if more hours are needed.</Text> : null}
      </Sheet>

      <Sheet visible={adding} title="Add a task" onClose={() => setAdding(false)} onSubmit={add} loading={saving}>
        <Field label="Task" value={title} onChangeText={setTitle} placeholder="e.g. Deficiencies unit 304" />
        <Field label="Due date (YYYY-MM-DD)" value={due} onChangeText={setDue} placeholder="optional" />
        <Text style={ui.muted}>Hour budgets are set by the office.</Text>
      </Sheet>
    </ScrollView>
  );
}
