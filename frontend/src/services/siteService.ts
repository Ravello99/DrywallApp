import api from './api';

export const siteService = {
  async getSites() {
    const response = await api.get('/sites');
    return response.data;
  },

  async createSite(data: any) {
    const response = await api.post('/sites', data);
    return response.data;
  },

  async updateSite(id: string, data: any) {
    const response = await api.put(`/sites/${id}`, data);
    return response.data;
  },

  async shutdownSite(id: string, reason: string, clockOutEveryone = true) {
    const response = await api.post(`/sites/${id}/shutdown`, {
      reason,
      clock_out_everyone: clockOutEveryone,
    });
    return response.data;
  },

  async reopenSite(id: string) {
    const response = await api.post(`/sites/${id}/reopen`);
    return response.data;
  },

  async deleteSite(id: string) {
    const response = await api.delete(`/sites/${id}`);
    return response.data;
  },
};