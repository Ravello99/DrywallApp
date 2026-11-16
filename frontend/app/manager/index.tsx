import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { reportService } from '../../src/services/reportService';
import { useRouter, useFocusEffect } from 'expo-router';
import { COLORS } from '../../src/constants/colors';
import { authService } from '../../src/services/authService';
import { clearSessionCache } from '../../src/services/session';
import Footer from '../../src/components/Footer';
import SiteGlanceCard from '../../src/components/SiteGlanceCard';
import { projectsApi, notificationsApi, drawApi } from '../../src/services/pmService';
import { SiteCard } from '../../src/types/features';
import { roleLabel, canSeePayRates } from '../../src/constants/roles';
import { money } from '../../src/components/ui';

export default function ManagerDashboard() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<any>({});
  const [sites, setSites] = useState<SiteCard[]>([]);
  const [unread, setUnread] = useState(0);
  const [ar, setAr] = useState<any>(null);
  const seesMoney = canSeePayRates(user?.role);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, []),
  );

  const loadStats = async () => {
    try {
      const [data, overview, notes, receivables] = await Promise.all([
        reportService.getDashboardStats(),
        projectsApi.overview().catch(() => []),
        notificationsApi.list(true).catch(() => ({ unread: 0 })),
        seesMoney ? drawApi.summary().catch(() => null) : Promise.resolve(null),
      ]);
      setStats(data);
      setSites(overview);
      setUnread(notes.unread || 0);
      setAr(receivables);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadStats();
  };

  const handleSignOut = async () => {
    // For web, use window.confirm instead of Alert
    if (Platform.OS === 'web') {
      const confirmed = window.confirm('Are you sure you want to sign out?');
      if (confirmed) {
        try {
          await authService.logout();
          clearSessionCache();
          logout();
          // Force page reload for web to clear all state
          window.location.href = '/';
        } catch (error) {
          console.error('Logout error:', error);
          window.location.href = '/';
        }
      }
    } else {
      Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await authService.logout();
          clearSessionCache();
              logout();
              router.replace('/');
            } catch (error) {
              console.error('Logout error:', error);
              router.replace('/');
            }
          },
        },
      ]);
    }
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
            <Text style={styles.greeting}>{roleLabel(user?.role)} Dashboard</Text>
            <Text style={styles.userName}>{user?.name}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={styles.signOutButton} onPress={() => router.push('/manager/notifications' as any)}>
              <MaterialIcons name={unread ? 'notifications-active' : 'notifications-none'} size={24} color={COLORS.primary} />
              {unread ? (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unread > 99 ? '99+' : unread}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
              <MaterialIcons name="logout" size={24} color={COLORS.error} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { backgroundColor: '#E7ECF5' }]}>
            <MaterialIcons name="people" size={32} color={COLORS.info} />
            <Text style={styles.statValue}>{stats.total_workers || 0}</Text>
            <Text style={styles.statLabel}>Team Members</Text>
          </View>

          <View style={[styles.statCard, { backgroundColor: '#F6F0DC' }]}>
            <MaterialIcons name="supervised-user-circle" size={32} color={COLORS.primary} />
            <Text style={styles.statValue}>{stats.total_managers || 0}</Text>
            <Text style={styles.statLabel}>Managers</Text>
          </View>

          <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
            <MaterialIcons name="location-city" size={32} color={COLORS.success} />
            <Text style={styles.statValue}>{stats.total_sites || 0}</Text>
            <Text style={styles.statLabel}>Active Sites</Text>
          </View>

          <View style={[styles.statCard, { backgroundColor: '#F6F0DC' }]}>
            <MaterialIcons name="access-time" size={32} color="#D98E04" />
            <Text style={styles.statValue}>{stats.clocked_in_workers || 0}</Text>
            <Text style={styles.statLabel}>Clocked In</Text>
          </View>
        </View>

        {/* Expiring Documents Alert */}
        {(stats.expiring_safety_documents > 0 || stats.critical_expiring_safety_documents > 0) && (
          <View style={styles.alertSection}>
            {stats.critical_expiring_safety_documents > 0 && (
              <View style={[styles.alertCard, styles.criticalAlert]}>
                <View style={styles.alertHeader}>
                  <MaterialIcons name="error" size={24} color={COLORS.error} />
                  <View style={styles.alertTextContainer}>
                    <Text style={styles.alertTitle}>Critical - expired or within 7 days</Text>
                    <Text style={styles.alertText}>
                      {stats.critical_expiring_safety_documents} safety document(s) expired or expiring within 7 days
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {stats.expiring_safety_documents > 0 && (
              <View style={[styles.alertCard, styles.warningAlert]}>
                <View style={styles.alertHeader}>
                  <MaterialIcons name="warning" size={24} color={COLORS.warning} />
                  <View style={styles.alertTextContainer}>
                    <Text style={styles.alertTitle}>Warning - expiring within 14 days</Text>
                    <Text style={styles.alertText}>
                      {stats.expiring_safety_documents} safety document(s) expiring within 14 days
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Shut-down sites and flagged clock-ins */}
        {stats.shutdown_sites > 0 || stats.flagged_clock_records > 0 ? (
          <View style={styles.alertSection}>
            {stats.shutdown_sites > 0 ? (
              <TouchableOpacity style={[styles.alertCard, styles.criticalAlert]} onPress={() => router.push('/manager/projects' as any)}>
                <View style={styles.alertHeader}>
                  <MaterialIcons name="block" size={24} color={COLORS.error} />
                  <View style={styles.alertTextContainer}>
                    <Text style={styles.alertTitle}>{stats.shutdown_sites} site(s) shut down</Text>
                    <Text style={styles.alertText}>Nobody can clock in there until reopened.</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ) : null}
            {stats.flagged_clock_records > 0 ? (
              <TouchableOpacity style={[styles.alertCard, styles.warningAlert]} onPress={() => router.push('/manager/approvals' as any)}>
                <View style={styles.alertHeader}>
                  <MaterialIcons name="gps-off" size={24} color={COLORS.warning} />
                  <View style={styles.alertTextContainer}>
                    <Text style={styles.alertTitle}>{stats.flagged_clock_records} flagged clock-in(s)</Text>
                    <Text style={styles.alertText}>Couldn't be GPS-checked. Tap to review.</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {/* Receivables */}
        {ar ? (
          <View style={styles.section}>
            <View style={styles.activityCard}>
              <View style={styles.activityHeader}>
                <MaterialIcons name="account-balance" size={24} color={COLORS.primary} />
                <Text style={styles.activityTitle}>Progress Draws</Text>
              </View>
              <View style={styles.activityRow}>
                <Text style={styles.activityLabel}>Outstanding</Text>
                <Text style={styles.activityValue}>{money(ar.outstanding)}</Text>
              </View>
              <View style={styles.activityRow}>
                <Text style={styles.activityLabel}>Over 60 days</Text>
                <Text style={[styles.activityValue, (ar.aging['61-90'] + ar.aging['90+']) > 0 ? { color: COLORS.error } : null]}>
                  {money(ar.aging['61-90'] + ar.aging['90+'])}
                </Text>
              </View>
              <View style={styles.activityRow}>
                <Text style={styles.activityLabel}>Holdback held</Text>
                <Text style={styles.activityValue}>{money(ar.holdback_held)}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Job sites at a glance */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Job Sites at a Glance</Text>
          {sites.length === 0 ? (
            <Text style={styles.activityLabel}>No active sites yet.</Text>
          ) : (
            sites.map((site) => (
              <SiteGlanceCard key={site.id} site={site} onPress={() => router.push(`/manager/project/${site.id}` as any)} />
            ))
          )}
        </View>

        {/* Today's Activity */}
        <View style={styles.section}>
          <View style={styles.activityCard}>
            <View style={styles.activityHeader}>
              <MaterialIcons name="today" size={24} color={COLORS.primary} />
              <Text style={styles.activityTitle}>Today's Activity</Text>
            </View>
            <View style={styles.activityRow}>
              <Text style={styles.activityLabel}>Clock Records</Text>
              <Text style={styles.activityValue}>{stats.today_clock_records || 0}</Text>
            </View>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionGrid}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/manager/members')}
            >
              <MaterialIcons name="person-add" size={28} color={COLORS.primary} />
              <Text style={styles.actionText}>Add Member</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/manager/tasks')}
            >
              <MaterialIcons name="assignment" size={28} color={COLORS.primary} />
              <Text style={styles.actionText}>Manage Tasks</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/manager/forms')}
            >
              <MaterialIcons name="description" size={28} color={COLORS.primary} />
              <Text style={styles.actionText}>Custom Forms</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/manager/timesheets')}
            >
              <MaterialIcons name="print" size={28} color={COLORS.primary} />
              <Text style={styles.actionText}>Export Reports</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/manager/safety')}
            >
              <MaterialIcons name="verified-user" size={28} color={COLORS.primary} />
              <Text style={styles.actionText}>View Safety Docs</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => router.push('/manager/announcements')}
            >
              <MaterialIcons name="campaign" size={28} color={COLORS.primary} />
              <Text style={styles.actionText}>Post Announcement</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Branding */}
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
    alignItems: 'center',
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
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: COLORS.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '700',
  },
  signOutButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFEBEE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 12,
  },
  statCard: {
    width: '47%',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  alertSection: {
    padding: 16,
    gap: 12,
  },
  alertCard: {
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
  },
  criticalAlert: {
    backgroundColor: '#FFEBEE',
    borderLeftColor: COLORS.error,
  },
  warningAlert: {
    backgroundColor: '#FFF8E1',
    borderLeftColor: '#D98E04',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  alertTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  alertText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  section: {
    padding: 16,
  },
  activityCard: {
    backgroundColor: COLORS.white,
    padding: 20,
    borderRadius: 12,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  activityTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginLeft: 12,
  },
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  activityLabel: {
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  activityValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    width: '47%',
    backgroundColor: COLORS.white,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: 8,
    textAlign: 'center',
  },
});
