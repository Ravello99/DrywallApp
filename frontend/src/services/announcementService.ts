import api from './api';

export const announcementService = {
  async getAnnouncements(siteId?: string) {
    const params = siteId ? `?site_id=${siteId}` : '';
    const response = await api.get(`/announcements${params}`);
    return response.data;
  },

  async createAnnouncement(data: {
    site_id: string;
    title: string;
    content: string;
    announcement_type?: string;
  }) {
    const response = await api.post('/announcements', data);
    return response.data;
  },

  async updateAnnouncement(id: string, data: { title?: string; content?: string; announcement_type?: string }) {
    const response = await api.put(`/announcements/${id}`, data);
    return response.data;
  },

  async deleteAnnouncement(id: string) {
    const response = await api.delete(`/announcements/${id}`);
    return response.data;
  },
};