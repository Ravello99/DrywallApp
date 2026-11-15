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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { userService } from '../../src/services/userService';
import { siteService } from '../../src/services/siteService';
import { User, Site, UserRole } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';
import ModalPicker from '../../src/components/ModalPicker';

const WORKER_ROLES: { value: UserRole; label: string }[] = [
  { value: 'apprentice', label: 'Apprentice' },
  { value: 'journeyman', label: 'Journeyman' },
  { value: 'lead_hand', label: 'Lead-Hand' },
  { value: 'foreman', label: 'Foreman' },
];

const ALL_ROLES: { value: UserRole; label: string }[] = [
  ...WORKER_ROLES,
  { value: 'manager', label: 'Manager' },
];

const getRoleLabel = (role: string): string => {
  const found = ALL_ROLES.find(r => r.value === role);
  return found?.label || role;
};

const getRoleColor = (role: string): string => {
  switch (role) {
    case 'manager':
      return COLORS.primary;
    case 'foreman':
      return '#4CAF50';
    case 'lead_hand':
      return '#2196F3';
    case 'journeyman':
      return '#9C27B0';
    case 'apprentice':
      return '#FF9800';
    default:
      return COLORS.gray500;
  }
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
  const [memberRole, setMemberRole] = useState<UserRole>('apprentice');
  const [selectedSites, setSelectedSites] = useState<string[]>([]);

  // Site form
  const [siteName, setSiteName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');

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
    setMemberRole('apprentice');
    setSelectedSites([]);
    setSelectedMember(null);
  };

  const resetSiteForm = () => {
    setSiteName('');
    setSiteAddress('');
    setSelectedSiteForEdit(null);
  };

  const handleAddMember = async () => {
    if (!memberName || !memberEmail || !memberPassword) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }

    setActionLoading(true);
    try {
      await userService.createUser({
        name: memberName,
        email: memberEmail,
        password: memberPassword,
        role: memberRole,
        assigned_sites: memberRole === 'manager' ? [] : selectedSites,
      });

      Alert.alert('Success', `${getRoleLabel(memberRole)} added successfully!`);
      setShowAddMember(false);
      resetMemberForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to add member');
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
    setShowEditMember(true);
  };

  const handleUpdateMember = async () => {
    if (!selectedMember) return;

    setActionLoading(true);
    try {
      await userService.updateUser(selectedMember.id, {
        name: memberName,
        email: memberEmail,
        role: memberRole,
        assigned_sites: memberRole === 'manager' ? [] : selectedSites,
        ...(memberPassword && { password: memberPassword }),
      });

      Alert.alert('Success', 'Member updated successfully!');
      setShowEditMember(false);
      resetMemberForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update member');
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
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    setActionLoading(true);
    try {
      await siteService.createSite({
        name: siteName,
        address: siteAddress,
        status: 'active',
      });

      Alert.alert('Success', 'Site added successfully!');
      setShowAddSite(false);
      resetSiteForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to add site');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditSite = (site: Site) => {
    setSelectedSiteForEdit(site);
    setSiteName(site.name);
    setSiteAddress(site.address);
    setShowEditSite(true);
  };

  const handleUpdateSite = async () => {
    if (!selectedSiteForEdit) return;
    
    if (!siteName || !siteAddress) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    setActionLoading(true);
    try {
      await siteService.updateSite(selectedSiteForEdit.id, {
        name: siteName,
        address: siteAddress,
      });

      Alert.alert('Success', 'Site updated successfully!');
      setShowEditSite(false);
      resetSiteForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update site');
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
  const managers = members.filter(m => m.role === 'manager');
  const workers = members.filter(m => m.role !== 'manager');

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
                  <Text style={styles.siteName}>{site.name}</Text>
                  <Text style={styles.siteAddress}>{site.address}</Text>
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
              <Text style={styles.sectionTitle}>Managers ({managers.length})</Text>
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
            <Text style={styles.sectionTitle}>Team Members ({workers.length})</Text>
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
                    <Text style={styles.memberSites}>
                      {member.assigned_sites?.length || 0} site(s) assigned
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
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add New Site</Text>
            <TextInput
              style={styles.input}
              placeholder="Site Name"
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
        </View>
      </Modal>

      {/* Edit Site Modal */}
      <Modal visible={showEditSite} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Site</Text>
            <TextInput
              style={styles.input}
              placeholder="Site Name"
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
                placeholder={showEditMember ? 'New Password (optional)' : 'Password'}
                value={memberPassword}
                onChangeText={setMemberPassword}
                secureTextEntry
                placeholderTextColor={COLORS.gray400}
              />
              
              <Text style={styles.label}>Select Role:</Text>
              <ModalPicker
                options={ALL_ROLES.map((role) => ({
                  label: role.label,
                  value: role.value,
                }))}
                selectedValue={memberRole}
                onValueChange={(value) => setMemberRole(value as UserRole)}
                placeholder="Select a role"
              />
              
              {memberRole !== 'manager' && (
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
