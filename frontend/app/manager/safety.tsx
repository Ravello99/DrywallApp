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
  Image,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { safetyService } from '../../src/services/safetyService';
import { siteService } from '../../src/services/siteService';
import { format, differenceInDays } from 'date-fns';
import { SafetyDocument, Site } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';

type ExpiryFilter = 'all' | 'critical' | 'warning' | 'safe';

export default function SafetyReviewScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [documents, setDocuments] = useState<SafetyDocument[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');
  const [selectedDoc, setSelectedDoc] = useState<SafetyDocument | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showSiteModal, setShowSiteModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [sitesRes, docsRes] = await Promise.all([
        siteService.getSites(),
        safetyService.getAllDocuments(),
      ]);
      setSites(sitesRes);
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

  const handleSiteFilter = async (site: Site | null) => {
    setSelectedSite(site);
    setShowSiteModal(false);
  };

  const getExpiryStatus = (doc: SafetyDocument): { status: ExpiryFilter; color: string; label: string } => {
    if (!doc.expiry_date) {
      return { status: 'safe', color: COLORS.gray400, label: 'No Expiry' };
    }
    
    const daysUntil = doc.days_until_expiry ?? differenceInDays(new Date(doc.expiry_date), new Date());
    
    if (daysUntil <= 30) {
      return { status: 'critical', color: COLORS.error, label: `${daysUntil} days - CRITICAL` };
    } else if (daysUntil <= 60) {
      return { status: 'warning', color: '#FF9800', label: `${daysUntil} days - WARNING` };
    } else {
      return { status: 'safe', color: COLORS.success, label: `${daysUntil} days` };
    }
  };

  const filteredDocuments = documents.filter((doc) => {
    // Site filter
    if (selectedSite && doc.site_id !== selectedSite.id) {
      return false;
    }
    
    // Expiry filter
    if (expiryFilter === 'all') return true;
    
    const { status } = getExpiryStatus(doc);
    return status === expiryFilter;
  });

  // Count documents by expiry status
  const counts = {
    all: documents.filter(d => !selectedSite || d.site_id === selectedSite?.id).length,
    critical: documents.filter(d => {
      if (selectedSite && d.site_id !== selectedSite.id) return false;
      return getExpiryStatus(d).status === 'critical';
    }).length,
    warning: documents.filter(d => {
      if (selectedSite && d.site_id !== selectedSite.id) return false;
      return getExpiryStatus(d).status === 'warning';
    }).length,
    safe: documents.filter(d => {
      if (selectedSite && d.site_id !== selectedSite.id) return false;
      return getExpiryStatus(d).status === 'safe';
    }).length,
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
      {/* Header Filters */}
      <View style={styles.header}>
        <View style={styles.filterSection}>
          <Text style={styles.label}>Filter by Site:</Text>
          <TouchableOpacity
            style={styles.siteSelector}
            onPress={() => setShowSiteModal(true)}
          >
            <MaterialIcons name="location-city" size={20} color={COLORS.primary} />
            <Text style={styles.siteSelectorText}>
              {selectedSite ? selectedSite.name : 'All Sites'}
            </Text>
            <MaterialIcons name="arrow-drop-down" size={24} color={COLORS.gray500} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Expiry Filter Tabs */}
      <View style={styles.filterTabs}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            style={[styles.filterTab, expiryFilter === 'all' && styles.filterTabActive]}
            onPress={() => setExpiryFilter('all')}
          >
            <Text style={[styles.filterTabText, expiryFilter === 'all' && styles.filterTabTextActive]}>
              All ({counts.all})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, styles.filterTabCritical, expiryFilter === 'critical' && styles.filterTabCriticalActive]}
            onPress={() => setExpiryFilter('critical')}
          >
            <MaterialIcons name="error" size={16} color={expiryFilter === 'critical' ? COLORS.white : COLORS.error} />
            <Text style={[styles.filterTabText, styles.filterTabTextCritical, expiryFilter === 'critical' && styles.filterTabTextActive]}>
              Critical ({counts.critical})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, styles.filterTabWarning, expiryFilter === 'warning' && styles.filterTabWarningActive]}
            onPress={() => setExpiryFilter('warning')}
          >
            <MaterialIcons name="warning" size={16} color={expiryFilter === 'warning' ? COLORS.white : '#FF9800'} />
            <Text style={[styles.filterTabText, styles.filterTabTextWarning, expiryFilter === 'warning' && styles.filterTabTextActive]}>
              30-60 Days ({counts.warning})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, styles.filterTabSafe, expiryFilter === 'safe' && styles.filterTabSafeActive]}
            onPress={() => setExpiryFilter('safe')}
          >
            <MaterialIcons name="check-circle" size={16} color={expiryFilter === 'safe' ? COLORS.white : COLORS.success} />
            <Text style={[styles.filterTabText, styles.filterTabTextSafe, expiryFilter === 'safe' && styles.filterTabTextActive]}>
              OK ({counts.safe})
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Alert Banner for Critical/Warning */}
      {(counts.critical > 0 || counts.warning > 0) && expiryFilter === 'all' && (
        <View style={styles.alertBanner}>
          {counts.critical > 0 && (
            <View style={[styles.alertItem, styles.alertCritical]}>
              <MaterialIcons name="error" size={20} color={COLORS.error} />
              <Text style={styles.alertText}>
                <Text style={styles.alertBold}>{counts.critical}</Text> document(s) expiring within 30 days!
              </Text>
            </View>
          )}
          {counts.warning > 0 && (
            <View style={[styles.alertItem, styles.alertWarning]}>
              <MaterialIcons name="warning" size={20} color="#FF9800" />
              <Text style={styles.alertText}>
                <Text style={styles.alertBold}>{counts.warning}</Text> document(s) expiring within 30-60 days
              </Text>
            </View>
          )}
        </View>
      )}

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
      >
        {filteredDocuments.length > 0 ? (
          filteredDocuments.map((doc) => {
            const expiry = getExpiryStatus(doc);
            return (
              <TouchableOpacity
                key={doc.id}
                style={styles.documentCard}
                onPress={() => {
                  setSelectedDoc(doc);
                  setShowPreview(true);
                }}
              >
                <View style={styles.documentHeader}>
                  <MaterialIcons
                    name={doc.document_type === 'pdf' ? 'picture-as-pdf' : 'image'}
                    size={32}
                    color={COLORS.primary}
                  />
                  <View style={styles.documentInfo}>
                    <Text style={styles.workerName}>{doc.user_name}</Text>
                    <Text style={styles.siteName}>{doc.site_name}</Text>
                    <Text style={styles.fileName}>{doc.file_name}</Text>
                    <Text style={styles.date}>
                      Uploaded: {format(new Date(doc.created_at), 'MMM dd, yyyy')}
                    </Text>
                  </View>
                </View>

                {/* Expiry Status Badge */}
                {doc.expiry_date && (
                  <View style={[styles.expiryBadge, { backgroundColor: expiry.color + '15', borderColor: expiry.color }]}>
                    <MaterialIcons
                      name={expiry.status === 'critical' ? 'error' : expiry.status === 'warning' ? 'warning' : 'check-circle'}
                      size={18}
                      color={expiry.color}
                    />
                    <View style={styles.expiryInfo}>
                      <Text style={[styles.expiryLabel, { color: expiry.color }]}>{expiry.label}</Text>
                      <Text style={styles.expiryDate}>
                        Expires: {format(new Date(doc.expiry_date), 'MMM dd, yyyy')}
                      </Text>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.emptyCard}>
            <MaterialIcons name="verified-user" size={64} color={COLORS.gray300} />
            <Text style={styles.emptyTitle}>
              {expiryFilter === 'all' ? 'No Documents' : `No ${expiryFilter} Documents`}
            </Text>
            <Text style={styles.emptyText}>
              {expiryFilter === 'critical' 
                ? 'No documents expiring within 30 days' 
                : expiryFilter === 'warning'
                ? 'No documents expiring within 30-60 days'
                : 'Safety documents will appear here'}
            </Text>
          </View>
        )}

        <Footer />
      </ScrollView>

      {/* Site Filter Modal */}
      <Modal visible={showSiteModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filter by Site</Text>
              <TouchableOpacity onPress={() => setShowSiteModal(false)}>
                <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.siteOption, !selectedSite && styles.siteOptionSelected]}
              onPress={() => handleSiteFilter(null)}
            >
              <MaterialIcons name="apps" size={24} color={!selectedSite ? COLORS.primary : COLORS.gray500} />
              <Text style={[styles.siteOptionText, !selectedSite && styles.siteOptionTextSelected]}>
                All Sites
              </Text>
              {!selectedSite && <MaterialIcons name="check" size={24} color={COLORS.primary} />}
            </TouchableOpacity>
            <FlatList
              data={sites}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.siteOption, selectedSite?.id === item.id && styles.siteOptionSelected]}
                  onPress={() => handleSiteFilter(item)}
                >
                  <MaterialIcons
                    name="location-city"
                    size={24}
                    color={selectedSite?.id === item.id ? COLORS.primary : COLORS.gray500}
                  />
                  <View style={styles.siteOptionInfo}>
                    <Text style={[styles.siteOptionText, selectedSite?.id === item.id && styles.siteOptionTextSelected]}>
                      {item.name}
                    </Text>
                  </View>
                  {selectedSite?.id === item.id && <MaterialIcons name="check" size={24} color={COLORS.primary} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Document Preview Modal */}
      <Modal visible={showPreview} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.previewModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Document Details</Text>
              <TouchableOpacity onPress={() => setShowPreview(false)}>
                <MaterialIcons name="close" size={28} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {selectedDoc && (
              <ScrollView style={styles.modalBody}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Worker:</Text>
                  <Text style={styles.detailValue}>{selectedDoc.user_name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Site:</Text>
                  <Text style={styles.detailValue}>{selectedDoc.site_name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>File:</Text>
                  <Text style={styles.detailValue}>{selectedDoc.file_name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Uploaded:</Text>
                  <Text style={styles.detailValue}>
                    {format(new Date(selectedDoc.created_at), 'MMM dd, yyyy h:mm a')}
                  </Text>
                </View>
                {selectedDoc.expiry_date && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Expires:</Text>
                    <Text style={[styles.detailValue, { color: getExpiryStatus(selectedDoc).color, fontWeight: 'bold' }]}>
                      {format(new Date(selectedDoc.expiry_date), 'MMM dd, yyyy')} ({getExpiryStatus(selectedDoc).label})
                    </Text>
                  </View>
                )}

                {selectedDoc.document_type === 'photo' && selectedDoc.file_data && (
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${selectedDoc.file_data}` }}
                    style={styles.previewImage}
                    resizeMode="contain"
                  />
                )}
              </ScrollView>
            )}
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
  filterSection: {
    marginBottom: 0,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  siteSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 8,
    padding: 12,
    backgroundColor: COLORS.background,
    gap: 8,
  },
  siteSelectorText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  filterTabs: {
    backgroundColor: COLORS.white,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: COLORS.gray200,
    gap: 4,
  },
  filterTabActive: {
    backgroundColor: COLORS.primary,
  },
  filterTabCritical: {
    backgroundColor: COLORS.error + '15',
  },
  filterTabCriticalActive: {
    backgroundColor: COLORS.error,
  },
  filterTabWarning: {
    backgroundColor: '#FF980015',
  },
  filterTabWarningActive: {
    backgroundColor: '#FF9800',
  },
  filterTabSafe: {
    backgroundColor: COLORS.success + '15',
  },
  filterTabSafeActive: {
    backgroundColor: COLORS.success,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  filterTabTextCritical: {
    color: COLORS.error,
  },
  filterTabTextWarning: {
    color: '#FF9800',
  },
  filterTabTextSafe: {
    color: COLORS.success,
  },
  filterTabTextActive: {
    color: COLORS.white,
  },
  alertBanner: {
    padding: 12,
    gap: 8,
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  alertCritical: {
    backgroundColor: '#FFEBEE',
  },
  alertWarning: {
    backgroundColor: '#FFF8E1',
  },
  alertText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    flex: 1,
  },
  alertBold: {
    fontWeight: 'bold',
  },
  content: {
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
    marginBottom: 12,
  },
  documentInfo: {
    marginLeft: 12,
    flex: 1,
  },
  workerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  siteName: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  fileName: {
    fontSize: 13,
    color: COLORS.textLight,
    marginTop: 2,
  },
  date: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 4,
  },
  expiryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  expiryInfo: {
    flex: 1,
  },
  expiryLabel: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  expiryDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
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
    maxHeight: '70%',
  },
  previewModalContent: {
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
  siteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
    gap: 12,
  },
  siteOptionSelected: {
    backgroundColor: COLORS.primary + '10',
  },
  siteOptionInfo: {
    flex: 1,
  },
  siteOptionText: {
    fontSize: 16,
    color: COLORS.textPrimary,
    flex: 1,
  },
  siteOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  modalBody: {
    padding: 20,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    width: 80,
  },
  detailValue: {
    fontSize: 14,
    color: COLORS.textPrimary,
    flex: 1,
  },
  previewImage: {
    width: '100%',
    height: 300,
    borderRadius: 8,
    marginVertical: 16,
  },
});
