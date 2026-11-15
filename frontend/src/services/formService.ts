import api from './api';
import { FormTemplate, FormAssignment, FormSubmission, FormField } from '../types';

export const formService = {
  // Get form templates
  getFormTemplates: async (siteId?: string): Promise<FormTemplate[]> => {
    let url = '/forms/templates';
    if (siteId) url += `?site_id=${siteId}`;
    const response = await api.get(url);
    return response.data;
  },

  // Create form template (manager)
  createFormTemplate: async (data: {
    title: string;
    description?: string;
    fields: FormField[];
    site_id?: string;
  }): Promise<FormTemplate> => {
    const response = await api.post('/forms/templates', data);
    return response.data;
  },

  // Assign form to workers (manager)
  assignForm: async (data: {
    form_id: string;
    assigned_to: string[];
    due_date?: string;
  }): Promise<void> => {
    await api.post('/forms/assign', data);
  },

  // Get my form assignments (worker)
  getMyAssignments: async (): Promise<FormAssignment[]> => {
    const response = await api.get('/forms/my-assignments');
    return response.data;
  },

  // Submit form response
  submitForm: async (data: {
    form_id: string;
    responses: Record<string, any>;
  }): Promise<FormSubmission> => {
    const response = await api.post('/forms/submit', data);
    return response.data;
  },

  // Get form submissions (manager)
  getFormSubmissions: async (formId?: string): Promise<FormSubmission[]> => {
    let url = '/forms/submissions';
    if (formId) url += `?form_id=${formId}`;
    const response = await api.get(url);
    return response.data;
  },

  // Delete form template (manager)
  deleteFormTemplate: async (templateId: string): Promise<void> => {
    await api.delete(`/forms/templates/${templateId}`);
  },
};
