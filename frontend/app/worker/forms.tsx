import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Calendar } from 'react-native-calendars';
import * as ImagePicker from 'expo-image-picker';
import { formService } from '../../src/services/formService';
import { format } from 'date-fns';
import { FormAssignment, FormTemplate, FormField } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';

export default function WorkerFormsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [assignments, setAssignments] = useState<FormAssignment[]>([]);
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [showFormModal, setShowFormModal] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<FormAssignment | null>(null);
  const [selectedForm, setSelectedForm] = useState<FormTemplate | null>(null);
  const [formResponses, setFormResponses] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [assignmentsRes, formsRes] = await Promise.all([
        formService.getMyAssignments(),
        formService.getFormTemplates(),
      ]);
      setAssignments(assignmentsRes);
      setForms(formsRes);
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load forms');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const openForm = (assignment: FormAssignment) => {
    const form = forms.find(f => f.id === assignment.form_id);
    if (!form) {
      Alert.alert('Error', 'Form not found');
      return;
    }
    setSelectedAssignment(assignment);
    setSelectedForm(form);
    setFormResponses({});
    setShowFormModal(true);
  };

  const updateResponse = (fieldId: string, value: any) => {
    setFormResponses(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleTakePhoto = async (fieldId: string) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Camera permission is required');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      updateResponse(fieldId, result.assets[0].base64);
    }
  };

  const handleSubmitForm = async () => {
    if (!selectedForm) return;

    // Validate required fields
    for (const field of selectedForm.fields) {
      if (field.required && !formResponses[field.field_id]) {
        Alert.alert('Error', `Please fill in "${field.label}"`);
        return;
      }
    }

    setSubmitting(true);
    try {
      await formService.submitForm({
        form_id: selectedForm.id,
        responses: formResponses,
      });

      Alert.alert('Success', 'Form submitted successfully!');
      setShowFormModal(false);
      setSelectedForm(null);
      setSelectedAssignment(null);
      setFormResponses({});
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to submit form');
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (field: FormField) => {
    const value = formResponses[field.field_id];

    switch (field.field_type) {
      case 'text':
        return (
          <TextInput
            style={styles.textInput}
            placeholder={`Enter ${field.label.toLowerCase()}`}
            value={value || ''}
            onChangeText={(text) => updateResponse(field.field_id, text)}
            placeholderTextColor={COLORS.gray400}
            multiline
          />
        );

      case 'yesno':
        return (
          <View style={styles.yesNoContainer}>
            <TouchableOpacity
              style={[styles.yesNoButton, value === 'yes' && styles.yesNoButtonActive]}
              onPress={() => updateResponse(field.field_id, 'yes')}
            >
              <MaterialIcons
                name="check-circle"
                size={24}
                color={value === 'yes' ? COLORS.white : COLORS.success}
              />
              <Text style={[styles.yesNoText, value === 'yes' && styles.yesNoTextActive]}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.yesNoButton, value === 'no' && styles.yesNoButtonActiveNo]}
              onPress={() => updateResponse(field.field_id, 'no')}
            >
              <MaterialIcons
                name="cancel"
                size={24}
                color={value === 'no' ? COLORS.white : COLORS.error}
              />
              <Text style={[styles.yesNoText, value === 'no' && styles.yesNoTextActive]}>No</Text>
            </TouchableOpacity>
          </View>
        );

      case 'multiple_choice':
        return (
          <View style={styles.multipleChoiceContainer}>
            {field.options?.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.choiceOption, value === option && styles.choiceOptionActive]}
                onPress={() => updateResponse(field.field_id, option)}
              >
                <MaterialIcons
                  name={value === option ? 'radio-button-checked' : 'radio-button-unchecked'}
                  size={20}
                  color={value === option ? COLORS.primary : COLORS.gray400}
                />
                <Text style={styles.choiceText}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
        );

      case 'date':
        return (
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => {
              setActiveFieldId(field.field_id);
              setShowCalendarModal(true);
            }}
          >
            <MaterialIcons name="calendar-today" size={20} color={COLORS.primary} />
            <Text style={styles.dateButtonText}>
              {value ? format(new Date(value), 'MMMM dd, yyyy') : 'Select date'}
            </Text>
          </TouchableOpacity>
        );

      case 'photo':
        return (
          <View>
            <TouchableOpacity
              style={styles.photoButton}
              onPress={() => handleTakePhoto(field.field_id)}
            >
              <MaterialIcons name="camera-alt" size={24} color={COLORS.white} />
              <Text style={styles.photoButtonText}>
                {value ? 'Retake Photo' : 'Take Photo'}
              </Text>
            </TouchableOpacity>
            {value && (
              <View style={styles.photoPreviewContainer}>
                <MaterialIcons name="check-circle" size={20} color={COLORS.success} />
                <Text style={styles.photoPreviewText}>Photo captured</Text>
              </View>
            )}
          </View>
        );

      case 'signature':
        return (
          <View>
            <TouchableOpacity
              style={styles.signatureButton}
              onPress={() => {
                // For simplicity, we'll use a text input as a placeholder
                // In a real app, you'd use a signature pad component
                const signature = `Signed by user on ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;
                updateResponse(field.field_id, signature);
              }}
            >
              <MaterialIcons name="gesture" size={24} color={value ? COLORS.success : COLORS.primary} />
              <Text style={[styles.signatureButtonText, value && { color: COLORS.success }]}>
                {value ? 'Signature Captured' : 'Tap to Sign'}
              </Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
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
    <>
      <Stack.Screen
        options={{
          title: 'My Forms',
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
          {/* Pending Assignments */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Forms ({assignments.length})</Text>
            {assignments.length > 0 ? (
              assignments.map((assignment) => (
                <TouchableOpacity
                  key={assignment.assignment_id}
                  style={styles.assignmentCard}
                  onPress={() => openForm(assignment)}
                >
                  <MaterialIcons name="description" size={32} color={COLORS.primary} />
                  <View style={styles.assignmentInfo}>
                    <Text style={styles.assignmentTitle}>{assignment.form_title}</Text>
                    {assignment.form_description && (
                      <Text style={styles.assignmentDescription}>{assignment.form_description}</Text>
                    )}
                    <Text style={styles.assignmentDate}>
                      Assigned: {format(new Date(assignment.assigned_at), 'MMM dd, yyyy')}
                    </Text>
                    {assignment.due_date && (
                      <Text style={styles.dueDate}>
                        Due: {format(new Date(assignment.due_date), 'MMM dd, yyyy')}
                      </Text>
                    )}
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color={COLORS.gray400} />
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <MaterialIcons name="description" size={48} color={COLORS.gray300} />
                <Text style={styles.emptyText}>No pending forms</Text>
                <Text style={styles.emptySubtext}>All forms have been completed</Text>
              </View>
            )}
          </View>

          <Footer />
        </ScrollView>

        {/* Form Fill Modal */}
        <Modal visible={showFormModal} animationType="slide">
          <SafeAreaView style={styles.formModalContainer}>
            <View style={styles.formModalHeader}>
              <TouchableOpacity
                onPress={() => {
                  setShowFormModal(false);
                  setSelectedForm(null);
                  setSelectedAssignment(null);
                  setFormResponses({});
                }}
              >
                <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.formModalTitle}>{selectedForm?.title}</Text>
              <View style={{ width: 24 }} />
            </View>

            <ScrollView style={styles.formContent}>
              {selectedForm?.description && (
                <Text style={styles.formDescription}>{selectedForm.description}</Text>
              )}

              {selectedForm?.fields.map((field) => (
                <View key={field.field_id} style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>
                    {field.label}
                    {field.required && <Text style={styles.requiredStar}> *</Text>}
                  </Text>
                  {renderField(field)}
                </View>
              ))}

              <TouchableOpacity
                style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                onPress={handleSubmitForm}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <>
                    <MaterialIcons name="send" size={20} color={COLORS.white} />
                    <Text style={styles.submitButtonText}>Submit Form</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {/* Calendar Modal */}
        <Modal visible={showCalendarModal} animationType="slide" transparent>
          <View style={styles.calendarModalOverlay}>
            <View style={styles.calendarModalContent}>
              <View style={styles.calendarModalHeader}>
                <Text style={styles.calendarModalTitle}>Select Date</Text>
                <TouchableOpacity onPress={() => setShowCalendarModal(false)}>
                  <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
                </TouchableOpacity>
              </View>
              <Calendar
                onDayPress={(day: any) => {
                  updateResponse(activeFieldId, day.dateString);
                  setShowCalendarModal(false);
                }}
                markedDates={{
                  [formResponses[activeFieldId] || '']: {
                    selected: true,
                    selectedColor: COLORS.primary,
                  },
                }}
                theme={{
                  todayTextColor: COLORS.primary,
                  selectedDayBackgroundColor: COLORS.primary,
                  arrowColor: COLORS.primary,
                }}
              />
            </View>
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
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  assignmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  assignmentInfo: {
    flex: 1,
    marginLeft: 12,
  },
  assignmentTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  assignmentDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  assignmentDate: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 6,
  },
  dueDate: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 2,
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
  formModalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  formModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  formModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  formContent: {
    flex: 1,
    padding: 16,
  },
  formDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
    padding: 12,
    backgroundColor: COLORS.white,
    borderRadius: 8,
  },
  fieldContainer: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  requiredStar: {
    color: COLORS.error,
  },
  textInput: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.textPrimary,
    minHeight: 50,
  },
  yesNoContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  yesNoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.gray200,
    gap: 8,
  },
  yesNoButtonActive: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  yesNoButtonActiveNo: {
    backgroundColor: COLORS.error,
    borderColor: COLORS.error,
  },
  yesNoText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  yesNoTextActive: {
    color: COLORS.white,
  },
  multipleChoiceContainer: {
    gap: 8,
  },
  choiceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    gap: 12,
  },
  choiceOptionActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  choiceText: {
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    gap: 12,
  },
  dateButtonText: {
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    gap: 8,
  },
  photoButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  photoPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 6,
  },
  photoPreviewText: {
    fontSize: 14,
    color: COLORS.success,
    fontWeight: '600',
  },
  signatureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.gray200,
    borderStyle: 'dashed',
    gap: 8,
  },
  signatureButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    marginTop: 20,
    marginBottom: 40,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  calendarModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  calendarModalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
  },
  calendarModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  calendarModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
});
