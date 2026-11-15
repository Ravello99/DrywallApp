import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import api from './api';
import { Alert } from 'react-native';

const PENDING_CLOCK_KEY = 'pending_clock_records';
const PENDING_SAFETY_KEY = 'pending_safety_documents';
const LAST_SYNC_KEY = 'last_sync_timestamp';
const CACHED_DATA_KEY = 'cached_app_data';

class SyncService {
  private syncInProgress = false;

  // Check network connection
  async checkConnection() {
    const state = await NetInfo.fetch();
    return {
      isConnected: state.isConnected,
      isWifi: state.type === 'wifi',
      isCellular: state.type === 'cellular',
    };
  }

  // Queue clock record for sync
  async queueClockRecord(record: any) {
    try {
      const pending = await this.getPendingClockRecords();
      pending.push(record);
      await AsyncStorage.setItem(PENDING_CLOCK_KEY, JSON.stringify(pending));
    } catch (error) {
      console.error('Error queuing clock record:', error);
    }
  }

  // Queue safety document for sync
  async queueSafetyDocument(document: any) {
    try {
      const pending = await this.getPendingSafetyDocuments();
      pending.push(document);
      await AsyncStorage.setItem(PENDING_SAFETY_KEY, JSON.stringify(pending));
    } catch (error) {
      console.error('Error queuing safety document:', error);
    }
  }

  // Get pending items
  async getPendingClockRecords() {
    try {
      const data = await AsyncStorage.getItem(PENDING_CLOCK_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      return [];
    }
  }

  async getPendingSafetyDocuments() {
    try {
      const data = await AsyncStorage.getItem(PENDING_SAFETY_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      return [];
    }
  }

  // Get pending count
  async getPendingCount() {
    const clock = await this.getPendingClockRecords();
    const safety = await this.getPendingSafetyDocuments();
    return clock.length + safety.length;
  }

  // Sync all pending data
  async syncPendingData(forceCellular = false) {
    if (this.syncInProgress) {
      return { success: false, message: 'Sync already in progress' };
    }

    try {
      this.syncInProgress = true;

      const connection = await this.checkConnection();
      if (!connection.isConnected) {
        return { success: false, message: 'No internet connection' };
      }

      // Check if on cellular and not forced
      if (connection.isCellular && !forceCellular) {
        return {
          success: false,
          message: 'cellular',
          requiresConfirmation: true,
        };
      }

      const pendingClock = await this.getPendingClockRecords();
      const pendingSafety = await this.getPendingSafetyDocuments();

      if (pendingClock.length === 0 && pendingSafety.length === 0) {
        return { success: true, message: 'Nothing to sync' };
      }

      const lastSync = await AsyncStorage.getItem(LAST_SYNC_KEY);

      const response = await api.post('/sync', {
        clock_records: pendingClock,
        safety_documents: pendingSafety,
        last_sync: lastSync,
      });

      if (response.data.success) {
        // Clear pending items
        await AsyncStorage.setItem(PENDING_CLOCK_KEY, JSON.stringify([]));
        await AsyncStorage.setItem(PENDING_SAFETY_KEY, JSON.stringify([]));
        await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());

        // Cache new data
        if (response.data.new_data) {
          await this.cacheData(response.data.new_data);
        }

        return {
          success: true,
          message: `Synced ${response.data.synced_clock_records} clock records and ${response.data.synced_safety_documents} safety documents`,
        };
      }

      return { success: false, message: 'Sync failed' };
    } catch (error: any) {
      console.error('Sync error:', error);
      return {
        success: false,
        message: error.response?.data?.detail || 'Sync failed',
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  // Prompt for cellular sync
  async promptCellularSync() {
    return new Promise<boolean>((resolve) => {
      Alert.alert(
        'Cellular Data',
        'You are on a cellular connection. Do you want to sync your data now? This will use mobile data.',
        [
          {
            text: 'Wait for WiFi',
            style: 'cancel',
            onPress: () => resolve(false),
          },
          {
            text: 'Sync Now',
            onPress: () => resolve(true),
          },
        ]
      );
    });
  }

  // Auto sync (checks connection type)
  async autoSync() {
    const connection = await this.checkConnection();
    
    if (!connection.isConnected) {
      return { success: false, message: 'No connection' };
    }

    if (connection.isWifi) {
      return await this.syncPendingData(false);
    }

    if (connection.isCellular) {
      const shouldSync = await this.promptCellularSync();
      if (shouldSync) {
        return await this.syncPendingData(true);
      }
      return { success: false, message: 'User declined cellular sync' };
    }

    return { success: false, message: 'Unknown connection type' };
  }

  // Cache data locally
  async cacheData(data: any) {
    try {
      const existing = await this.getCachedData();
      const merged = {
        ...existing,
        ...data,
        lastUpdated: new Date().toISOString(),
      };
      await AsyncStorage.setItem(CACHED_DATA_KEY, JSON.stringify(merged));
    } catch (error) {
      console.error('Error caching data:', error);
    }
  }

  async getCachedData() {
    try {
      const data = await AsyncStorage.getItem(CACHED_DATA_KEY);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      return {};
    }
  }

  // Clear all cached data
  async clearCache() {
    try {
      await AsyncStorage.multiRemove([
        PENDING_CLOCK_KEY,
        PENDING_SAFETY_KEY,
        CACHED_DATA_KEY,
        LAST_SYNC_KEY,
      ]);
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }
}

export default new SyncService();