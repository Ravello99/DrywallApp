import React, { useCallback, useState } from 'react';
import { ScrollView, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { SiteCard } from '../../src/types/features';
import { projectsApi, apiError } from '../../src/services/pmService';
import SiteGlanceCard from '../../src/components/SiteGlanceCard';
import Footer from '../../src/components/Footer';
import { Chips, Empty, Loading, ui } from '../../src/components/ui';

export default function ProjectsScreen() {
  const router = useRouter();
  const [sites, setSites] = useState<SiteCard[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSites(await projectsApi.overview(filter === 'completed'));
      setError('');
    } catch (e) {
      setError(apiError(e));
      setSites([]);
    } finally {
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!sites) return <Loading />;
  const shown = sites.filter((s) => {
    if (filter === 'attention')
      return s.status === 'shutdown' || s.tasks_over_budget > 0 || s.financials?.exposure_alert || s.crew_safety_problems > 0 || (s.pending_material_requests || 0) + (s.pending_manpower_requests || 0) > 0;
    if (filter === 'completed') return s.status === 'completed';
    return s.status !== 'completed';
  });

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={ui.pad} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <Chips
          options={[
            { value: 'all', label: 'Active' },
            { value: 'attention', label: 'Needs attention' },
            { value: 'completed', label: 'Completed' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {error ? <Text style={[ui.body, { marginBottom: 8 }]}>{error}</Text> : null}
        {shown.length === 0 ? (
          <Empty icon="apartment" text="No projects here" sub="Add sites in Team & Sites, or turn a won bid into a project." />
        ) : (
          shown.map((s) => <SiteGlanceCard key={s.id} site={s} onPress={() => router.push(`/manager/project/${s.id}` as any)} />)
        )}
        <View style={{ height: 8 }} />
        <Footer />
      </ScrollView>
    </SafeAreaView>
  );
}
