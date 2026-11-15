import React, { useCallback, useState } from 'react';
import { ScrollView, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ProjectSummary } from '../../../src/types/features';
import { projectsApi, apiError } from '../../../src/services/pmService';
import { useAuthStore } from '../../../src/store/authStore';
import OverviewTab from '../../../src/components/project/OverviewTab';
import TasksTab from '../../../src/components/project/TasksTab';
import MaterialsTab from '../../../src/components/project/MaterialsTab';
import CrewTab from '../../../src/components/project/CrewTab';
import RfisTab from '../../../src/components/project/RfisTab';
import ChangesTab from '../../../src/components/project/ChangesTab';
import DrawsTab from '../../../src/components/project/DrawsTab';
import { Loading, Segments, ui } from '../../../src/components/ui';
import { COLORS } from '../../../src/constants/colors';

// Who can do what (the server checks the same rules).
const can = (role: string | undefined, roles: string[]) => !!role && roles.includes(role);

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const role = user?.role;
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0); // bump to make tabs reload

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setSummary(await projectsApi.summary(String(id)));
      setError('');
    } catch (e) {
      setError(apiError(e));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const changed = () => load();

  if (error && !summary) {
    return (
      <View style={ui.pad}>
        <Text style={ui.body}>{error}</Text>
      </View>
    );
  }
  if (!summary) return <Loading />;

  const isAdminPm = can(role, ['admin', 'project_manager']);
  const isBiller = can(role, ['admin', 'project_manager', 'project_coordinator']);
  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'tasks', label: 'Tasks', badge: summary.tasks.over_budget.length || undefined },
    { value: 'materials', label: 'Materials', badge: summary.pending_material_requests || undefined },
    { value: 'crew', label: 'Crew', badge: summary.pending_manpower_requests || undefined },
    { value: 'rfis', label: 'RFIs', badge: summary.open_rfis || undefined },
    ...(isBiller ? [{ value: 'changes', label: 'Change Orders' }, { value: 'draws', label: 'Draws' }] : []),
  ];

  return (
    <SafeAreaView style={ui.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: summary.name }} />
      <Segments options={tabs} value={tab} onChange={setTab} />
      <ScrollView
        key={`${tab}-${version}`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              setVersion((v) => v + 1);
              load();
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        {tab === 'overview' ? <OverviewTab summary={summary} canEditBudgets={isBiller} reload={load} /> : null}
        {tab === 'tasks' ? <TasksTab siteId={summary.id} canManage canBudget={isAdminPm} onChanged={changed} /> : null}
        {tab === 'materials' ? <MaterialsTab siteId={summary.id} canApprove={isAdminPm} canRelease={isBiller} onChanged={changed} /> : null}
        {tab === 'crew' ? <CrewTab siteId={summary.id} canApprove={isAdminPm} onChanged={changed} /> : null}
        {tab === 'rfis' ? <RfisTab siteId={summary.id} canRespond={isBiller} canCreate /> : null}
        {tab === 'changes' ? <ChangesTab siteId={summary.id} canEdit={isBiller} onChanged={changed} /> : null}
        {tab === 'draws' ? <DrawsTab siteId={summary.id} canBill={isBiller} onChanged={changed} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
