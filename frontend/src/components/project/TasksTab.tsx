import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { PMTask } from '../../types/features';
import { tasksApi, apiError } from '../../services/pmService';
import { COLORS } from '../../constants/colors';
import {
  Card, SectionTitle, Pill, Sheet, Field, Chips, Button, Empty, Loading, BudgetBar, ProgressBar, Row,
  hrs, money, shortDate, ui,
} from '../ui';

type Props = { siteId: string; canManage: boolean; canBudget: boolean; onChanged: () => void };

export default function TasksTab({ siteId, canManage, canBudget, onChanged }: Props) {
  const [tasks, setTasks] = useState<PMTask[] | null>(null);
  const [scopes, setScopes] = useState<{ value: string; label: string }[]>([]);
  const [filter, setFilter] = useState('all');
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [wfHours, setWfHours] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<PMTask | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  // edit/add form
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [budget, setBudget] = useState('');
  const [progress, setProgress] = useState(0);
  const [due, setDue] = useState('');

  const load = useCallback(async () => {
    try {
      const [t, tpl] = await Promise.all([tasksApi.list({ site_id: siteId }), tasksApi.templates()]);
      setTasks(t);
      setScopes(tpl.scopes);
    } catch (e) {
      Alert.alert('Error', apiError(e));
      setTasks([]);
    }
  }, [siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    if (!tasks) return [];
    if (filter === 'open') return tasks.filter((t) => t.status !== 'complete');
    if (filter === 'budget') return tasks.filter((t) => t.budget_status === 'over' || t.budget_status === 'warning');
    return tasks;
  }, [tasks, filter]);

  const grouped = useMemo(() => {
    const g: Record<string, PMTask[]> = {};
    shown.forEach((t) => {
      const k = t.scope_label || 'Other tasks';
      (g[k] = g[k] || []).push(t);
    });
    return Object.entries(g);
  }, [shown]);

  const applyWorkflow = async () => {
    const chosen = Object.entries(wfHours)
      .filter(([, v]) => v.trim() !== '')
      .map(([k, v]) => ({ scope: k, budget_hours: parseFloat(v) }));
    if (!chosen.length) {
      Alert.alert('Pick a scope', 'Enter budget hours for at least one scope.');
      return;
    }
    if (chosen.some((c) => isNaN(c.budget_hours) || c.budget_hours < 0)) {
      Alert.alert('Check the hours', 'Hours must be numbers.');
      return;
    }
    setSaving(true);
    try {
      const res = await tasksApi.applyWorkflow(siteId, chosen);
      setWorkflowOpen(false);
      setWfHours({});
      Alert.alert('Workflow added', `${res.created} tasks created with their hour budgets.`);
      load();
      onChanged();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (t: PMTask) => {
    setEditing(t);
    setTitle(t.title);
    setScope(t.scope || '');
    setBudget(t.budget_hours != null ? String(t.budget_hours) : '');
    setProgress(t.progress_pct || 0);
    setDue(t.due_date || '');
  };

  const openAdd = () => {
    setAdding(true);
    setTitle('');
    setScope('');
    setBudget('');
    setProgress(0);
    setDue('');
  };

  const save = async () => {
    if (!title.trim()) {
      Alert.alert('Title needed');
      return;
    }
    const data: any = { title: title.trim(), scope: scope || null, due_date: due.trim() || null };
    if (canBudget && budget.trim() !== '') {
      const b = parseFloat(budget);
      if (isNaN(b) || b < 0) {
        Alert.alert('Budget hours must be a number');
        return;
      }
      data.budget_hours = b;
    }
    setSaving(true);
    try {
      if (editing) await tasksApi.update(editing.id, { ...data, progress_pct: progress });
      else await tasksApi.create({ ...data, site_id: siteId });
      setEditing(null);
      setAdding(false);
      load();
      onChanged();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = (t: PMTask) =>
    Alert.alert('Delete task', `Delete "${t.title}"? Hours already logged stay on the timesheets.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await tasksApi.remove(t.id);
            setEditing(null);
            load();
            onChanged();
          } catch (e) {
            Alert.alert('Error', apiError(e));
          }
        },
      },
    ]);

  if (!tasks) return <Loading />;

  return (
    <View style={ui.pad}>
      <Row style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {canBudget ? <Button title="Apply workflow" icon="account-tree" small onPress={() => setWorkflowOpen(true)} /> : null}
        {canManage ? <Button title="Add task" icon="add" kind="ghost" small onPress={openAdd} /> : null}
      </Row>
      <Chips
        options={[
          { value: 'all', label: `All (${tasks.length})` },
          { value: 'open', label: 'Outstanding' },
          { value: 'budget', label: 'Near / over budget' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {grouped.length === 0 ? (
        <Empty icon="checklist" text="No tasks here" sub={canBudget ? 'Use "Apply workflow" to create the standard tasks for each scope.' : undefined} />
      ) : (
        grouped.map(([label, list]) => (
          <View key={label}>
            <SectionTitle title={label} />
            {list.map((t) => (
              <Card key={t.id} onPress={canManage ? () => openEdit(t) : undefined}>
                <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={[ui.title, { flex: 1 }]}>{t.title}</Text>
                  <Pill label={t.status} />
                </Row>
                <BudgetBar actual={t.actual_hours} budget={t.budget_hours} />
                <Row style={{ marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <ProgressBar value={t.progress_pct} color={COLORS.primary} height={6} />
                  </View>
                  <Text style={ui.muted}>{t.progress_pct}% done</Text>
                </Row>
                <Text style={[ui.muted, { marginTop: 6 }]}>
                  {[
                    t.budget_status === 'over' ? 'OVER BUDGET' : t.budget_status === 'warning' ? 'Near budget' : null,
                    t.assigned_to_name ? `Assigned: ${t.assigned_to_name}` : null,
                    t.due_date ? `Due ${shortDate(t.due_date)}` : null,
                    t.labour_cost != null ? `Labour ${money(t.labour_cost)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Card>
            ))}
          </View>
        ))
      )}

      <Sheet visible={workflowOpen} title="Apply a workflow" onClose={() => setWorkflowOpen(false)} onSubmit={applyWorkflow} submitLabel="Create tasks" loading={saving}>
        <Text style={[ui.muted, { marginBottom: 12 }]}>
          Enter the budget hours for each scope on this job. The standard tasks are created and the hours are split between them
          (you can adjust each task afterwards).
        </Text>
        {scopes.map((s) => (
          <Field
            key={s.value}
            label={`${s.label} (hours)`}
            value={wfHours[s.value] || ''}
            onChangeText={(v) => setWfHours((prev) => ({ ...prev, [s.value]: v }))}
            keyboardType="decimal-pad"
            placeholder="Leave blank to skip"
          />
        ))}
      </Sheet>

      <Sheet
        visible={!!editing || adding}
        title={editing ? 'Edit task' : 'Add task'}
        onClose={() => {
          setEditing(null);
          setAdding(false);
        }}
        onSubmit={save}
        loading={saving}
      >
        <Field label="Task" value={title} onChangeText={setTitle} />
        <Text style={ui.fieldLabel}>Scope</Text>
        <Chips options={[{ value: '', label: 'None' }, ...scopes]} value={scope} onChange={setScope} />
        {canBudget ? <Field label="Budget hours" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" /> : null}
        <Field label="Due date (YYYY-MM-DD)" value={due} onChangeText={setDue} placeholder="optional" />
        {editing ? (
          <>
            <Text style={ui.fieldLabel}>Progress</Text>
            <Chips
              options={[0, 25, 50, 75, 100].map((p) => ({ value: String(p), label: `${p}%` }))}
              value={String(progress)}
              onChange={(v: string) => setProgress(parseInt(v, 10))}
            />
            <Text style={ui.muted}>
              {hrs(editing.actual_hours)} logged{editing.labour_cost != null ? ` · ${money(editing.labour_cost)} labour` : ''}
            </Text>
            {canBudget ? <Button title="Delete task" kind="ghost" small icon="delete" onPress={() => remove(editing)} style={{ marginTop: 12, alignSelf: 'flex-start' }} /> : null}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

