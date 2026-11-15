// Pick crew members, best matches first: right trade, free on those dates, safety docs OK.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { AvailablePerson } from '../types/features';
import { manpowerApi } from '../services/pmService';
import { specialtyLabel, levelLabel } from '../constants/roles';
import { COLORS } from '../constants/colors';
import { Check, Loading, Empty, ui } from './ui';

export default function CrewPicker({
  specialty,
  startDate,
  endDate,
  selected,
  onChange,
  max,
}: {
  specialty?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  const [people, setPeople] = useState<AvailablePerson[] | null>(null);

  useEffect(() => {
    let live = true;
    manpowerApi
      .available({ specialty: specialty || undefined, start_date: startDate || undefined, end_date: endDate || undefined })
      .then((p) => live && setPeople(p))
      .catch(() => live && setPeople([]));
    return () => {
      live = false;
    };
  }, [specialty, startDate, endDate]);

  if (!people) return <Loading />;
  if (!people.length) return <Empty icon="group" text="No crew found" sub="Add employees in Team & Sites first." />;

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <View>
      {max ? (
        <Text style={[ui.muted, { marginBottom: 6 }]}>
          {selected.length} of {max} picked
        </Text>
      ) : null}
      {people.map((p) => {
        const notes = [
          levelLabel(p.level),
          p.specialties.map(specialtyLabel).join(', '),
          p.available ? 'available' : `busy: ${p.busy_at.join(', ')}`,
          p.safety_expired ? `⚠ ${p.safety_expired} safety doc(s) expired` : null,
          p.safety_expiring_7 ? `${p.safety_expiring_7} doc(s) expire this week` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <View key={p.id} style={p.safety_expired ? { backgroundColor: '#FDECEC', borderRadius: 8 } : undefined}>
            <Check
              checked={selected.includes(p.id)}
              label={`${p.name}${p.matches_specialty ? '  ★' : ''}`}
              sub={notes}
              onPress={() => toggle(p.id)}
            />
          </View>
        );
      })}
      <Text style={[ui.muted, { marginTop: 6, color: COLORS.textLight }]}>★ = has the requested trade</Text>
    </View>
  );
}
