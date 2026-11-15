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
import { announcementService } from '../../src/services/announcementService';
import { siteService } from '../../src/services/siteService';
import { format } from 'date-fns';
import { Announcement, Site } from '../../src/types';
import { COLORS, ANNOUNCEMENT_COLORS } from '../../src/constants/colors';
import ModalPicker from '../../src/components/ModalPicker';

export default function AnnouncementsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);

  // Form fields
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [announcementType, setAnnouncementType] = useState<string>('general');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [sitesRes, announcementsRes] = await Promise.all([
        siteService.getSites(),
        announcementService.getAnnouncements(),
      ]);
      setSites(sitesRes);
      if (sitesRes.length > 0 && !selectedSite) {
        setSelectedSite(sitesRes[0].id);
      }
      setAnnouncements(announcementsRes);
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

  const resetForm = () => {
    if (sites.length > 0) {
      setSelectedSite(sites[0].id);
    }
    setTitle('');
    setContent('');
    setAnnouncementType('general');
    setEditingAnnouncement(null);
  };

  const handleCreate = async () => {
    if (!title || !content) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    setActionLoading(true);
    try {
      await announcementService.createAnnouncement({
        site_id: selectedSite,
        title,
        content,
        announcement_type: announcementType,
      });

      Alert.alert('Success', 'Announcement posted successfully!');
      setShowModal(false);
      resetForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create announcement');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingAnnouncement) return;

    setActionLoading(true);
    try {
      await announcementService.updateAnnouncement(editingAnnouncement.id, {
        title,
        content,
        announcement_type: announcementType,
      });

      Alert.alert('Success', 'Announcement updated successfully!');
      setShowModal(false);
      resetForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to update announcement');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEdit = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    setSelectedSite(announcement.site_id);
    setTitle(announcement.title);
    setContent(announcement.content);
    setAnnouncementType(announcement.announcement_type);
    setShowModal(true);
  };

  const handleDelete = (announcement: Announcement) => {
    Alert.alert(
      'Delete Announcement',
      'Are you sure you want to delete this announcement?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await announcementService.deleteAnnouncement(announcement.id);
              Alert.alert('Success', 'Announcement deleted');
              loadData();
            } catch (error: any) {
              Alert.alert('Error', 'Failed to delete announcement');
            }
          },
        },
      ]
    );
  };

  const getAnnouncementColor = (type: string) => {
    return ANNOUNCEMENT_COLORS[type as keyof typeof ANNOUNCEMENT_COLORS] || ANNOUNCEMENT_COLORS.general;
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'site_instruction':
        return 'Site Instruction';
      case 'hazard':
        return 'Hazard';
      case 'general':
      default:
        return 'General';
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
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => {
            resetForm();
            setShowModal(true);
          }}
        >
          <MaterialIcons name="add" size={24} color={COLORS.white} />
          <Text style={styles.createButtonText}>New Announcement</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
      >
        {announcements.length > 0 ? (
          announcements.map((announcement) => {
            const colors = getAnnouncementColor(announcement.announcement_type);
            return (
              <View
                key={announcement.id}
                style={[
                  styles.announcementCard,
                  { backgroundColor: colors.bg, borderLeftColor: colors.border },
                ]}
              >
                <View style={styles.announcementHeader}>
                  <View style={styles.headerLeft}>
                    <MaterialIcons name="campaign" size={24} color={colors.text} />
                    <View style={styles.headerInfo}>
                      <View style={[styles.typeBadge, { backgroundColor: colors.border }]}>
                        <Text style={[styles.typeText, { color: COLORS.white }]}>
                          {getTypeLabel(announcement.announcement_type)}
                        </Text>
                      </View>
                      <Text style={styles.siteBadge}>{announcement.site_name}</Text>
                    </View>
                  </View>
                  <Text style={styles.date}>
                    {format(new Date(announcement.created_at), 'MMM dd, h:mm a')}
                  </Text>
                </View>

                <Text style={styles.announcementTitle}>{announcement.title}</Text>
                <Text style={styles.announcementContent}>{announcement.content}</Text>

                <View style={styles.footer}>
                  <Text style={styles.author}>By: {announcement.created_by_name}</Text>
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleEdit(announcement)}
                    >
                      <MaterialIcons name="edit" size={20} color={COLORS.info} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleDelete(announcement)}
                    >
                      <MaterialIcons name="delete" size={20} color={COLORS.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.emptyCard}>
            <MaterialIcons name="campaign" size={64} color={COLORS.gray300} />
            <Text style={styles.emptyTitle}>No Announcements</Text>
            <Text style={styles.emptyText}>Create your first announcement for workers</Text>
          </View>
        )}
      </ScrollView>

      {/* Create/Edit Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingAnnouncement ? 'Edit Announcement' : 'New Announcement'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowModal(false);
                  resetForm();
                }}
              >
                <MaterialIcons name="close" size={28} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={styles.label}>Announcement Type:</Text>
              <View style={styles.typeSelector}>
                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    announcementType === 'general' && styles.typeOptionActive,
                    { borderColor: COLORS.general },
                  ]}
                  onPress={() => setAnnouncementType('general')}
                >
                  <View style={[styles.typeIndicator, { backgroundColor: COLORS.general }]} />
                  <Text style={styles.typeOptionText}>General</Text>
                  {announcementType === 'general' && (
                    <MaterialIcons name="check-circle" size={20} color={COLORS.general} />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    announcementType === 'site_instruction' && styles.typeOptionActive,
                    { borderColor: COLORS.siteInstruction },
                  ]}
                  onPress={() => setAnnouncementType('site_instruction')}
                >
                  <View style={[styles.typeIndicator, { backgroundColor: COLORS.siteInstruction }]} />
                  <Text style={styles.typeOptionText}>Site Instruction</Text>
                  {announcementType === 'site_instruction' && (
                    <MaterialIcons name="check-circle" size={20} color={COLORS.siteInstruction} />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    announcementType === 'hazard' && styles.typeOptionActive,
                    { borderColor: COLORS.hazard },
                  ]}
                  onPress={() => setAnnouncementType('hazard')}
                >
                  <View style={[styles.typeIndicator, { backgroundColor: COLORS.hazard }]} />
                  <Text style={styles.typeOptionText}>Hazard Warning</Text>
                  {announcementType === 'hazard' && (
                    <MaterialIcons name="check-circle" size={20} color={COLORS.hazard} />
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Select Site:</Text>
              <ModalPicker
                options={sites.map((site) => ({
                  label: site.name,
                  value: site.id,
                }))}
                selectedValue={selectedSite}
                onValueChange={setSelectedSite}
                placeholder="Select a site"
                disabled={!!editingAnnouncement}
              />

              <Text style={styles.label}>Title:</Text>
              <TextInput
                style={styles.input}
                placeholder="Announcement title"
                value={title}
                onChangeText={setTitle}
                placeholderTextColor={COLORS.gray400}
              />

              <Text style={styles.label}>Content:</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Announcement details..."
                value={content}
                onChangeText={setContent}
                multiline
                numberOfLines={6}
                placeholderTextColor={COLORS.gray400}
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.submitButton]}
                  onPress={editingAnnouncement ? handleUpdate : handleCreate}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <ActivityIndicator color={COLORS.white} />
                  ) : (
                    <Text style={styles.submitButtonText}>
                      {editingAnnouncement ? 'Update' : 'Post'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
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
  header: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  createButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  content: {
    padding: 16,
  },
  announcementCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
  },
  announcementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    flex: 1,
  },
  headerInfo: {
    marginLeft: 12,
    flex: 1,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
  },
  typeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  siteBadge: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  date: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  announcementTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  announcementContent: {
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.gray200,
    paddingTop: 8,
  },
  author: {
    fontSize: 12,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    padding: 8,
  },
  emptyCard: {
    backgroundColor: COLORS.white,
    padding: 48,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textLight,
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 8,
    textAlign: 'center',
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
    maxHeight: '90%',
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
  modalBody: {
    padding: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  typeSelector: {
    marginBottom: 16,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    marginBottom: 8,
    backgroundColor: COLORS.white,
  },
  typeOptionActive: {
    backgroundColor: COLORS.background,
  },
  typeIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 12,
  },
  typeOptionText: {
    fontSize: 16,
    color: COLORS.textPrimary,
    flex: 1,
    fontWeight: '600',
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    marginBottom: 16,
  },
  picker: {
    height: 50,
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
  textArea: {
    height: 120,
    textAlignVertical: 'top',
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
