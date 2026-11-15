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
import ModalPicker from '../../src/components/ModalPicker';
import { Stack, useRouter } from 'expo-router';
import { formService } from '../../src/services/formService';
import { userService } from '../../src/services/userService';
import { siteService } from '../../src/services/siteService';
import { format } from 'date-fns';
import { FormTemplate, FormField, User, Site, FormSubmission } from '../../src/types';
import { isFieldRole } from '../../src/constants/roles';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';

const FIELD_TYPES = [
  { value: 'text', label: 'Text Input', icon: 'text-fields' },
  { value: 'yesno', label: 'Yes/No', icon: 'check-circle' },
  { value: 'multiple_choice', label: 'Multiple Choice', icon: 'list' },
  { value: 'date', label: 'Date', icon: 'calendar-today' },
  { value: 'photo', label: 'Photo', icon: 'camera-alt' },
  { value: 'signature', label: 'Signature', icon: 'gesture' },
];

export default function FormsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showSubmissionsModal, setShowSubmissionsModal] = useState(false);
  const [selectedForm, setSelectedForm] = useState<FormTemplate | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form builder state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSite, setFormSite] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);
  
  // Field state
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldOptions, setFieldOptions] = useState('');

  // Assignment state
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [formsRes, usersRes, sitesRes, submissionsRes] = await Promise.all([
        formService.getFormTemplates(),
        userService.getUsers(),
        siteService.getSites(),
        formService.getFormSubmissions(),
      ]);
      setForms(formsRes);
      setUsers(usersRes.filter((u: User) => isFieldRole(u.role)));
      setSites(sitesRes);
      setSubmissions(submissionsRes);
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

  const resetFormBuilder = () => {
    setFormTitle('');
    setFormDescription('');
    setFormSite('');
    setFields([]);
  };

  const addField = () => {
    if (!fieldLabel) {
      Alert.alert('Error', 'Please enter a field label');
      return;
    }

    const newField: FormField = {
      field_id: `field_${Date.now()}`,
      field_type: fieldType as any,
      label: fieldLabel,
      required: fieldRequired,
      options: fieldType === 'multiple_choice' ? fieldOptions.split(',').map(o => o.trim()).filter(o => o) : undefined,
    };

    setFields([...fields, newField]);
    setFieldLabel('');
    setFieldType('text');
    setFieldRequired(false);
    setFieldOptions('');
    setShowAddFieldModal(false);
  };

  const removeField = (fieldId: string) => {
    setFields(fields.filter(f => f.field_id !== fieldId));
  };

  const handleCreateForm = async () => {
    if (!formTitle || fields.length === 0) {
      Alert.alert('Error', 'Please enter a title and add at least one field');
      return;
    }

    setActionLoading(true);
    try {
      await formService.createFormTemplate({
        title: formTitle,
        description: formDescription || undefined,
        fields,
        site_id: formSite || undefined,
      });

      Alert.alert('Success', 'Form created successfully!');
      setShowCreateModal(false);
      resetFormBuilder();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create form');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAssignForm = async () => {
    if (!selectedForm || selectedUsers.length === 0) {
      Alert.alert('Error', 'Please select at least one team member');
      return;
    }

    setActionLoading(true);
    try {
      await formService.assignForm({
        form_id: selectedForm.id,
        assigned_to: selectedUsers,
      });

      Alert.alert('Success', `Form assigned to ${selectedUsers.length} team member(s)`);
      setShowAssignModal(false);
      setSelectedUsers([]);
      setSelectedForm(null);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to assign form');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteForm = (form: FormTemplate) => {
    Alert.alert(
      'Delete Form',
      `Are you sure you want to delete "${form.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await formService.deleteFormTemplate(form.id);
              Alert.alert('Success', 'Form deleted');
              loadData();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete form');
            }
          },
        },
      ]
    );
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const getFieldIcon = (type: string) => {
    const found = FIELD_TYPES.find(f => f.value === type);
    return found?.icon || 'text-fields';
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Custom Forms',
          headerStyle: { backgroundColor: COLORS.primary },
          headerTintColor: COLORS.white,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 8 }}>
              <MaterialIcons name="arrow-back" size={24} color={COLORS.white} />
            </TouchableOpacity>
          ),
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Form Templates ({forms.length})</Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => setShowCreateModal(true)}
            >
              <MaterialIcons name="add" size={24} color={COLORS.white} />
              <Text style={styles.createButtonText}>Create Form</Text>
            </TouchableOpacity>
          </View>

          {/* Submissions Summary */}
          {submissions.length > 0 && (
            <TouchableOpacity
              style={styles.submissionsCard}
              onPress={() => setShowSubmissionsModal(true)}
            >
              <MaterialIcons name="inbox" size={24} color={COLORS.primary} />
              <View style={styles.submissionsInfo}>
                <Text style={styles.submissionsTitle}>Form Submissions</Text>
                <Text style={styles.submissionsCount}>{submissions.length} submission(s) received</Text>
              </View>
              <MaterialIcons name="chevron-right" size={24} color={COLORS.gray400} />
            </TouchableOpacity>
          )}

          {/* Forms List */}
          <View style={styles.formsSection}>
            {forms.length > 0 ? (
              forms.map((form) => (
                <View key={form.id} style={styles.formCard}>
                  <View style={styles.formHeader}>
                    <MaterialIcons name="description" size={32} color={COLORS.primary} />
                    <View style={styles.formInfo}>
                      <Text style={styles.formTitle}>{form.title}</Text>
                      {form.description && (
                        <Text style={styles.formDescription}>{form.description}</Text>
                      )}
                      <Text style={styles.formMeta}>
                        {form.fields.length} field(s) • Created {format(new Date(form.created_at), 'MMM dd')}
                      </Text>
                      {form.site_name && (
                        <Text style={styles.formSite}>📍 {form.site_name}</Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.formActions}>
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: COLORS.success + '20' }]}
                      onPress={() => {
                        setSelectedForm(form);
                        setShowAssignModal(true);
                      }}
                    >
                      <MaterialIcons name="person-add" size={18} color={COLORS.success} />
                      <Text style={[styles.actionText, { color: COLORS.success }]}>Assign</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: COLORS.error + '20' }]}
                      onPress={() => handleDeleteForm(form)}
                    >
                      <MaterialIcons name="delete" size={18} color={COLORS.error} />
                      <Text style={[styles.actionText, { color: COLORS.error }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <MaterialIcons name="description" size={48} color={COLORS.gray300} />
                <Text style={styles.emptyText}>No forms created yet</Text>
                <Text style={styles.emptySubtext}>Create your first custom form</Text>
              </View>
            )}
          </View>

          <Footer />
        </ScrollView>

        {/* Create Form Modal */}
        <Modal visible={showCreateModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <ScrollView style={styles.modalScrollContent}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Create Custom Form</Text>

                <Text style={styles.label}>Form Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter form title"
                  value={formTitle}
                  onChangeText={setFormTitle}
                  placeholderTextColor={COLORS.gray400}
                />

                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter form description"
                  value={formDescription}
                  onChangeText={setFormDescription}
                  multiline
                  placeholderTextColor={COLORS.gray400}
                />

                <Text style={styles.label}>Site (Optional)</Text>
                <ModalPicker
                  options={[
                    { label: 'All Sites (General)', value: '' },
                    ...sites.map((site) => ({ label: site.name, value: site.id })),
                  ]}
                  selectedValue={formSite}
                  onValueChange={setFormSite}
                  placeholder="Select a site"
                />

                {/* Fields List */}
                <View style={styles.fieldsSection}>
                  <View style={styles.fieldsSectionHeader}>
                    <Text style={styles.label}>Form Fields ({fields.length})</Text>
                    <TouchableOpacity
                      style={styles.addFieldButton}
                      onPress={() => setShowAddFieldModal(true)}
                    >
                      <MaterialIcons name="add" size={20} color={COLORS.white} />
                      <Text style={styles.addFieldText}>Add Field</Text>
                    </TouchableOpacity>
                  </View>

                  {fields.map((field, index) => (
                    <View key={field.field_id} style={styles.fieldItem}>
                      <MaterialIcons name={getFieldIcon(field.field_type) as any} size={20} color={COLORS.primary} />
                      <View style={styles.fieldItemInfo}>
                        <Text style={styles.fieldItemLabel}>{field.label}</Text>
                        <Text style={styles.fieldItemType}>
                          {field.field_type} {field.required && '(Required)'}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => removeField(field.field_id)}>
                        <MaterialIcons name="close" size={20} color={COLORS.error} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => {
                      setShowCreateModal(false);
                      resetFormBuilder();
                    }}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.submitButton]}
                    onPress={handleCreateForm}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <ActivityIndicator color={COLORS.white} />
                    ) : (
                      <Text style={styles.submitButtonText}>Create Form</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </Modal>

        {/* Add Field Modal */}
        <Modal visible={showAddFieldModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Add Form Field</Text>

              <Text style={styles.label}>Field Label *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Worker Name, Inspection Date"
                value={fieldLabel}
                onChangeText={setFieldLabel}
                placeholderTextColor={COLORS.gray400}
              />

              <Text style={styles.label}>Field Type</Text>
              <ModalPicker
                options={FIELD_TYPES.map((type) => ({ label: type.label, value: type.value }))}
                selectedValue={fieldType}
                onValueChange={setFieldType}
                placeholder="Select field type"
              />

              {fieldType === 'multiple_choice' && (
                <>
                  <Text style={styles.label}>Options (comma separated)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Option 1, Option 2, Option 3"
                    value={fieldOptions}
                    onChangeText={setFieldOptions}
                    placeholderTextColor={COLORS.gray400}
                  />
                </>
              )}

              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setFieldRequired(!fieldRequired)}
              >
                <MaterialIcons
                  name={fieldRequired ? 'check-box' : 'check-box-outline-blank'}
                  size={24}
                  color={fieldRequired ? COLORS.primary : COLORS.gray400}
                />
                <Text style={styles.checkboxLabel}>Required field</Text>
              </TouchableOpacity>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    setShowAddFieldModal(false);
                    setFieldLabel('');
                    setFieldType('text');
                    setFieldRequired(false);
                    setFieldOptions('');
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.submitButton]}
                  onPress={addField}
                >
                  <Text style={styles.submitButtonText}>Add Field</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Assign Form Modal */}
        <Modal visible={showAssignModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <ScrollView style={styles.modalScrollContent}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Assign Form</Text>
                {selectedForm && (
                  <Text style={styles.assignFormName}>"{selectedForm.title}"</Text>
                )}

                <Text style={styles.label}>Select Team Members:</Text>
                {users.map((user) => (
                  <TouchableOpacity
                    key={user.id}
                    style={styles.checkboxRow}
                    onPress={() => toggleUserSelection(user.id)}
                  >
                    <MaterialIcons
                      name={selectedUsers.includes(user.id) ? 'check-box' : 'check-box-outline-blank'}
                      size={24}
                      color={selectedUsers.includes(user.id) ? COLORS.primary : COLORS.gray400}
                    />
                    <Text style={styles.checkboxLabel}>{user.name}</Text>
                  </TouchableOpacity>
                ))}

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => {
                      setShowAssignModal(false);
                      setSelectedUsers([]);
                      setSelectedForm(null);
                    }}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.submitButton]}
                    onPress={handleAssignForm}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <ActivityIndicator color={COLORS.white} />
                    ) : (
                      <Text style={styles.submitButtonText}>Assign Form</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </Modal>

        {/* View Submissions Modal */}
        <Modal visible={showSubmissionsModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <ScrollView style={styles.modalScrollContent}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Form Submissions</Text>
                  <TouchableOpacity onPress={() => setShowSubmissionsModal(false)}>
                    <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
                  </TouchableOpacity>
                </View>

                {submissions.map((sub) => (
                  <View key={sub.id} style={styles.submissionItem}>
                    <Text style={styles.submissionFormTitle}>{sub.form_title}</Text>
                    <Text style={styles.submissionUser}>By: {sub.user_name}</Text>
                    <Text style={styles.submissionDate}>
                      {format(new Date(sub.submitted_at), 'MMM dd, yyyy h:mm a')}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </Modal>
      </SafeAreaView>
    </>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.white,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  createButtonText: {
    color: COLORS.white,
    fontWeight: 'bold',
  },
  submissionsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
  },
  submissionsInfo: {
    flex: 1,
    marginLeft: 12,
  },
  submissionsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  submissionsCount: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  formsSection: {
    padding: 16,
  },
  formCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  formHeader: {
    flexDirection: 'row',
  },
  formInfo: {
    flex: 1,
    marginLeft: 12,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  formDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  formMeta: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 6,
  },
  formSite: {
    fontSize: 12,
    color: COLORS.primary,
    marginTop: 4,
  },
  formActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  actionText: {
    fontSize: 13,
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
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
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
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 20,
  },
  assignFormName: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
    marginBottom: 16,
    marginTop: -12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
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
    height: 80,
    textAlignVertical: 'top',
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
  fieldsSection: {
    marginTop: 8,
  },
  fieldsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addFieldButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  addFieldText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  fieldItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  fieldItemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  fieldItemLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  fieldItemType: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  checkboxLabel: {
    fontSize: 16,
    color: COLORS.textPrimary,
    marginLeft: 12,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
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
  submissionItem: {
    backgroundColor: COLORS.background,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  submissionFormTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  submissionUser: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  submissionDate: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
});
