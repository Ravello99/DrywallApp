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
import { Calendar } from 'react-native-calendars';
import { Stack, useRouter } from 'expo-router';
import { taskService } from '../../src/services/taskService';
import { userService } from '../../src/services/userService';
import { siteService } from '../../src/services/siteService';
import { format } from 'date-fns';
import { Task, User, Site } from '../../src/types';
import { COLORS } from '../../src/constants/colors';
import Footer from '../../src/components/Footer';

const PRIORITIES = [
  { value: 'high', label: 'High', color: COLORS.error },
  { value: 'medium', label: 'Medium', color: '#FF9800' },
  { value: 'low', label: 'Low', color: COLORS.success },
];

const TASK_TYPES = [
  { value: 'safety', label: 'Safety' },
  { value: 'installation', label: 'Installation' },
  { value: 'inspection', label: 'Inspection' },
];

export default function TasksScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [priority, setPriority] = useState('medium');
  const [taskType, setTaskType] = useState('safety');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [tasksRes, usersRes, sitesRes] = await Promise.all([
        taskService.getTasks(),
        userService.getUsers(),
        siteService.getSites(),
      ]);
      setTasks(tasksRes);
      setUsers(usersRes.filter((u: User) => u.role !== 'manager'));
      setSites(sitesRes);

      if (sitesRes.length > 0 && !selectedSite) {
        setSelectedSite(sitesRes[0].id);
      }
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
    setTitle('');
    setDescription('');
    setPriority('medium');
    setTaskType('safety');
    setDueDate('');
    setSelectedUser('');
  };

  const handleCreateTask = async () => {
    if (!title || !selectedSite || !selectedUser) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    setActionLoading(true);
    try {
      await taskService.createTask({
        title,
        description,
        site_id: selectedSite,
        assigned_to: selectedUser,
        priority,
        task_type: taskType,
        due_date: dueDate || undefined,
      });

      Alert.alert('Success', 'Task created successfully!');
      setShowCreateModal(false);
      resetForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create task');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteTask = (task: Task) => {
    Alert.alert(
      'Delete Task',
      `Are you sure you want to delete "${task.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await taskService.deleteTask(task.id);
              Alert.alert('Success', 'Task deleted');
              loadData();
            } catch (error) {
              Alert.alert('Error', 'Failed to delete task');
            }
          },
        },
      ]
    );
  };

  const getPriorityColor = (p: string) => {
    const found = PRIORITIES.find(pr => pr.value === p);
    return found?.color || COLORS.gray400;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete': return COLORS.success;
      case 'in_progress': return '#FF9800';
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
          title: 'Task Management',
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
            <Text style={styles.headerTitle}>Tasks ({tasks.length})</Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => setShowCreateModal(true)}
            >
              <MaterialIcons name="add" size={24} color={COLORS.white} />
              <Text style={styles.createButtonText}>Create Task</Text>
            </TouchableOpacity>
          </View>

          {/* Tasks List */}
          <View style={styles.tasksSection}>
            {tasks.length > 0 ? (
              tasks.map((task) => (
                <View key={task.id} style={styles.taskCard}>
                  <View style={styles.taskHeader}>
                    <View style={[styles.priorityIndicator, { backgroundColor: getPriorityColor(task.priority) }]} />
                    <View style={styles.taskInfo}>
                      <Text style={styles.taskTitle}>{task.title}</Text>
                      <Text style={styles.taskAssignee}>Assigned to: {task.assigned_to_name}</Text>
                      <Text style={styles.taskSite}>{task.site_name}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeleteTask(task)}
                      style={styles.deleteBtn}
                    >
                      <MaterialIcons name="delete" size={20} color={COLORS.error} />
                    </TouchableOpacity>
                  </View>

                  {task.description && (
                    <Text style={styles.taskDescription}>{task.description}</Text>
                  )}

                  <View style={styles.taskMeta}>
                    <View style={[styles.badge, { backgroundColor: getPriorityColor(task.priority) + '20' }]}>
                      <Text style={[styles.badgeText, { color: getPriorityColor(task.priority) }]}>
                        {task.priority.toUpperCase()}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: COLORS.gray200 }]}>
                      <Text style={[styles.badgeText, { color: COLORS.textSecondary }]}>
                        {task.task_type}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: getStatusColor(task.status) + '20' }]}>
                      <Text style={[styles.badgeText, { color: getStatusColor(task.status) }]}>
                        {getStatusLabel(task.status)}
                      </Text>
                    </View>
                  </View>

                  {task.due_date && (
                    <Text style={styles.dueDate}>
                      Due: {format(new Date(task.due_date), 'MMM dd, yyyy')}
                    </Text>
                  )}
                </View>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <MaterialIcons name="assignment" size={48} color={COLORS.gray300} />
                <Text style={styles.emptyText}>No tasks created yet</Text>
                <Text style={styles.emptySubtext}>Create your first task to get started</Text>
              </View>
            )}
          </View>

          <Footer />
        </ScrollView>

        {/* Create Task Modal */}
        <Modal visible={showCreateModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <ScrollView style={styles.modalScrollContent}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Create New Task</Text>

                <Text style={styles.label}>Task Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter task title"
                  value={title}
                  onChangeText={setTitle}
                  placeholderTextColor={COLORS.gray400}
                />

                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter task description"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={3}
                  placeholderTextColor={COLORS.gray400}
                />

                <Text style={styles.label}>Site *</Text>
                <ModalPicker
                  options={sites.map((site) => ({ label: site.name, value: site.id }))}
                  selectedValue={selectedSite}
                  onValueChange={setSelectedSite}
                  placeholder="Select a site"
                />

                <Text style={styles.label}>Assign To *</Text>
                <ModalPicker
                  options={[
                    { label: 'Select a team member', value: '' },
                    ...users.map((user) => ({ label: user.name, value: user.id })),
                  ]}
                  selectedValue={selectedUser}
                  onValueChange={setSelectedUser}
                  placeholder="Select a team member"
                />

                <Text style={styles.label}>Priority</Text>
                <ModalPicker
                  options={PRIORITIES.map((p) => ({ label: p.label, value: p.value }))}
                  selectedValue={priority}
                  onValueChange={setPriority}
                  placeholder="Select priority"
                />

                <Text style={styles.label}>Task Type</Text>
                <ModalPicker
                  options={TASK_TYPES.map((t) => ({ label: t.label, value: t.value }))}
                  selectedValue={taskType}
                  onValueChange={setTaskType}
                  placeholder="Select task type"
                />

                <Text style={styles.label}>Due Date (Optional)</Text>
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => setShowCalendarModal(true)}
                >
                  <MaterialIcons name="calendar-today" size={20} color={COLORS.primary} />
                  <Text style={styles.dateButtonText}>
                    {dueDate ? format(new Date(dueDate), 'MMMM dd, yyyy') : 'Select due date'}
                  </Text>
                  {dueDate && (
                    <TouchableOpacity onPress={() => setDueDate('')}>
                      <MaterialIcons name="close" size={18} color={COLORS.gray500} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>

                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => {
                      setShowCreateModal(false);
                      resetForm();
                    }}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.submitButton]}
                    onPress={handleCreateTask}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <ActivityIndicator color={COLORS.white} />
                    ) : (
                      <Text style={styles.submitButtonText}>Create Task</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </Modal>

        {/* Calendar Modal */}
        <Modal visible={showCalendarModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.calendarModalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select Due Date</Text>
                <TouchableOpacity onPress={() => setShowCalendarModal(false)}>
                  <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
                </TouchableOpacity>
              </View>
              <Calendar
                minDate={new Date().toISOString().split('T')[0]}
                onDayPress={(day: any) => {
                  setDueDate(day.dateString);
                  setShowCalendarModal(false);
                }}
                markedDates={{
                  [dueDate]: { selected: true, selectedColor: COLORS.primary },
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
  taskAssignee: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  taskSite: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  deleteBtn: {
    padding: 4,
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
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 8,
    paddingLeft: 16,
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
  calendarModalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 20,
    margin: 20,
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
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    gap: 12,
  },
  dateButtonText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
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
