import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { announcementService } from '../../src/services/announcementService';
import { format } from 'date-fns';
import { Announcement } from '../../src/types';

export default function AnnouncementsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    loadAnnouncements();
  }, []);

  const loadAnnouncements = async () => {
    try {
      const data = await announcementService.getAnnouncements();
      setAnnouncements(data);
    } catch (error) {
      console.error('Error loading announcements:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadAnnouncements();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0B2556" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.content}
      >
        {announcements.length > 0 ? (
          announcements.map((announcement) => (
            <View key={announcement.id} style={styles.announcementCard}>
              <View style={styles.header}>
                <MaterialIcons name="campaign" size={24} color="#0B2556" />
                <View style={styles.headerInfo}>
                  <Text style={styles.siteName}>{announcement.site_name}</Text>
                  <Text style={styles.date}>
                    {format(new Date(announcement.created_at), 'MMM dd, yyyy h:mm a')}
                  </Text>
                </View>
              </View>
              
              <Text style={styles.title}>{announcement.title}</Text>
              <Text style={styles.content}>{announcement.content}</Text>
              
              <View style={styles.footer}>
                <Text style={styles.author}>Posted by: {announcement.created_by_name}</Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <MaterialIcons name="notifications-off" size={64} color="#CCC" />
            <Text style={styles.emptyTitle}>No Announcements</Text>
            <Text style={styles.emptyText}>
              You'll see site announcements here when managers post them
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 16,
  },
  announcementCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#0B2556',
  },
  header: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  headerInfo: {
    marginLeft: 12,
    flex: 1,
  },
  siteName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0B2556',
  },
  date: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  content: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
    marginBottom: 12,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingTop: 8,
  },
  author: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  emptyCard: {
    backgroundColor: '#FFF',
    padding: 48,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#999',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
});