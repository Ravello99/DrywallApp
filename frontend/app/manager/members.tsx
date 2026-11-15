import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  RefreshControl,
  Switch,
} from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { userService } from '../../src/services/userService';
import { siteService } from '../../src/services/siteService';
import { User, Site, UserRole } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import { useAuthStore } from '../../src/store/authStore';
import {
  ROLE_OPTIONS,
  SPECIALTY_OPTIONS,
  LEVEL_OPTIONS,
  JOB_TYPE_OPTIONS,
  isOfficeRole,
  roleLabel,
  roleColor,
  specialtyLabel,
  levelLabel,
  jobTypeLabel,
  canSeePayRates,
  canShutDownSites,
} from '../../src/constants/roles';
import Footer from '../../src/components/Footer';
import ModalPicker from '../../src/components/ModalPicker';

const getRoleLabel = roleLabel;
const getRoleColor = roleColor;

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: COLORS.success },
  shutdown: { label: 'SHUT DOWN', color: COLORS.error },
  completed: { label: 'Completed', color: COLORS.gray400 },
};

export default function MembersScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [members, setMembers] = useState<User[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showAddSite, setShowAddSite] = useState(false);
  const [showEditSite, setShowEditSite] = useState(false);
  const [showEditMember, setShowEditMember] = useState(false);
  const [selectedMember, setSelectedMember] = useState<User | null>(null);
  const [selectedSiteForEdit, setSelectedSiteForEdit] = useState<Site | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Member form
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberPassword, setMemberPassword] = useState('');
  const [memberRole, setMemberRole] = useState<UserRole>('employee');
  const [selectedSites, setSelectedSites] = useState<string[]>([]);
  const [memberPhone, setMemberPhone] = useState('');
  const [memberEmergencyName, setMemberEmergencyName] = useState('');
  const [memberEmergencyPhone, setMemberEmergencyPhone] = useState('');
  const [memberSpecialties, setMemberSpecialties] = useState<string[]>([]);
  const [memberLevel, setMemberLevel] = useState('');
  const [memberPayRate, setMemberPayRate] = useState('');

  // Site form
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [siteProjectNumber, setSiteProjectNumber] = useState('');
  const [siteGC, setSiteGC] = useState('');
  const [siteJobType, setSiteJobType] = useState('');
  const [siteLat, setSiteLat] = useState('');
  const [siteLng, setSiteLng] = useState('');
  const [siteRadius, setSiteRadius] = useState('200');
  const [locating, setLocating] = useState(false);

  // Shutdown
  const [shutdownSite, setShutdownSite] = useState<Site | null>(null);
  const [shutdownReason, setShutdownReason] = useState('');
  const [shutdownClockOut, setShutdownClockOut] = useState(true);

  const { user: me } = useAuthStore();
  const showPay = canSeePayRates(me?.role);
  const canShutDown = canShutDownSites(me?.role);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [membersRes, sitesRes] = await Promise.all([
        userService.getUsers(),
        siteService.getSites(),
      ]);
      setMembers(membersRes);
      setSites(sitesRes);
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const resetMemberForm = () => {
    setMemberName('');
    setMemberEmail('');
    setMemberPassword('');
    setMemberRole('employee');
    setSelectedSites([]);
    setSelectedMember(null);
    setMemberPhone('');
    setMemberEmergencyName('');
    setMemberEmergencyPhone('');
    setMemberSpecialties([]);
    setMemberLevel('');
    setMemberPayRate('');
  };

  const memberPayload = () => {
    const office = isOfficeRole(memberRole);
    const payload: any = {
      name: memberName.trim(),
      email: memberEmail.trim(),
      role: memberRole,
      assigned_sites: office ? [] : selectedSites,
      phone: memberPhone.trim() || null,
      emergency_contact_name: memberEmergencyName.trim() || null,
      emergency_contact_phone: memberEmergencyPhone.trim() || null,
      specialties: memberSpecialties,
      level: office ? null : memberLevel || null,
    };
    if (showPay && memberPayRate.trim() !== '') {
      const rate = parseFloat(memberPayRate);
      if (isNaN(rate) || rate < 0) throw new Error('Pay rate must be a number, e.g. 38.50');
      payload.pay_rate = rate;
    }
    return payload;
  };

  const toggleSpecialty = (value: string) =>
    setMemberSpecialties((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  const resetSiteForm = () => {
    setSiteName('');
    setSiteAddress('');
    setSiteProjectNumber('');
    setSiteGC('');
    setSiteJobType('');
    setSiteLat('');
    setSiteLng('');
    setSiteRadius('200');
    setSelectedSiteForEdit(null);
  };

  const sitePayload = () => {
    const payload: any = {
      name: siteName.trim(),
      address: siteAddress.trim(),
      project_number: siteProjectNumber.trim() || null,
      general_contractor: siteGC.trim() || null,
      job_type: siteJobType || null,
    };
    const radius = parseInt(siteRadius, 10);
    if (isNaN(radius) || radius < 25 || radius > 5000) throw new Error('Clock-in radius must be 25 to 5000 metres');
    payload.geofence_radius_m = radius;
    if (siteLat.trim() || siteLng.trim()) {
      const lat = parseFloat(siteLat);
      const lng = parseFloat(siteLng);
      if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new Error('GPS coordinates look wrong. Use "Use my current location" or leave them blank.');
      }
      payload.location = { latitude: lat, longitude: lng };
    }
    return payload;
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Allow location access to set the site from where you are standing.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setSiteLat(pos.coords.latitude.toFixed(6));
      setSiteLng(pos.coords.longitude.toFixed(6));
    } catch {
      Alert.alert('Error', 'Could not get your location');
    } finally {
      setLocating(false);
    }
  };

  const errorText = (error: any, fallback: string) => {
    const d = error?.response?.data?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map((x: any) => x.msg).join('\n');
    return error?.message || fallback;
  };

  const handleShutdown = async () => {
    if (!shutdownSite) return;
    if (shutdownReason.trim().length < 3) {
      Alert.alert('Reason needed', 'Enter a short reason, e.g. "Safety stand-down" or "Waiting on GC".');
      return;
    }
    setActionLoading(true);
    try {
      await siteService.shutdownSite(shutdownSite.id, shutdownReason.trim(), shutdownClockOut);
      Alert.alert('Site Shut Down', `${shutdownSite.name} is shut down. Nobody can clock in until it is reopened.`);
      setShutdownSite(null);
      setShutdownReason('');
      setShutdownClockOut(true);
      loadData();
    } catch (error: any) {
      Alert.alert('Error', errorText(error, 'Failed to shut down site'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReopen = (site: Site) => {
    Alert.alert('Reopen Site', `Reopen ${site.name} so the crew can clock in again?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reopen',
        onPress: async () => {
          try {
            await siteService.reopenSite(site.id);
            loadData();
          } catch (error: any) {
            Alert.alert('Error', errorText(error, 'Failed to reopen site'));
          }
        },
      },
    ]);
  };

  const handleAddMember = async () => {
    if (!memberName || !memberEmail || !memberPassword) {
      Alert.alert('Error', 'Name, email and password are required');
      return;
    }
    if (memberPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }

    setActionLoading(true);
    try {
      await userService.createUser({ ...memberPayload(), password: memberPassword });

      Alert.alert('Success', `${getRoleLabel(memberRole)} added successfully!`);
      setShowAddMember(false);
      resetMemberForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', errorText(error, 'Failed to add member'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditMember = (member: User) => {
    setSelectedMember(member);
    setMemberName(member.name);
    setMemberEmail(member.email);
    setMemberRole(member.role as UserRole);
    setSelectedSites(member.assigned_sites || []);
    setMemberPhone(member.phone || '');
    setMemberEmergencyName(member.emergency_contact_name || '');
    setMemberEmergencyPhone(member.emergency_contact_phone || '');
    setMemberSpecialties(member.specialties || []);
    setMemberLevel(member.level || '');
    setMemberPayRate(member.pay_rate != null ? String(member.pay_rate) : '');
    setShowEditMember(true);
  };

  const handleUpdateMember = async () => {
    if (!selectedMember) return;

    setActionLoading(true);
    try {
      await userService.updateUser(selectedMember.id, {
        ...memberPayload(),
        ...(memberPassword && { password: memberPassword }),
      });

      Alert.alert('Success', 'Member updated successfully!');
      setShowEditMember(false);
      resetMemberForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', errorText(error, 'Failed to update member'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteMember = (member: User) => {
    Alert.alert(
      'Delete Member',
      `Are you sure you want to delete ${member.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await userService.deleteUser(member.id);
              Alert.alert('Success', 'Member deleted');
              loadData();
            } catch (error: any) {
              Alert.alert('Error', 'Failed to delete member');
            }
          },
        },
      ]
    );
  };

  const handleAddSite = async () => {
    if (!siteName || !siteAddress) {
      Alert.alert('Error', 'Site name and address are required');
      return;
    }

    setActionLoading(true);
    try {
      const created = await siteService.createSite({ ...sitePayload(), status: 'active' });

      Alert.alert(
        'Site Added',
        created.location
          ? `${created.name} added. Crew must be within ${created.geofence_radius_m} m of it to clock in.`
          : `${created.name} added, but its GPS location couldn't be found from the address. Edit the site and tap "Use my current location" while on site, or clock-ins will be flagged.`,
      );
      setShowAddSite(false);
      resetSiteForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', errorText(error, 'Failed to add site'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditSite = (site: Site) => {
    setSelectedSiteForEdit(site);
    setSiteName(site.name);
    setSiteAddress(site.address);
    setSiteProjectNumber(site.project_number || '');
    setSiteGC(site.general_contractor || '');
    setSiteJobType(site.job_type || '');
    setSiteLat(site.location ? String(site.location.latitude) : '');
    setSiteLng(site.location ? String(site.location.longitude) : '');
    setSiteRadius(String(site.geofence_radius_m || 200));
    setShowEditSite(true);
  };

  const handleUpdateSite = async () => {
    if (!selectedSiteForEdit) return;
    
    if (!siteName || !siteAddress) {
      Alert.alert('Error', 'Site name and address are required');
      return;
    }

    setActionLoading(true);
    try {
      await siteService.updateSite(selectedSiteForEdit.id, sitePayload());

      Alert.alert('Success', 'Site updated successfully!');
      setShowEditSite(false);
      resetSiteForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', errorText(error, 'Failed to update site'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteSite = (site: Site) => {
    Alert.alert(
      'Delete Site',
      `Are you sure you want to delete "${site.name}"? This may affect workers assigned to this site.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await siteService.deleteSite(site.id);
              Alert.alert('Success', 'Site deleted');
              loadData();
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.detail || 'Failed to delete site');
            }
          },
        },
      ]
    );
  };

  const toggleSiteSelection = (siteId: string) => {
    setSelectedSites((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]
    );
  };

  // Group members by role
  const managers = members.filter((m) => isOfficeRole(m.role));
  const workers = members.filter((m) => !isOfficeRole(m.role));

  const renderSiteFields = () => (
    <>
      <TextInput
        style={styles.input}
        placeholder="Site / Project Name"
        value={siteName}
        onChangeText={setSiteName}
        placeholderTextColor={COLORS.gray400}
      />
      <TextInput
        style={styles.input}
        placeholder="Site Address"
        value={siteAddress}
        onChangeText={setSiteAddress}
        multiline
        placeholderTextColor={COLORS.gray400}
      />
      <TextInput
        style={styles.input}
        placeholder="Project Number (optional)"
        value={siteProjectNumber}
        onChangeText={setSiteProjectNumber}
        placeholderTextColor={COLORS.gray400}
      />
      <TextInput
        style={styles.input}
        placeholder="General Contractor (optional)"
        value={siteGC}
        onChangeText={setSiteGC}
        placeholderTextColor={COLORS.gray400}
      />
      <Text style={styles.label}>Job Type:</Text>
      <ModalPicker
        options={JOB_TYPE_OPTIONS}
        selectedValue={siteJobType}
        onValueChange={setSiteJobType}
        placeholder="Select job type"
      />

      <Text style={styles.label}>Clock-in Location</Text>
      <Text style={styles.helpText}>
        Leave blank to look it up from the address, or stand on site and use your current location.
      </Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.half]}
          placeholder="Latitude"
          value={siteLat}
          onChangeText={setSiteLat}
          keyboardType="numbers-and-punctuation"
          placeholderTextColor={COLORS.gray400}
        />
        <TextInput
          style={[styles.input, styles.half]}
          placeholder="Longitude"
          value={siteLng}
          onChangeText={setSiteLng}
          keyboardType="numbers-and-punctuation"
          placeholderTextColor={COLORS.gray400}
        />
      </View>
      <TouchableOpacity style={styles.locateBtn} onPress={useMyLocation} disabled={locating}>
        {locating ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : (
          <>
            <MaterialIcons name="my-location" size={18} color={COLORS.primary} />
            <Text style={styles.locateBtnText}>Use my current location</Text>
          </>
        )}
      </TouchableOpacity>
      <Text style={styles.label}>Clock-in radius (metres):</Text>
      <TextInput
        style={styles.input}
        placeholder="200"
        value={siteRadius}
        onChangeText={setSiteRadius}
        keyboardType="number-pad"
        placeholderTextColor={COLORS.gray400}
      />
    </>
  );

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
        {/* Sites Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Sites ({sites.length})</Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowAddSite(true)}
            >
              <MaterialIcons name="add" size={24} color={COLORS.white} />
            </TouchableOpacity>
          </View>
          {sites.length > 0 ? (
            sites.map((site) => (
              <View key={site.id} style={styles.siteCard}>
                <MaterialIcons name="location-city" size={24} color={COLORS.primary} />
                <View style={styles.siteInfo}>
                  <View style={styles.siteTitleRow}>
                    <Text style={styles.siteName}>
                      {site.project_number ? `${site.project_number} · ` : ''}
                      {site.name}
                    </Text>
                    <View style={[styles.statusPill, { backgroundColor: (STATUS_STYLE[site.status]?.color || COLORS.gray400) + '1A' }]}>
                      <Text style={[styles.statusPillText, { color: STATUS_STYLE[site.status]?.color || COLORS.gray400 }]}>
                        {STATUS_STYLE[site.status]?.label || site.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.siteAddress}>{site.address}</Text>
                  <Text style={styles.siteMeta}>
                    {[jobTypeLabel(site.job_type), site.general_contractor].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={styles.siteMeta}>
                    {site.workers_on_site} on site now ·{' '}
                    {site.location ? `clock-in radius ${site.geofence_radius_m} m` : '⚠ no GPS location set'}
                  </Text>
                  {site.status === 'shutdown' && (
                    <Text style={styles.shutdownNote}>
                      Shut down{site.shutdown_by_name ? ` by ${site.shutdown_by_name}` : ''}: {site.shutdown_reason}
                    </Text>
                  )}
                  {canShutDown && site.status !== 'completed' && (
                    site.status === 'shutdown' ? (
                      <TouchableOpacity style={[styles.shutdownBtn, styles.reopenBtn]} onPress={() => handleReopen(site)}>
                        <MaterialIcons name="play-arrow" size={16} color={COLORS.success} />
                        <Text style={[styles.shutdownBtnText, { color: COLORS.success }]}>Reopen Site</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.shutdownBtn} onPress={() => setShutdownSite(site)}>
                        <MaterialIcons name="block" size={16} color={COLORS.error} />
                        <Text style={styles.shutdownBtnText}>Shut Down Site</Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
                <View style={styles.siteActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleEditSite(site)}
                  >
                    <MaterialIcons name="edit" size={20} color={COLORS.info} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleDeleteSite(site)}
                  >
                    <MaterialIcons name="delete" size={20} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <MaterialIcons name="location-city" size={48} color={COLORS.gray300} />
              <Text style={styles.emptyText}>No sites yet</Text>
              <Text style={styles.emptySubtext}>Add your first site to get started</Text>
            </View>
          )}
        </View>

        {/* Managers Section */}
        {managers.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Office ({managers.length})</Text>
            </View>
            {managers.map((member) => (
              <View key={member.id} style={styles.memberCard}>
                <View style={styles.memberHeader}>
                  <View style={[styles.roleIndicator, { backgroundColor: getRoleColor(member.role) }]} />
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberEmail}>{member.email}</Text>
                    <View style={[styles.roleBadge, { backgroundColor: getRoleColor(member.role) + '20' }]}>
                      <Text style={[styles.roleBadgeText, { color: getRoleColor(member.role) }]}>
                        {getRoleLabel(member.role)}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.memberActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleEditMember(member)}
                  >
                    <MaterialIcons name="edit" size={20} color={COLORS.info} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleDeleteMember(member)}
                  >
                    <MaterialIcons name="delete" size={20} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Workers Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Field Crew ({workers.length})</Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowAddMember(true)}
            >
              <MaterialIcons name="person-add" size={24} color={COLORS.white} />
            </TouchableOpacity>
          </View>
          {workers.length > 0 ? (
            workers.map((member) => (
              <View key={member.id} style={styles.memberCard}>
                <View style={styles.memberHeader}>
                  <View style={[styles.roleIndicator, { backgroundColor: getRoleColor(member.role) }]} />
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberEmail}>{member.email}</Text>
                    <View style={[styles.roleBadge, { backgroundColor: getRoleColor(member.role) + '20' }]}>
                      <Text style={[styles.roleBadgeText, { color: getRoleColor(member.role) }]}>
                        {getRoleLabel(member.role)}
                      </Text>
                    </View>
                    {(member.specialties?.length || member.level) ? (
                      <Text style={styles.memberSites}>
                        {[levelLabel(member.level), ...(member.specialties || []).map(specialtyLabel)]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    ) : null}
                    <Text style={styles.memberSites}>
                      {member.assigned_sites?.length || 0} site(s) assigned
                      {showPay && member.pay_rate != null ? `  ·  $${member.pay_rate.toFixed(2)}/hr` : ''}
                    </Text>
                  </View>
                </View>
                <View style={styles.memberActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleEditMember(member)}
                  >
                    <MaterialIcons name="edit" size={20} color={COLORS.info} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleDeleteMember(member)}
                  >
                    <MaterialIcons name="delete" size={20} color={COLORS.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <MaterialIcons name="people-outline" size={48} color={COLORS.gray300} />
              <Text style={styles.emptyText}>No team members yet</Text>
              <Text style={styles.emptySubtext}>Add your first team member to get started</Text>
            </View>
          )}
        </View>

        <Footer />
      </ScrollView>

      {/* Add Site Modal */}
      <Modal visible={showAddSite} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScrollContent}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add New Site</Text>
            {renderSiteFields()}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowAddSite(false);
                  resetSiteForm();
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.submitButton]}
                onPress={handleAddSite}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.submitButtonText}>Add Site</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Edit Site Modal */}
      <Modal visible={showEditSite} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScrollContent}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Site</Text>
            {renderSiteFields()}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowEditSite(false);
                  resetSiteForm();
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.submitButton]}
                onPress={handleUpdateSite}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.submitButtonText}>Update Site</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Shut Down Site Modal */}
      <Modal visible={!!shutdownSite} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Shut Down {shutdownSite?.name}</Text>
            <Text style={styles.helpText}>
              Nobody will be able to clock in at this site until it is reopened.
            </Text>
            <TextInput
              style={[styles.input, { minHeight: 80 }]}
              placeholder="Reason (e.g. Safety stand-down, waiting on GC, weather)"
              value={shutdownReason}
              onChangeText={setShutdownReason}
              multiline
              placeholderTextColor={COLORS.gray400}
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>
                Clock out everyone on site now ({shutdownSite?.workers_on_site || 0})
              </Text>
              <Switch
                value={shutdownClockOut}
                onValueChange={setShutdownClockOut}
                trackColor={{ true: COLORS.primary, false: COLORS.gray300 }}
              />
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShutdownSite(null);
                  setShutdownReason('');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: COLORS.error }]}
                onPress={handleShutdown}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.submitButtonText}>Shut Down</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add/Edit Member Modal */}
      <Modal visible={showAddMember || showEditMember} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScrollContent}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>
                {showEditMember ? 'Edit Member' : 'Add New Member'}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Full Name"
                value={memberName}
                onChangeText={setMemberName}
                placeholderTextColor={COLORS.gray400}
              />
              <TextInput
                style={styles.input}
                placeholder="Email"
                value={memberEmail}
                onChangeText={setMemberEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor={COLORS.gray400}
              />
              <TextInput
                style={styles.input}
                placeholder={showEditMember ? 'New Password (optional)' : 'Password (8+ characters)'}
                value={memberPassword}
                onChangeText={setMemberPassword}
                secureTextEntry
                placeholderTextColor={COLORS.gray400}
              />
              
              <Text style={styles.label}>Select Role:</Text>
              <ModalPicker
                options={ROLE_OPTIONS.filter((r) => r.value !== 'admin' || me?.role === 'admin')}
                selectedValue={memberRole}
                onValueChange={(value) => setMemberRole(value as UserRole)}
                placeholder="Select a role"
              />
              
              <TextInput
                style={styles.input}
                placeholder="Phone"
                value={memberPhone}
                onChangeText={setMemberPhone}
                keyboardType="phone-pad"
                placeholderTextColor={COLORS.gray400}
              />
              <TextInput
                style={styles.input}
                placeholder="Emergency contact name"
                value={memberEmergencyName}
                onChangeText={setMemberEmergencyName}
                placeholderTextColor={COLORS.gray400}
              />
              <TextInput
                style={styles.input}
                placeholder="Emergency contact phone"
                value={memberEmergencyPhone}
                onChangeText={setMemberEmergencyPhone}
                keyboardType="phone-pad"
                placeholderTextColor={COLORS.gray400}
              />
              {showPay && (
                <TextInput
                  style={styles.input}
                  placeholder="Hourly pay rate ($)"
                  value={memberPayRate}
                  onChangeText={setMemberPayRate}
                  keyboardType="decimal-pad"
                  placeholderTextColor={COLORS.gray400}
                />
              )}

              {!isOfficeRole(memberRole) && (
                <>
                  <Text style={styles.label}>Level:</Text>
                  <ModalPicker
                    options={LEVEL_OPTIONS}
                    selectedValue={memberLevel}
                    onValueChange={setMemberLevel}
                    placeholder="Select level"
                  />
                  <Text style={styles.label}>Specialties:</Text>
                  {SPECIALTY_OPTIONS.map((opt) => (
                    <TouchableOpacity key={opt.value} style={styles.checkboxRow} onPress={() => toggleSpecialty(opt.value)}>
                      <MaterialIcons
                        name={memberSpecialties.includes(opt.value) ? 'check-box' : 'check-box-outline-blank'}
                        size={24}
                        color={memberSpecialties.includes(opt.value) ? COLORS.primary : COLORS.gray400}
                      />
                      <Text style={styles.checkboxLabel}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {!isOfficeRole(memberRole) && (
                <>
                  <Text style={styles.label}>Assign Sites:</Text>
                  {sites.map((site) => (
                    <TouchableOpacity
                      key={site.id}
                      style={styles.checkboxRow}
                      onPress={() => toggleSiteSelection(site.id)}
                    >
                      <MaterialIcons
                        name={selectedSites.includes(site.id) ? 'check-box' : 'check-box-outline-blank'}
                        size={24}
                        color={selectedSites.includes(site.id) ? COLORS.primary : COLORS.gray400}
                      />
                      <Text style={styles.checkboxLabel}>{site.name}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
              
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    setShowAddMember(false);
                    setShowEditMember(false);
                    resetMemberForm();
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.submitButton]}
                  onPress={showEditMember ? handleUpdateMember : handleAddMember}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <ActivityIndicator color={COLORS.white} />
                  ) : (
                    <Text style={styles.submitButtonText}>
                      {showEditMember ? 'Update' : 'Add Member'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
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
  section: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  addButton: {
    backgroundColor: COLORS.primary,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  siteCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  siteInfo: {
    marginLeft: 12,
    flex: 1,
  },
  siteName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  siteAddress: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  siteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  siteMeta: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 4,
  },
  shutdownNote: {
    fontSize: 13,
    color: COLORS.error,
    marginTop: 6,
    fontWeight: '600',
  },
  shutdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  reopenBtn: {
    borderColor: COLORS.success,
  },
  shutdownBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.error,
  },
  helpText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  half: {
    flex: 1,
  },
  locateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 10,
    marginBottom: 12,
  },
  locateBtnText: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    marginRight: 8,
  },
  siteActions: {
    flexDirection: 'row',
    gap: 8,
  },
  memberCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  memberHeader: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  roleIndicator: {
    width: 4,
    borderRadius: 2,
    marginRight: 12,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  memberEmail: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  memberSites: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 8,
  },
  memberActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  actionBtn: {
    padding: 8,
  },
  emptyCard: {
    backgroundColor: COLORS.white,
    padding: 40,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalScrollContent: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    color: COLORS.textPrimary,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 8,
    marginBottom: 16,
    backgroundColor: COLORS.background,
  },
  picker: {
    height: 50,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkboxLabel: {
    fontSize: 16,
    color: COLORS.textPrimary,
    marginLeft: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: COLORS.gray200,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textSecondary,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
  },
});
