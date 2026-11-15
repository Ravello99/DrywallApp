import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Calendar } from 'react-native-calendars';
import { safetyService } from '../../src/services/safetyService';
import { siteService } from '../../src/services/siteService';
import { format } from 'date-fns';
import { SafetyDocument, Site } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';
import ModalPicker from '../../src/components/ModalPicker';

export default function SafetyScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [documents, setDocuments] = useState<SafetyDocument[]>([]);
  const [showUploadOptions, setShowUploadOptions] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [selectedExpiryDate, setSelectedExpiryDate] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [sitesRes, docsRes] = await Promise.all([
        siteService.getSites(),
        safetyService.getMyDocuments(),
      ]);
      
      setSites(sitesRes);
      if (sitesRes.length > 0 && !selectedSite) {
        setSelectedSite(sitesRes[0].id);
      }
      setDocuments(docsRes);
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

  const requestCameraPermission = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Camera permission is required');
      return false;
    }
    return true;
  };

  const requestMediaPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Media library permission is required');
      return false;
    }
    return true;
  };

  const handleTakePhoto = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return;

    setShowUploadOptions(false);

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      uploadDocument('photo', result.assets[0].base64, 'camera_photo.jpg');
    }
  };

  const handlePickImage = async () => {
    const hasPermission = await requestMediaPermission();
    if (!hasPermission) return;

    setShowUploadOptions(false);

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      const fileName = result.assets[0].uri.split('/').pop() || 'photo.jpg';
      uploadDocument('photo', result.assets[0].base64, fileName);
    }
  };

  const handlePickDocument = async () => {
    setShowUploadOptions(false);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets[0]) {
        const response = await fetch(result.assets[0].uri);
        const blob = await response.blob();
        const reader = new FileReader();
        
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          uploadDocument('pdf', base64, result.assets[0].name);
        };
        
        reader.readAsDataURL(blob);
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const uploadDocument = async (type: string, base64Data: string, fileName: string) => {
    if (!selectedSite) {
      Alert.alert('Error', 'Please select a site first');
      return;
    }

    if (!selectedExpiryDate) {
      Alert.alert('Error', 'Please select an expiry date first');
      return;
    }

    setUploading(true);
    try {
      await safetyService.uploadDocument({
        site_id: selectedSite,
        document_type: type,
        file_data: base64Data,
        file_name: fileName,
        description: `Uploaded via mobile app`,
        expiry_date: selectedExpiryDate,
      });

      Alert.alert('Success', 'Document uploaded successfully!');
      setSelectedExpiryDate('');
      loadData();
    } catch (error: any) {
      console.error('Upload error:', error);
      Alert.alert('Error', error.response?.data?.detail || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const handleDateSelect = (day: any) => {
    setSelectedExpiryDate(day.dateString);
    setShowCalendarModal(false);
  };

  const getExpiryColor = (doc: SafetyDocument) => {
    if (doc.is_expiring_critical) return COLORS.error;
    if (doc.is_expiring_soon) return COLORS.warning;
    return COLORS.success;
  };

  const getExpiryLabel = (doc: SafetyDocument) => {
    if (!doc.expiry_date) return 'No expiry';
    if (doc.is_expiring_critical) return `⚠️ ${doc.days_until_expiry} days left`;
    if (doc.is_expiring_soon) return `⚠ ${doc.days_until_expiry} days left`;
    return `${doc.days_until_expiry} days left`;
  };

  // Get today's date for the calendar
  const today = new Date().toISOString().split('T')[0];

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
        {/* Upload Section */}
        <View style={styles.uploadSection}>
          <Text style={styles.sectionTitle}>Upload Safety Documentation</Text>
          
          {/* Site Selector */}
          {sites.length > 0 && (
            <ModalPicker
              label="Select Site:"
              options={sites.map((site) => ({
                label: site.name,
                value: site.id,
              }))}
              selectedValue={selectedSite}
              onValueChange={(value) => setSelectedSite(value)}
              placeholder="Select a site"
            />
          )}

          {/* Expiry Date Selector with Calendar */}
          <View style={styles.dateSection}>
            <Text style={styles.label}>Document Expiry Date:</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => setShowCalendarModal(true)}
            >
              <MaterialIcons name="calendar-today" size={20} color={COLORS.primary} />
              <Text style={styles.dateButtonText}>
                {selectedExpiryDate 
                  ? format(new Date(selectedExpiryDate), 'MMMM dd, yyyy')
                  : 'Tap to select expiry date'
                }
              </Text>
              {selectedExpiryDate && (
                <TouchableOpacity
                  style={styles.clearDateButton}
                  onPress={() => setSelectedExpiryDate('')}
                >
                  <MaterialIcons name="close" size={18} color={COLORS.gray500} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Upload Options */}
          {showUploadOptions ? (
            <View style={styles.uploadOptions}>
              <TouchableOpacity style={styles.optionButton} onPress={handleTakePhoto}>
                <MaterialIcons name="camera-alt" size={32} color={COLORS.primary} />
                <Text style={styles.optionText}>Take Photo</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.optionButton} onPress={handlePickImage}>
                <MaterialIcons name="photo-library" size={32} color={COLORS.primary} />
                <Text style={styles.optionText}>Choose Photo</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.optionButton} onPress={handlePickDocument}>
                <MaterialIcons name="picture-as-pdf" size={32} color={COLORS.primary} />
                <Text style={styles.optionText}>Upload PDF</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.optionButton, styles.cancelButton]}
                onPress={() => setShowUploadOptions(false)}
              >
                <MaterialIcons name="close" size={32} color={COLORS.gray400} />
                <Text style={[styles.optionText, { color: COLORS.gray400 }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.uploadButton, 
                (uploading || !selectedSite || !selectedExpiryDate) && styles.buttonDisabled
              ]}
              onPress={() => setShowUploadOptions(true)}
              disabled={uploading || !selectedSite || !selectedExpiryDate}
            >
              {uploading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <MaterialIcons name="cloud-upload" size={24} color={COLORS.white} />
                  <Text style={styles.uploadButtonText}>Upload Document</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {!selectedExpiryDate && (
            <Text style={styles.helperText}>
              Please select an expiry date before uploading
            </Text>
          )}
        </View>

        {/* Documents List */}
        <View style={styles.documentsSection}>
          <Text style={styles.sectionTitle}>My Documents</Text>
          {documents.length > 0 ? (
            documents.map((doc) => (
              <View key={doc.id} style={styles.documentCard}>
                <View style={styles.documentHeader}>
                  <MaterialIcons
                    name={doc.document_type === 'pdf' ? 'picture-as-pdf' : 'image'}
                    size={32}
                    color={COLORS.primary}
                  />
                  <View style={styles.documentInfo}>
                    <Text style={styles.documentName}>{doc.file_name}</Text>
                    <Text style={styles.documentSite}>{doc.site_name}</Text>
                    <Text style={styles.documentDate}>
                      Uploaded: {format(new Date(doc.created_at), 'MMM dd, yyyy')}
                    </Text>
                    {doc.expiry_date && (
                      <Text style={[styles.expiryText, { color: getExpiryColor(doc) }]}>
                        {getExpiryLabel(doc)}
                      </Text>
                    )}
                  </View>
                </View>
                {doc.expiry_date && (
                  <View style={[styles.expiryBadge, { backgroundColor: getExpiryColor(doc) + '20', borderColor: getExpiryColor(doc) }]}>
                    <Text style={[styles.expiryBadgeText, { color: getExpiryColor(doc) }]}>
                      Expires: {format(new Date(doc.expiry_date), 'MMM dd, yyyy')}
                    </Text>
                  </View>
                )}
              </View>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <MaterialIcons name="folder-open" size={48} color={COLORS.gray300} />
              <Text style={styles.emptyText}>No documents uploaded yet</Text>
            </View>
          )}
        </View>

        <Footer />
      </ScrollView>

      {/* Calendar Modal */}
      <Modal visible={showCalendarModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Expiry Date</Text>
              <TouchableOpacity onPress={() => setShowCalendarModal(false)}>
                <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <Calendar
              minDate={today}
              onDayPress={handleDateSelect}
              markedDates={{
                [selectedExpiryDate]: {
                  selected: true,
                  selectedColor: COLORS.primary,
                },
              }}
              theme={{
                todayTextColor: COLORS.primary,
                selectedDayBackgroundColor: COLORS.primary,
                arrowColor: COLORS.primary,
                textDayFontWeight: '500',
                textMonthFontWeight: 'bold',
                textMonthFontSize: 16,
              }}
            />
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowCalendarModal(false)}
            >
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
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
  uploadSection: {
    padding: 16,
    backgroundColor: COLORS.white,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  dateSection: {
    marginBottom: 16,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 8,
    padding: 16,
    backgroundColor: COLORS.white,
    gap: 12,
  },
  dateButtonText: {
    fontSize: 16,
    color: COLORS.textPrimary,
    fontWeight: '600',
    flex: 1,
  },
  clearDateButton: {
    padding: 4,
  },
  helperText: {
    fontSize: 13,
    color: COLORS.warning,
    marginTop: 8,
    textAlign: 'center',
  },
  uploadOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    gap: 12,
  },
  optionButton: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primary,
    width: '45%',
  },
  cancelButton: {
    borderColor: COLORS.gray200,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    marginTop: 8,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  uploadButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  documentsSection: {
    padding: 16,
  },
  documentCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  documentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  documentInfo: {
    marginLeft: 12,
    flex: 1,
  },
  documentName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  documentSite: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  documentDate: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 4,
  },
  expiryText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  expiryBadge: {
    marginTop: 12,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  expiryBadgeText: {
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  modalCloseButton: {
    marginTop: 16,
    padding: 16,
    backgroundColor: COLORS.gray200,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textSecondary,
  },
});
