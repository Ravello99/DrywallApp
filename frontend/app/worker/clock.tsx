import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { clockService } from '../../src/services/clockService';
import { siteService } from '../../src/services/siteService';
import { format } from 'date-fns';
import { Site } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';
import { tasksApi, apiError } from '../../src/services/pmService';
import { Chips } from '../../src/components/ui';

export default function ClockScreen() {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [activeRecord, setActiveRecord] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);
  const [showSiteModal, setShowSiteModal] = useState(false);
  // "What are you working on?" (feeds task hour budgets)
  const [siteTasks, setSiteTasks] = useState<{ id: string; title: string; scope_label?: string }[]>([]);
  const [taskId, setTaskId] = useState('');

  const siteForTasks = activeRecord?.site_id || selectedSite?.id;
  useEffect(() => {
    if (!siteForTasks) {
      setSiteTasks([]);
      return;
    }
    tasksApi
      .clockable(siteForTasks)
      .then(setSiteTasks)
      .catch(() => setSiteTasks([]));
  }, [siteForTasks]);

  const changeTask = async (id: string) => {
    try {
      const res = await tasksApi.setActiveTask(id || null);
      setActiveRecord((prev: any) => (prev ? { ...prev, task_id: res.task_id, task_title: res.task_title } : prev));
    } catch (error) {
      Alert.alert('Error', apiError(error));
    }
  };

  useEffect(() => {
    loadData();
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required for clock in/out');
        return;
      }
      
      const currentLocation = await Location.getCurrentPositionAsync({});
      setLocation(currentLocation.coords);
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'Could not get your location');
    }
  };

  const loadData = async () => {
    try {
      const [sitesRes, activeRes] = await Promise.all([
        siteService.getSites(),
        clockService.getActiveRecord(),
      ]);
      
      setSites(sitesRes);
      if (sitesRes.length > 0 && !selectedSite) {
        setSelectedSite(sitesRes[0]);
      }
      
      setActiveRecord(activeRes.status === 'clocked_in' ? activeRes.record : null);
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Take a fresh, high-accuracy reading right when clocking in/out (the one from when the
  // screen opened may be stale). Falls back to the last known reading.
  const freshFix = async () => {
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLocation(pos.coords);
      return pos.coords;
    } catch {
      return location;
    }
  };

  const handleClockIn = async () => {
    if (!selectedSite) {
      Alert.alert('Error', 'Please select a site');
      return;
    }

    if (!location) {
      Alert.alert('Error', 'Getting your location, please wait...');
      await requestLocationPermission();
      return;
    }

    if (selectedSite.status === 'shutdown') {
      Alert.alert(
        'Site Shut Down',
        `${selectedSite.name} is shut down${selectedSite.shutdown_reason ? `: ${selectedSite.shutdown_reason}` : ''}. Clock-in is disabled until it reopens.`,
      );
      return;
    }

    setActionLoading(true);
    try {
      const fix = (await freshFix()) || location;
      const record = await clockService.clockIn(
        selectedSite.id,
        { latitude: fix.latitude, longitude: fix.longitude },
        fix.accuracy,
        taskId || null,
      );

      setActiveRecord(record);
      Alert.alert('Clocked In', `You're clocked in at ${selectedSite.name}.`);
    } catch (error: any) {
      const status = error.response?.status;
      const title = status === 423 ? 'Site Shut Down' : status === 403 ? "Can't Clock In" : 'Error';
      Alert.alert(title, error.response?.data?.detail || 'Failed to clock in. Check your connection.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOut = async () => {
    if (!location) {
      Alert.alert('Error', 'Getting your location, please wait...');
      await requestLocationPermission();
      return;
    }

    Alert.alert(
      'Clock Out',
      'Are you sure you want to clock out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clock Out',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const fix = (await freshFix()) || location;
              await clockService.clockOut(
                { latitude: fix.latitude, longitude: fix.longitude },
                fix.accuracy,
              );
              
              setActiveRecord(null);
              Alert.alert('Success', 'Clocked out successfully!');
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.detail || 'Failed to clock out');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const selectSite = (site: Site) => {
    setSelectedSite(site);
    setTaskId('');
    setShowSiteModal(false);
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
      <ScrollView contentContainerStyle={styles.content}>
        {/* Current Status */}
        {activeRecord ? (
          <View style={[styles.statusCard, styles.activeStatus]}>
            <MaterialIcons name="check-circle" size={48} color={COLORS.success} />
            <Text style={styles.statusTitle}>Currently Clocked In</Text>
            <Text style={styles.statusSite}>{activeRecord.site_name}</Text>
            <Text style={styles.statusTime}>
              Since {format(new Date(activeRecord.clock_in), 'h:mm a')}
            </Text>
            {activeRecord.task_title ? <Text style={styles.statusTime}>Working on: {activeRecord.task_title}</Text> : null}
          </View>
        ) : (
          <View style={[styles.statusCard, styles.inactiveStatus]}>
            <MaterialIcons name="schedule" size={48} color={COLORS.gray400} />
            <Text style={styles.statusTitle}>Not Clocked In</Text>
            <Text style={styles.statusSubtitle}>Select a site to start your shift</Text>
          </View>
        )}

        {/* Site Selection (only when not clocked in) */}
        {!activeRecord && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Select Site</Text>
            {sites.length > 0 ? (
              <TouchableOpacity
                style={styles.siteSelector}
                onPress={() => setShowSiteModal(true)}
              >
                <MaterialIcons name="location-city" size={24} color={COLORS.primary} />
                <View style={styles.siteSelectorText}>
                  <Text style={styles.siteSelectorLabel}>
                    {selectedSite ? selectedSite.name : 'Tap to select a site'}
                  </Text>
                  {selectedSite && (
                    <Text style={styles.siteSelectorAddress}>{selectedSite.address}</Text>
                  )}
                </View>
                <MaterialIcons name="arrow-drop-down" size={28} color={COLORS.gray500} />
              </TouchableOpacity>
            ) : (
              <View style={styles.noSitesContainer}>
                <MaterialIcons name="warning" size={24} color={COLORS.warning} />
                <Text style={styles.noSitesText}>No sites assigned to you</Text>
                <Text style={styles.noSitesSubtext}>Contact your manager to get assigned to a site</Text>
              </View>
            )}
          </View>
        )}

        {/* Task picker */}
        {siteTasks.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{activeRecord ? 'Change what you are working on' : 'What are you working on?'}</Text>
            <Chips
              options={[{ value: '', label: 'Not sure / general' }, ...siteTasks.map((t) => ({ value: t.id, label: t.title }))]}
              value={activeRecord ? activeRecord.task_id || '' : taskId}
              onChange={(v: string) => (activeRecord ? changeTask(v) : setTaskId(v))}
            />
          </View>
        )}

        {selectedSite?.status === 'shutdown' && !activeRecord ? (
          <View style={[styles.locationCard, { backgroundColor: '#FDECEC' }]}>
            <MaterialIcons name="block" size={24} color={COLORS.error} />
            <Text style={[styles.locationText, { color: COLORS.error }]}>
              {selectedSite.name} is shut down{selectedSite.shutdown_reason ? `: ${selectedSite.shutdown_reason}` : ''}
            </Text>
          </View>
        ) : null}

        {/* Location Status */}
        <View style={styles.locationCard}>
          <MaterialIcons
            name="location-on"
            size={24}
            color={location ? COLORS.success : COLORS.gray400}
          />
          <Text style={styles.locationText}>
            {location
              ? `Location: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
              : 'Getting location...'}
          </Text>
        </View>

        {/* Action Button */}
        {activeRecord ? (
          <TouchableOpacity
            style={[styles.actionButton, styles.clockOutButton]}
            onPress={handleClockOut}
            disabled={actionLoading}
          >
            {actionLoading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <MaterialIcons name="exit-to-app" size={24} color={COLORS.white} />
                <Text style={styles.buttonText}>Clock Out</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionButton, styles.clockInButton, !selectedSite && styles.buttonDisabled]}
            onPress={handleClockIn}
            disabled={actionLoading || !selectedSite}
          >
            {actionLoading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <MaterialIcons name="work" size={24} color={COLORS.white} />
                <Text style={styles.buttonText}>Clock In</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <Footer />
      </ScrollView>

      {/* Site Selection Modal */}
      <Modal visible={showSiteModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Site</Text>
              <TouchableOpacity onPress={() => setShowSiteModal(false)}>
                <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={sites}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.siteOption,
                    selectedSite?.id === item.id && styles.siteOptionSelected,
                  ]}
                  onPress={() => selectSite(item)}
                >
                  <MaterialIcons
                    name="location-city"
                    size={24}
                    color={selectedSite?.id === item.id ? COLORS.primary : COLORS.gray500}
                  />
                  <View style={styles.siteOptionInfo}>
                    <Text
                      style={[
                        styles.siteOptionName,
                        selectedSite?.id === item.id && styles.siteOptionNameSelected,
                      ]}
                    >
                      {item.name}
                    </Text>
                    <Text style={styles.siteOptionAddress}>{item.address}</Text>
                  </View>
                  {selectedSite?.id === item.id && (
                    <MaterialIcons name="check-circle" size={24} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyList}>
                  <Text style={styles.emptyListText}>No sites available</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
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
  content: {
    padding: 16,
  },
  statusCard: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    marginBottom: 24,
  },
  activeStatus: {
    borderWidth: 2,
    borderColor: COLORS.success,
  },
  inactiveStatus: {},
  statusTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    color: COLORS.textPrimary,
  },
  statusSite: {
    fontSize: 18,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  statusTime: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 4,
  },
  statusSubtitle: {
    fontSize: 16,
    color: COLORS.textLight,
    marginTop: 8,
  },
  sectionCard: {
    backgroundColor: COLORS.white,
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  siteSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    backgroundColor: COLORS.background,
  },
  siteSelectorText: {
    flex: 1,
    marginLeft: 12,
  },
  siteSelectorLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  siteSelectorAddress: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  noSitesContainer: {
    alignItems: 'center',
    padding: 20,
  },
  noSitesText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  noSitesSubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
    textAlign: 'center',
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  locationText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginLeft: 12,
    flex: 1,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    borderRadius: 12,
    gap: 12,
  },
  clockInButton: {
    backgroundColor: COLORS.success,
  },
  clockOutButton: {
    backgroundColor: COLORS.error,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  siteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  siteOptionSelected: {
    backgroundColor: COLORS.primary + '10',
  },
  siteOptionInfo: {
    flex: 1,
    marginLeft: 12,
  },
  siteOptionName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  siteOptionNameSelected: {
    color: COLORS.primary,
  },
  siteOptionAddress: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  emptyList: {
    padding: 40,
    alignItems: 'center',
  },
  emptyListText: {
    fontSize: 16,
    color: COLORS.textLight,
  },
});
