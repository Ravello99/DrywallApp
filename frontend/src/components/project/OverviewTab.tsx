import React, { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ProjectSummary } from '../../types/features';
import { projectsApi, apiError } from '../../services/pmService';
import { COLORS } from '../../constants/colors';
import { Card, SectionTitle, Stat, StatRow, ProgressBar, BudgetBar, Sheet, Field, Empty, money, pct, hrs, timeOf, ui, Row } from '../ui';
import { specialtyLabel } from '../../constants/roles';

export default function OverviewTab({ summary, canEditBudgets, reload }: { summary: ProjectSummary; canEditBudgets: boolean; reload: () => void }) {
  const f = summary.financials;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contract, setContract] = useState('');
  const [materialBudget, setMaterialBudget] = useState('');
  const [labourBudget, setLabourBudget] = useState('');

  const openEdit = () => {
    setContract(summary.site?.contract_value != null ? String(summary.site.contract_value) : '');
    setMaterialBudget(summary.site?.material_budget != null ? String(summary.site.material_budget) : '');
    setLabourBudget(summary.site?.labour_budget != null ? String(summary.site.labour_budget) : '');
    setEditing(true);
  };

  const save = async () => {
    const num = (s: string) => (s.trim() === '' ? undefined : parseFloat(s.replace(/[$,]/g, '')));
    const data: any = { contract_value: num(contract), material_budget: num(materialBudget), labour_budget: num(labourBudget) };
    if (Object.values(data).some((v) => v !== undefined && (isNaN(v as number) || (v as number) < 0))) {
      Alert.alert('Check the amounts', 'Use numbers only, e.g. 485000');
      return;
    }
    setSaving(true);
    try {
      await projectsApi.updateSite(summary.id, data);
      setEditing(false);
      reload();
    } catch (e) {
      Alert.alert('Error', apiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={ui.pad}>
      {summary.status === 'shutdown' ? (
        <View style={ui.dangerBox}>
          <Text style={[ui.body, { fontWeight: '700', color: COLORS.error }]}>Site shut down</Text>
          <Text style={ui.body}>{summary.shutdown_reason}</Text>
        </View>
      ) : null}
      {!summary.has_location ? (
        <View style={ui.warnBox}>
          <Text style={ui.body}>This site has no GPS location, so clock-ins can't be checked. Set it in Team & Sites.</Text>
        </View>
      ) : null}

      <StatRow>
        <Stat label="Men on site now" value={String(summary.men_on_site)} />
        <Stat label="Progress" value={pct(summary.tasks.progress_pct)} />
      </StatRow>

      {f ? (
        <>
          {f.exposure_alert ? (
            <View style={ui.dangerBox}>
              <Text style={[ui.body, { fontWeight: '700' }]}>Materials are ahead of billing</Text>
              <Text style={ui.body}>
                {pct(f.percent_materials)} of the material budget released vs {pct(f.percent_billed)} of the contract billed.
                Bill a progress draw or hold back material releases.
              </Text>
            </View>
          ) : null}
          <SectionTitle title="Money" action={canEditBudgets ? 'Budgets' : undefined} onAction={openEdit} />
          <StatRow>
            <Stat label="Revised contract" value={money(f.revised_contract)} sub={f.approved_changes ? `incl. ${money(f.approved_changes)} in change orders` : undefined} />
            <Stat label="Billed" value={pct(f.percent_billed)} sub={money(f.billed_gross)} />
            <Stat label="Materials released" value={pct(f.percent_materials)} sub={`${money(f.material_released)} of ${money(f.material_budget)}`} color={f.exposure_alert ? COLORS.error : undefined} />
            <Stat label="Costs to date" value={money(f.costs_to_date)} sub={`Labour ${money(f.labour_cost)} · ${hrs(f.labour_hours)}`} />
            <Stat label="Margin to date" value={pct(f.margin_to_date)} color={(f.margin_to_date ?? 0) < 0 ? COLORS.error : COLORS.success} />
            <Stat label="Projected margin" value={pct(f.projected_margin)} sub={f.projected_profit != null ? money(f.projected_profit) : 'set budgets'} />
            <Stat label="Owed to us" value={money(f.outstanding_receivable)} sub={`Holdback held ${money(f.holdback_held)}`} />
            <Stat label="Cash exposure" value={money(f.cash_exposure)} sub="costs not yet paid back" color={f.cash_exposure > 0 ? COLORS.warning : undefined} />
          </StatRow>
          <Card>
            <Text style={ui.muted}>Billed vs materials released</Text>
            <Text style={[ui.muted, { marginTop: 8 }]}>Billed {pct(f.percent_billed)}</Text>
            <ProgressBar value={f.percent_billed} color={COLORS.primary} />
            <Text style={[ui.muted, { marginTop: 8 }]}>Materials {pct(f.percent_materials)}</Text>
            <ProgressBar value={f.percent_materials} color={f.exposure_alert ? COLORS.error : COLORS.accent} />
          </Card>
        </>
      ) : null}

      <SectionTitle title="Labour hours by scope" />
      {summary.tasks.scopes.length === 0 ? (
        <Empty icon="playlist-add" text="No tasks yet" sub="Apply a workflow on the Tasks tab to set hour budgets." />
      ) : (
        summary.tasks.scopes.map((s) => (
          <Card key={s.scope}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={ui.title}>{s.label}</Text>
              <Text style={ui.muted}>
                {s.complete}/{s.tasks} done
              </Text>
            </Row>
            <BudgetBar actual={s.actual_hours} budget={s.budget_hours} />
          </Card>
        ))
      )}

      <SectionTitle title={`On site now (${summary.crew.length})`} />
      {summary.crew.length === 0 ? (
        <Empty icon="person-off" text="Nobody clocked in" />
      ) : (
        summary.crew.map((c) => (
          <Card key={c.user_id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={ui.title}>{c.name}</Text>
              <Text style={ui.muted}>since {timeOf(c.clock_in)}</Text>
            </Row>
            <Text style={ui.muted}>
              {[...c.specialties.map(specialtyLabel), c.task_title ? `on: ${c.task_title}` : null].filter(Boolean).join(' · ')}
            </Text>
            {c.safety_expired || c.safety_expiring_7 ? (
              <Row style={{ marginTop: 6 }}>
                <MaterialIcons name="warning" size={16} color={COLORS.error} />
                <Text style={{ color: COLORS.error, fontSize: 13 }}>
                  {c.safety_expired ? `${c.safety_expired} safety doc(s) EXPIRED` : `${c.safety_expiring_7} safety doc(s) expire this week`}
                </Text>
              </Row>
            ) : null}
          </Card>
        ))
      )}

      <Sheet visible={editing} title="Contract & budgets" onClose={() => setEditing(false)} onSubmit={save} loading={saving}>
        <Field label="Contract value ($)" value={contract} onChangeText={setContract} keyboardType="decimal-pad" placeholder="e.g. 485000" />
        <Field label="Material budget ($)" value={materialBudget} onChangeText={setMaterialBudget} keyboardType="decimal-pad" placeholder="Used for the materials-vs-billing check" />
        <Field label="Labour budget ($)" value={labourBudget} onChangeText={setLabourBudget} keyboardType="decimal-pad" placeholder="Used for projected margin" />
        <Text style={ui.muted}>Approved change orders are added to the contract automatically.</Text>
      </Sheet>
    </View>
  );
}

