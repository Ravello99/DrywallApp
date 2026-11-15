import api from './api';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export const reportService = {
  async getDashboardStats() {
    const response = await api.get('/reports/dashboard');
    return response.data;
  },

  async downloadTimesheetReport(siteId?: string, startDate?: string, endDate?: string) {
    const params = new URLSearchParams();
    if (siteId) params.append('site_id', siteId);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const response = await api.get(`/reports/timesheet?${params.toString()}`, {
      responseType: 'blob',
    });
    
    return response.data;
  },
};