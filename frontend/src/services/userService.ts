import api from './api';

export const userService = {
  async getUsers() {
    const response = await api.get('/users');
    return response.data;
  },

  async createUser(data: any) {
    const response = await api.post('/users', data);
    return response.data;
  },

  async updateUser(id: string, data: any) {
    const response = await api.put(`/users/${id}`, data);
    return response.data;
  },

  async deleteUser(id: string) {
    const response = await api.delete(`/users/${id}`);
    return response.data;
  },

  /** Gives the person a temporary password they must change when they sign in. */
  async resetPassword(id: string): Promise<{ temporary_password: string; user_name: string; email: string }> {
    const response = await api.post(`/users/${id}/reset-password`);
    return response.data;
  },
};