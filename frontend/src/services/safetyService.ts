import api from './api';

export const safetyService = {
  async uploadDocument(data: {
    site_id: string;
    document_type: string;
    file_data: string;
    file_name: string;
    description?: string;
  }) {
    const response = await api.post('/safety/upload', data);
    return response.data;
  },

  async getMyDocuments() {
    const response = await api.get('/safety/my-documents');
    return response.data;
  },

  async getAllDocuments(siteId?: string, status?: string) {
    const params = new URLSearchParams();
    if (siteId) params.append('site_id', siteId);
    if (status) params.append('status', status);
    
    const response = await api.get(`/safety/documents?${params.toString()}`);
    return response.data;
  },

  async reviewDocument(id: string, status: string, notes?: string) {
    const response = await api.put(`/safety/${id}/review`, { status, notes });
    return response.data;
  },
};