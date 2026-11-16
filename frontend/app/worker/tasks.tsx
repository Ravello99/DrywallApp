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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { taskService } from '../../src/services/taskService';
import { format } from 'date-fns';
import { Task } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';
import { useAuthStore } from '../../src/store/authStore';
import ForemanTasks from '../../src/components/field/ForemanTasks';

const PRIORITIES = [
  { value: 'high', label: 'High', color: COLORS.error },
  { value: 'medium', label: 'Medium', color: '#D98E04' },
  { value: 'low', label: 'Low', color: COLORS.success },
];

// Foremen manage every task on their sites; employees see the tasks assigned to them.
export default function TasksScreen() {
  const { user } = useAuthStore();
  return user?.role === 'foreman' ? <ForemanTasks /> : <WorkerTasksScreen />;
}

function WorkerTasksScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<'all' | 'todo' | 'in_progress' | 'complete'>('all');

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      const tasksRes = await taskService.getMyTasks();
      setTasks(tasksRes);
    } catch (error) {
      console.error('Error loading tasks:', error);
      Alert.alert('Error', 'Failed to load tasks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadTasks();
  };

  const handleStatusChange = async (task: Task, newStatus: string) => {
    try {
      await taskService.updateTask(task.id, { status: newStatus });
      Alert.alert('Success', `Task marked as ${getStatusLabel(newStatus)}`);
      loadTasks();
    } catch (error) {
      Alert.alert('Error', 'Failed to update task');
    }
  };

  const getPriorityColor = (p: string) => {
    const found = PRIORITIES.find(pr => pr.value === p);
    return found?.color || COLORS.gray400;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete': return COLORS.success;
      case 'in_progress': return '#D98E04';
      default: return COLORS.gray400;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'complete': return 'Complete';
      case 'in_progress': return 'In Progress';
      default: return 'To Do';
    }
  };

  const filteredTasks = tasks.filter(task => {
    if (filter === 'all') return true;
    return task.status === filter;
  });

  const taskCounts = {
    all: tasks.length,
    todo: tasks.filter(t => t.status === 'todo').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    complete: tasks.filter(t => t.status === 'complete').length,
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
          title: 'My Tasks',
          headerStyle: { backgroundColor: COLORS.primary },
          headerTintColor: COLORS.white,
        }}
      />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Filter Tabs */}
          <View style={styles.filterContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(['all', 'todo', 'in_progress', 'complete'] as const).map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterTab, filter === f && styles.filterTabActive]}
                  onPress={() => setFilter(f)}
                >
                  <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                    {f === 'all' ? 'All' : getStatusLabel(f)} ({taskCounts[f]})
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Tasks List */}
          <View style={styles.tasksSection}>
            {filteredTasks.length > 0 ? (
              filteredTasks.map((task) => (
                <View key={task.id} style={styles.taskCard}>
                  <View style={styles.taskHeader}>
                    <View style={[styles.priorityIndicator, { backgroundColor: getPriorityColor(task.priority) }]} />
                    <View style={styles.taskInfo}>
                      <Text style={styles.taskTitle}>{task.title}</Text>
                      <Text style={styles.taskSite}>📍 {task.site_name}</Text>
                      <Text style={styles.taskCreator}>From: {task.created_by_name}</Text>
                    </View>
                  </View>

                  {task.description && (
                    <Text style={styles.taskDescription}>{task.description}</Text>
                  )}

                  <View style={styles.taskMeta}>
                    <View style={[styles.badge, { backgroundColor: getPriorityColor(task.priority) + '20' }]}>
                      <Text style={[styles.badgeText, { color: getPriorityColor(task.priority) }]}>
                        {(task.priority || 'medium').toUpperCase()}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: COLORS.gray200 }]}>
                      <Text style={[styles.badgeText, { color: COLORS.textSecondary }]}>
                        {task.task_type}
                      </Text>
                    </View>
                  </View>

                  {task.due_date && (
                    <Text style={styles.dueDate}>
                      📅 Due: {format(new Date(task.due_date), 'MMM dd, yyyy')}
                    </Text>
                  )}

                  {/* Status Actions */}
                  <View style={styles.statusActions}>
                    {task.status === 'todo' && (
                      <TouchableOpacity
                        style={[styles.statusButton, { backgroundColor: '#D98E04' }]}
                        onPress={() => handleStatusChange(task, 'in_progress')}
                      >
                        <MaterialIcons name="play-arrow" size={18} color={COLORS.white} />
                        <Text style={styles.statusButtonText}>Start</Text>
                      </TouchableOpacity>
                    )}
                    {task.status === 'in_progress' && (
                      <TouchableOpacity
                        style={[styles.statusButton, { backgroundColor: COLORS.success }]}
                        onPress={() => handleStatusChange(task, 'complete')}
                      >
                        <MaterialIcons name="check" size={18} color={COLORS.white} />
                        <Text style={styles.statusButtonText}>Complete</Text>
                      </TouchableOpacity>
                    )}
                    {task.status === 'complete' && (
                      <View style={styles.completedBadge}>
                        <MaterialIcons name="check-circle" size={18} color={COLORS.success} />
                        <Text style={styles.completedText}>Completed</Text>
                      </View>
                    )}
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <MaterialIcons name="assignment" size={48} color={COLORS.gray300} />
                <Text style={styles.emptyText}>
                  {filter === 'all' ? 'No tasks assigned to you' : `No ${getStatusLabel(filter).toLowerCase()} tasks`}
                </Text>
              </View>
            )}
          </View>

          <Footer />
        </ScrollView>
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
  filterContainer: {
    backgroundColor: COLORS.white,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: COLORS.background,
  },
  filterTabActive: {
    backgroundColor: COLORS.primary,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  filterTextActive: {
    color: COLORS.white,
  },
  tasksSection: {
    padding: 16,
  },
  taskCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  taskHeader: {
    flexDirection: 'row',
  },
  priorityIndicator: {
    width: 4,
    borderRadius: 2,
    marginRight: 12,
  },
  taskInfo: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  taskSite: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  taskCreator: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  taskDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 12,
    paddingLeft: 16,
  },
  taskMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    paddingLeft: 16,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'capitalize',
  },
  dueDate: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 12,
    paddingLeft: 16,
  },
  statusActions: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray200,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  statusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  statusButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  completedText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.success,
  },
  emptyCard: {
    backgroundColor: COLORS.white,
    padding: 40,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 12,
    textAlign: 'center',
  },
});
