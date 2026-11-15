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
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { clockService } from '../../src/services/clockService';
import { siteService } from '../../src/services/siteService';
import { format, startOfWeek, endOfWeek, parseISO, isWithinInterval } from 'date-fns';
import { ClockRecord, Site } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';

export default function TimesheetsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [records, setRecords] = useState<ClockRecord[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [datePickerType, setDatePickerType] = useState<'start' | 'end'>('start');
  
  // Date range state
  const [startDate, setStartDate] = useState<string>(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState<string>(
    format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [sitesRes, recordsRes] = await Promise.all([
        siteService.getSites(),
        clockService.getAllRecords(),
      ]);
      setSites(sitesRes);
      setRecords(recordsRes);
    } catch (error) {
      console.error('Error loading data:', error);
      if (Platform.OS === 'web') {
        window.alert('Failed to load data');
      } else {
        Alert.alert('Error', 'Failed to load data');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleFilterBySite = (site: Site | null) => {
    setSelectedSite(site);
    setShowSiteModal(false);
  };

  const handleDateSelect = (day: any) => {
    if (datePickerType === 'start') {
      setStartDate(day.dateString);
      // If start date is after end date, adjust end date
      if (day.dateString > endDate) {
        setEndDate(day.dateString);
      }
    } else {
      setEndDate(day.dateString);
      // If end date is before start date, adjust start date
      if (day.dateString < startDate) {
        setStartDate(day.dateString);
      }
    }
    setShowDateModal(false);
  };

  const setThisWeek = () => {
    setStartDate(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    setEndDate(format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  };

  const setLastWeek = () => {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    setStartDate(format(startOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    setEndDate(format(endOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  };

  // Filter records by site and date range
  const filteredRecords = records.filter((record) => {
    // Site filter
    if (selectedSite && record.site_id !== selectedSite.id) {
      return false;
    }
    
    // Date range filter
    try {
      const recordDate = parseISO(record.clock_in);
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      end.setHours(23, 59, 59, 999); // Include entire end day
      
      return isWithinInterval(recordDate, { start, end });
    } catch {
      return true;
    }
  });

  // Group records by worker
  const recordsByWorker: { [key: string]: ClockRecord[] } = {};
  filteredRecords.forEach((record) => {
    const workerName = record.user_name || 'Unknown Worker';
    if (!recordsByWorker[workerName]) {
      recordsByWorker[workerName] = [];
    }
    recordsByWorker[workerName].push(record);
  });

  // Calculate totals per worker
  const workerTotals = Object.entries(recordsByWorker).map(([name, workerRecords]) => {
    const totalHours = workerRecords.reduce((sum, r) => sum + (r.total_hours || 0), 0);
    return { name, records: workerRecords, totalHours };
  }).sort((a, b) => b.totalHours - a.totalHours);

  const totalAllHours = workerTotals.reduce((sum, w) => sum + w.totalHours, 0);

  // Generate printable report
  const generatePrintableReport = () => {
    const siteName = selectedSite ? selectedSite.name : 'All Sites';
    const dateRange = `${format(parseISO(startDate), 'MMM dd, yyyy')} - ${format(parseISO(endDate), 'MMM dd, yyyy')}`;
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Timesheet Report - ${siteName}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
          .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #0B2556; padding-bottom: 20px; }
          .header h1 { color: #0B2556; margin: 0; font-size: 28px; }
          .header h2 { color: #666; margin: 10px 0 0 0; font-size: 18px; font-weight: normal; }
          .header p { color: #888; margin: 5px 0; }
          .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
          .summary-grid { display: flex; justify-content: space-around; text-align: center; }
          .summary-item h3 { margin: 0; color: #0B2556; font-size: 32px; }
          .summary-item p { margin: 5px 0 0 0; color: #666; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          th { background: #0B2556; color: white; padding: 12px; text-align: left; }
          td { padding: 10px 12px; border-bottom: 1px solid #ddd; }
          tr:nth-child(even) { background: #f9f9f9; }
          .worker-section { margin-bottom: 30px; page-break-inside: avoid; }
          .worker-header { background: #E7ECF5; padding: 12px; border-radius: 8px 8px 0 0; }
          .worker-header h3 { margin: 0; color: #0B2556; }
          .worker-header span { color: #666; font-size: 14px; }
          .total-row { background: #F6F0DC !important; font-weight: bold; }
          .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #888; font-size: 12px; }
          @media print { 
            body { margin: 20px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>VanGuard Drywall & Acoustics</h1>
          <h2>Timesheet Report</h2>
          <p><strong>Site:</strong> ${siteName}</p>
          <p><strong>Period:</strong> ${dateRange}</p>
          <p><strong>Generated:</strong> ${format(new Date(), 'MMMM dd, yyyy h:mm a')}</p>
        </div>

        <div class="summary">
          <div class="summary-grid">
            <div class="summary-item">
              <h3>${workerTotals.length}</h3>
              <p>Workers</p>
            </div>
            <div class="summary-item">
              <h3>${filteredRecords.length}</h3>
              <p>Clock Records</p>
            </div>
            <div class="summary-item">
              <h3>${totalAllHours.toFixed(1)}</h3>
              <p>Total Hours</p>
            </div>
          </div>
        </div>
    `;

    // Add worker sections
    workerTotals.forEach((worker) => {
      html += `
        <div class="worker-section">
          <div class="worker-header">
            <h3>${worker.name}</h3>
            <span>${worker.records.length} record(s) • ${worker.totalHours.toFixed(2)} total hours</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Hours</th>
                <th>Site</th>
              </tr>
            </thead>
            <tbody>
      `;

      worker.records.forEach((record) => {
        html += `
          <tr>
            <td>${format(parseISO(record.clock_in), 'MMM dd, yyyy')}</td>
            <td>${format(parseISO(record.clock_in), 'h:mm a')}</td>
            <td>${record.clock_out ? format(parseISO(record.clock_out), 'h:mm a') : 'Active'}</td>
            <td>${record.total_hours ? record.total_hours.toFixed(2) : '-'}</td>
            <td>${record.site_name}</td>
          </tr>
        `;
      });

      html += `
            <tr class="total-row">
              <td colspan="3">Total for ${worker.name}</td>
              <td>${worker.totalHours.toFixed(2)} hrs</td>
              <td></td>
            </tr>
            </tbody>
          </table>
        </div>
      `;
    });

    html += `
        <div class="footer">
          <p>VanGuard Drywall & Acoustics • Developed by Nicholas Ravello</p>
        </div>
        <script>window.print();</script>
      </body>
      </html>
    `;

    // Open in new window for printing
    if (Platform.OS === 'web') {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      }
    } else {
      Alert.alert('Print Report', 'Print functionality is available on web/desktop. Please use the web version to print reports.');
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
        {/* Site Filter */}
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

        {/* Date Range */}
        <View style={styles.dateRangeSection}>
          <Text style={styles.label}>Date Range:</Text>
          <View style={styles.dateRangeRow}>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => { setDatePickerType('start'); setShowDateModal(true); }}
            >
              <MaterialIcons name="calendar-today" size={16} color={COLORS.primary} />
              <Text style={styles.dateButtonText}>{format(parseISO(startDate), 'MMM dd')}</Text>
            </TouchableOpacity>
            <Text style={styles.dateSeparator}>to</Text>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => { setDatePickerType('end'); setShowDateModal(true); }}
            >
              <MaterialIcons name="calendar-today" size={16} color={COLORS.primary} />
              <Text style={styles.dateButtonText}>{format(parseISO(endDate), 'MMM dd')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.quickDateButtons}>
            <TouchableOpacity style={styles.quickDateButton} onPress={setThisWeek}>
              <Text style={styles.quickDateText}>This Week</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickDateButton} onPress={setLastWeek}>
              <Text style={styles.quickDateText}>Last Week</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Print/Export Button */}
        <TouchableOpacity
          style={styles.printButton}
          onPress={generatePrintableReport}
        >
          <MaterialIcons name="print" size={20} color={COLORS.white} />
          <Text style={styles.printButtonText}>Print Report</Text>
        </TouchableOpacity>
      </View>

      {/* Summary Card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{workerTotals.length}</Text>
          <Text style={styles.summaryLabel}>Workers</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{filteredRecords.length}</Text>
          <Text style={styles.summaryLabel}>Records</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: COLORS.primary }]}>{totalAllHours.toFixed(1)}</Text>
          <Text style={styles.summaryLabel}>Total Hrs</Text>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
      >
        {workerTotals.length > 0 ? (
          workerTotals.map((worker) => (
            <View key={worker.name} style={styles.workerCard}>
              <View style={styles.workerHeader}>
                <MaterialIcons name="person" size={24} color={COLORS.primary} />
                <View style={styles.workerInfo}>
                  <Text style={styles.workerName}>{worker.name}</Text>
                  <Text style={styles.workerStats}>
                    {worker.records.length} record(s) • {worker.totalHours.toFixed(2)} hrs
                  </Text>
                </View>
              </View>

              {worker.records.slice(0, 3).map((record) => (
                <View key={record.id} style={styles.recordRow}>
                  <Text style={styles.recordDate}>
                    {format(parseISO(record.clock_in), 'MMM dd')}
                  </Text>
                  <Text style={styles.recordTime}>
                    {format(parseISO(record.clock_in), 'h:mm a')} - {record.clock_out ? format(parseISO(record.clock_out), 'h:mm a') : 'Active'}
                  </Text>
                  <Text style={styles.recordHours}>
                    {record.total_hours ? `${record.total_hours.toFixed(1)}h` : '-'}
                  </Text>
                </View>
              ))}

              {worker.records.length > 3 && (
                <Text style={styles.moreRecords}>
                  +{worker.records.length - 3} more records
                </Text>
              )}
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <MaterialIcons name="assignment" size={64} color={COLORS.gray300} />
            <Text style={styles.emptyTitle}>No Records Found</Text>
            <Text style={styles.emptyText}>No timesheet records for the selected filters</Text>
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
              onPress={() => handleFilterBySite(null)}
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
                  onPress={() => handleFilterBySite(item)}
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
                    <Text style={styles.siteOptionAddress}>{item.address}</Text>
                  </View>
                  {selectedSite?.id === item.id && <MaterialIcons name="check" size={24} color={COLORS.primary} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Date Picker Modal */}
      <Modal visible={showDateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.dateModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Select {datePickerType === 'start' ? 'Start' : 'End'} Date
              </Text>
              <TouchableOpacity onPress={() => setShowDateModal(false)}>
                <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <Calendar
              current={datePickerType === 'start' ? startDate : endDate}
              onDayPress={handleDateSelect}
              markedDates={{
                [startDate]: { selected: datePickerType === 'start', selectedColor: COLORS.primary, startingDay: true },
                [endDate]: { selected: datePickerType === 'end', selectedColor: COLORS.primary, endingDay: true },
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
    marginBottom: 12,
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
  dateRangeSection: {
    marginBottom: 12,
  },
  dateRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 8,
    padding: 10,
    backgroundColor: COLORS.background,
    gap: 6,
    flex: 1,
  },
  dateButtonText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  dateSeparator: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  quickDateButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  quickDateButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.gray200,
    borderRadius: 16,
  },
  quickDateText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  printButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  printButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  summaryLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: COLORS.gray200,
  },
  content: {
    padding: 16,
  },
  workerCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  workerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  workerInfo: {
    marginLeft: 12,
    flex: 1,
  },
  workerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  workerStats: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  recordDate: {
    width: 60,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  recordTime: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  recordHours: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  moreRecords: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
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
  dateModalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 20,
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
  siteOptionAddress: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});
