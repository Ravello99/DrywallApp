import api from './api';
import { Task } from '../types';

export const taskService = {
  // Get all tasks (manager)
  getTasks: async (siteId?: string, assignedTo?: string): Promise<Task[]> => {
    let url = '/tasks';
    const params = new URLSearchParams();
    if (siteId) params.append('site_id', siteId);
    if (assignedTo) params.append('assigned_to', assignedTo);
    if (params.toString()) url += `?${params.toString()}`;
    
    const response = await api.get(url);
    return response.data;
  },

  // Get my tasks (worker)
  getMyTasks: async (): Promise<Task[]> => {
    const response = await api.get('/tasks/my-tasks');
    return response.data;
  },

  // Create a task (manager)
  createTask: async (data: {
    title: string;
    description?: string;
    site_id: string;
    assigned_to: string;
    priority: string;
    task_type: string;
    due_date?: string;
  }): Promise<Task> => {
    const response = await api.post('/tasks', data);
    return response.data;
  },

  // Update task
  updateTask: async (taskId: string, data: {
    title?: string;
    description?: string;
    priority?: string;
    task_type?: string;
    status?: string;
    due_date?: string;
  }): Promise<Task> => {
    const response = await api.put(`/tasks/${taskId}`, data);
    return response.data;
  },

  // Delete task (manager)
  deleteTask: async (taskId: string): Promise<void> => {
    await api.delete(`/tasks/${taskId}`);
  },
};
