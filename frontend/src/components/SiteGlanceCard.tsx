// One job site "at a glance": crew on site, progress, hours vs budget and (office) money flags.
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SiteCard } from '../types/features';
import { COLORS } from '../constants/colors';
import { jobTypeLabel } from '../constants/roles';
import { Card, Pill, ProgressBar, Row, hrs, money, pct, ui } from './ui';

function Flag({ icon, text, color }: { icon: any; text: string; color: string }) {
  return (
    <Row style={{ marginTop: 4 }}>
      <MaterialIcons name={icon} size={15} color={color} />
      <Text style={{ fontSize: 13, color }}>{text}</Text>
    </Row>
  );
}

export default function SiteGlanceCard({ site: s, onPress }: { site: SiteCard; onPress?: () => void }) {
  const f = s.financials;
  const pending = (s.pending_material_requests || 0) + (s.pending_manpower_requests || 0);
  return (
    <Card onPress={onPress}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={ui.title}>
            {s.project_number ? `${s.project_number} · ` : ''}
            {s.name}
          </Text>
          <Text style={ui.muted}>{[jobTypeLabel(s.job_type), s.general_contractor].filter(Boolean).join(' · ')}</Text>
        </View>
        {s.status !== 'active' ? <Pill label={s.status} /> : null}
      </Row>

      <Row style={{ marginTop: 10, gap: 16 }}>
        <Row style={{ gap: 4 }}>
          <MaterialIcons name="engineering" size={20} color={COLORS.primary} />
          <Text style={[ui.title, { color: COLORS.primary }]}>{s.men_on_site}</Text>
          <Text style={ui.muted}>on site</Text>
        </Row>
        {s.hours_today != null ? <Text style={ui.muted}>{hrs(s.hours_today)} today</Text> : null}
        <Text style={ui.muted}>{s.outstanding_tasks} open tasks</Text>
      </Row>

      <View style={{ marginTop: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={ui.muted}>Progress</Text>
          <Text style={ui.muted}>{pct(s.progress_pct)}</Text>
        </Row>
        <ProgressBar value={s.progress_pct} color={COLORS.primary} />
      </View>

      {s.labour_hours != null && s.budget_hours ? (
        <View style={{ marginTop: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={ui.muted}>Labour hours</Text>
            <Text style={ui.muted}>
              {hrs(s.labour_hours)} / {hrs(s.budget_hours)}
            </Text>
          </Row>
          <ProgressBar
            value={(s.labour_hours / s.budget_hours) * 100}
            color={s.labour_budget_status === 'over' ? COLORS.error : s.labour_budget_status === 'warning' ? COLORS.warning : COLORS.success}
          />
        </View>
      ) : null}

      {f ? (
        <Row style={{ marginTop: 10, flexWrap: 'wrap', gap: 12 }}>
          <Text style={ui.muted}>Billed {pct(f.percent_billed)}</Text>
          <Text style={[ui.muted, f.exposure_alert ? { color: COLORS.error, fontWeight: '700' } : null]}>Materials {pct(f.percent_materials)}</Text>
          <Text style={ui.muted}>Margin {pct(f.margin_to_date)}</Text>
          <Text style={ui.muted}>Owed {money(f.outstanding_receivable)}</Text>
        </Row>
      ) : null}

      {s.status === 'shutdown' ? <Flag icon="block" text={`Shut down: ${s.shutdown_reason || ''}`} color={COLORS.error} /> : null}
      {s.tasks_over_budget ? <Flag icon="timer-off" text={`${s.tasks_over_budget} task(s) over hour budget`} color={COLORS.error} /> : null}
      {s.tasks_near_budget ? <Flag icon="timer" text={`${s.tasks_near_budget} task(s) near budget`} color={COLORS.warning} /> : null}
      {f?.exposure_alert ? <Flag icon="trending-up" text="Materials running ahead of billing" color={COLORS.error} /> : null}
      {s.crew_safety_problems ? <Flag icon="health-and-safety" text={`${s.crew_safety_problems} on site with expired/expiring safety docs`} color={COLORS.error} /> : null}
      {s.open_rfis ? <Flag icon="help-outline" text={`${s.open_rfis} open RFI(s)`} color={COLORS.info} /> : null}
      {pending ? <Flag icon="pending-actions" text={`${pending} request(s) waiting for approval`} color={COLORS.warning} /> : null}
      {s.flagged_clock_records ? <Flag icon="gps-off" text={`${s.flagged_clock_records} flagged clock-in(s)`} color={COLORS.warning} /> : null}
      {!s.has_location ? <Flag icon="location-off" text="No GPS location set" color={COLORS.warning} /> : null}
    </Card>
  );
}
