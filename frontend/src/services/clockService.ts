import api from './api';

export const clockService = {
  async clockIn(
    siteId: string,
    location: { latitude: number; longitude: number },
    accuracyM?: number | null,
    taskId?: string | null,
  ) {
    const response = await api.post('/clock/in', {
      site_id: siteId,
      location,
      accuracy_m: accuracyM ?? null,
      task_id: taskId || null,
    });
    return response.data;
  },

  async clockOut(location: { latitude: number; longitude: number } | null, accuracyM?: number | null) {
    const response = await api.post('/clock/out', { location, accuracy_m: accuracyM ?? null });
    return response.data;
  },

  async getActiveRecord() {
    const response = await api.get('/clock/active');
    return response.data;
  },

  async getMyRecords() {
    const response = await api.get('/clock/my-records');
    return response.data;
  },

  async getAllRecords(siteId?: string, startDate?: string, endDate?: string) {
    const params = new URLSearchParams();
    if (siteId) params.append('site_id', siteId);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const response = await api.get(`/clock/records?${params.toString()}`);
    return response.data;
  },
};