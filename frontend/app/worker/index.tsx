import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { clockService } from '../../src/services/clockService';
import { safetyService } from '../../src/services/safetyService';
import { taskService } from '../../src/services/taskService';
import { formService } from '../../src/services/formService';
import syncService from '../../src/services/syncService';
import { format } from 'date-fns';
import { roleLabel } from '../../src/constants/roles';
import FieldOverview from '../../src/components/field/FieldOverview';
import { COLORS } from '../../src/constants/colors';
import NetInfo from '@react-native-community/netinfo';
import { useRouter } from 'expo-router';
import Footer from '../../src/components/Footer';
import { UserRole } from '../../src/types';

const getRoleLabel = (role: UserRole): string => roleLabel(role);

export default function WorkerDashboard() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeRecord, setActiveRecord] = useState<any>(null);
  const [recentRecords, setRecentRecords] = useState<any[]>([]);
  const [expiringDocs, setExpiringDocs] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [taskCount, setTaskCount] = useState(0);
  const [formCount, setFormCount] = useState(0);

  useEffect(() => {
    loadData();
    checkNetworkStatus();
    
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected || false);
      if (state.isConnected && state.type === 'wifi') {
        autoSync();
      }
    });

    return () => unsubscribe();
  }, []);

  const checkNetworkStatus = async () => {
    const connection = await syncService.checkConnection();
    setIsOnline(connection.isConnected);
  };

  const loadData = async () => {
    try {
      const [activeRes, recordsRes, expiringRes, pending, tasksRes, formsRes] = await Promise.all([
        clockService.getActiveRecord(),
        clockService.getMyRecords(),
        safetyService.getMyDocuments(),
        syncService.getPendingCount(),
        taskService.getMyTasks().catch(() => []),
        formService.getMyAssignments().catch(() => []),
      ]);
      
      setActiveRecord(activeRes.status === 'clocked_in' ? activeRes.record : null);
      setRecentRecords(recordsRes.slice(0, 5));
      
      const expiring = expiringRes.filter(
        (doc: any) => doc.is_expiring_soon || doc.is_expiring_critical
      );
      setExpiringDocs(expiring);
      setPendingCount(pending);
      setTaskCount(tasksRes.filter((t: any) => t.status !== 'complete').length);
      setFormCount(formsRes.length);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const autoSync = async () => {
    const pending = await syncService.getPendingCount();
    if (pending > 0) {
      setIsSyncing(true);
      const result = await syncService.autoSync();
      setIsSyncing(false);
      
      if (result.success) {
        setPendingCount(0);
        loadData();
      }
    }
  };

  const handleManualSync = async () => {
    if (pendingCount === 0) {
      Alert.alert('Info', 'Nothing to sync');
      return;
    }

    setIsSyncing(true);
    const result = await syncService.syncPendingData(false);
    setIsSyncing(false);

    if (result.requiresConfirmation) {
      const shouldSync = await syncService.promptCellularSync();
      if (shouldSync) {
        setIsSyncing(true);
        const cellularResult = await syncService.syncPendingData(true);
        setIsSyncing(false);
        
        if (cellularResult.success) {
          Alert.alert('Success', cellularResult.message);
          setPendingCount(0);
          loadData();
        } else {
          Alert.alert('Sync Failed', cellularResult.message);
        }
      }
    } else if (result.success) {
      Alert.alert('Success', result.message);
      setPendingCount(0);
      loadData();
    } else {
      Alert.alert('Sync Failed', result.message);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Welcome Section */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.userName}>{user?.name}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{getRoleLabel(user?.role as UserRole)}</Text>
            </View>
          </View>
          
          {/* Sync Status */}
          <View style={styles.syncContainer}>
            {!isOnline && (
              <View style={styles.offlineBadge}>
                <MaterialIcons name="cloud-off" size={16} color={COLORS.white} />
                <Text style={styles.offlineText}>Offline</Text>
              </View>
            )}
            {pendingCount > 0 && (
              <TouchableOpacity
                style={styles.syncButton}
                onPress={handleManualSync}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <MaterialIcons name="sync" size={16} color={COLORS.white} />
                    <Text style={styles.syncButtonText}>{pendingCount}</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Hours, today's site, safety docs and (foremen) my sites at a glance */}
        <FieldOverview />

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/worker/tasks')}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: '#E7ECF5' }]}>
              <MaterialIcons name="assignment" size={28} color={COLORS.info} />
            </View>
            <Text style={styles.actionTitle}>Tasks</Text>
            {taskCount > 0 && (
              <View style={styles.actionBadge}>
                <Text style={styles.actionBadgeText}>{taskCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/worker/forms')}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: '#F6F0DC' }]}>
              <MaterialIcons name="description" size={28} color={COLORS.primary} />
            </View>
            <Text style={styles.actionTitle}>Forms</Text>
            {formCount > 0 && (
              <View style={styles.actionBadge}>
                <Text style={styles.actionBadgeText}>{formCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Expiring Documents Alert */}
        {expiringDocs.length > 0 && (
          <View style={styles.alertSection}>
            <View style={styles.alertCard}>
              <View style={styles.alertHeader}>
                <MaterialIcons name="warning" size={24} color={COLORS.warning} />
                <Text style={styles.alertTitle}>Safety Documents Expiring</Text>
              </View>
              <Text style={styles.alertText}>
                {expiringDocs.length} document(s) expiring soon. Please renew them.
              </Text>
              {expiringDocs.slice(0, 3).map((doc) => (
                <View key={doc.id} style={styles.expiringDocItem}>
                  <Text style={styles.expiringDocName}>{doc.file_name}</Text>
                  <Text
                    style={[
                      styles.expiringDocDays,
                      doc.is_expiring_critical && styles.expiringCritical,
                    ]}
                  >
                    {doc.days_until_expiry} days left
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Active Clock Status */}
        {activeRecord ? (
          <View style={[styles.card, styles.activeCard]}>
            <View style={styles.cardHeader}>
              <MaterialIcons name="work" size={24} color={COLORS.success} />
              <Text style={styles.activeTitle}>Currently Clocked In</Text>
            </View>
            <View style={styles.activeDetails}>
              <Text style={styles.activeLabel}>Site:</Text>
              <Text style={styles.activeValue}>{activeRecord.site_name}</Text>
            </View>
            <View style={styles.activeDetails}>
              <Text style={styles.activeLabel}>Clock In:</Text>
              <Text style={styles.activeValue}>
                {format(new Date(activeRecord.clock_in), 'MMM dd, yyyy h:mm a')}
              </Text>
            </View>
            {!activeRecord.synced && (
              <View style={styles.unsyncedBadge}>
                <MaterialIcons name="cloud-upload" size={16} color={COLORS.warning} />
                <Text style={styles.unsyncedText}>Pending sync</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.card, styles.inactiveCard]}>
            <MaterialIcons name="access-time" size={24} color={COLORS.gray400} />
            <Text style={styles.inactiveText}>Not clocked in</Text>
            <Text style={styles.inactiveSubtext}>Use Clock In/Out tab to start your shift</Text>
          </View>
        )}

        {/* Recent Activity */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {recentRecords.length > 0 ? (
            recentRecords.map((record) => (
              <View key={record.id} style={styles.recordCard}>
                <View style={styles.recordHeader}>
                  <Text style={styles.recordSite}>{record.site_name}</Text>
                  <View style={styles.recordBadges}>
                    {!record.synced && (
                      <MaterialIcons name="cloud-upload" size={16} color={COLORS.warning} />
                    )}
                    <Text
                      style={[
                        styles.recordStatus,
                        record.status === 'clocked_in' ? styles.statusActive : styles.statusComplete,
                      ]}
                    >
                      {record.status === 'clocked_in' ? 'Active' : 'Complete'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.recordDate}>
                  {format(new Date(record.clock_in), 'MMM dd, yyyy')}
                </Text>
                <View style={styles.recordTime}>
                  <Text style={styles.recordTimeText}>
                    {format(new Date(record.clock_in), 'h:mm a')}
                  </Text>
                  {record.clock_out && (
                    <>
                      <MaterialIcons name="arrow-forward" size={16} color={COLORS.gray400} />
                      <Text style={styles.recordTimeText}>
                        {format(new Date(record.clock_out), 'h:mm a')}
                      </Text>
                      <Text style={styles.recordHours}>
                        ({record.total_hours?.toFixed(1)} hrs)
                      </Text>
                    </>
                  )}
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <MaterialIcons name="history" size={48} color={COLORS.gray300} />
              <Text style={styles.emptyText}>No recent activity</Text>
            </View>
          )}
        </View>

        <Footer />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 24,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  userName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  syncContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray500,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  offlineText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  syncButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  actionCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    position: 'relative',
  },
  actionIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  actionBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: COLORS.primary,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  alertSection: {
    paddingHorizontal: 16,
  },
  alertCard: {
    backgroundColor: '#FFF8E1',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warning,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginLeft: 8,
  },
  alertText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  expiringDocItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#E3D3A0',
  },
  expiringDocName: {
    fontSize: 13,
    color: COLORS.textPrimary,
    flex: 1,
  },
  expiringDocDays: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.warning,
  },
  expiringCritical: {
    color: COLORS.error,
  },
  card: {
    margin: 16,
    padding: 20,
    backgroundColor: COLORS.white,
    borderRadius: 12,
  },
  activeCard: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  activeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.success,
    marginLeft: 12,
  },
  activeDetails: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  activeLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    width: 80,
  },
  activeValue: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '600',
    flex: 1,
  },
  unsyncedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray200,
    gap: 4,
  },
  unsyncedText: {
    fontSize: 12,
    color: COLORS.warning,
    fontWeight: '600',
  },
  inactiveCard: {
    alignItems: 'center',
  },
  inactiveText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textLight,
    marginTop: 12,
  },
  inactiveSubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
    textAlign: 'center',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  recordCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordSite: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    flex: 1,
  },
  recordBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordStatus: {
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusActive: {
    backgroundColor: '#E8F5E9',
    color: COLORS.success,
  },
  statusComplete: {
    backgroundColor: '#E7ECF5',
    color: COLORS.info,
  },
  recordDate: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  recordTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordTimeText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  recordHours: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: COLORS.white,
    padding: 40,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 12,
  },
});
