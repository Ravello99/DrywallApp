import api from './api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// For web, we need a fallback since AsyncStorage might not work perfectly
const storage = {
  async setItem(key: string, value: string) {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(key, value);
      } else {
        await AsyncStorage.setItem(key, value);
      }
    } catch (e) {
      console.error('Storage setItem error:', e);
    }
  },
  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(key);
      } else {
        return await AsyncStorage.getItem(key);
      }
    } catch (e) {
      console.error('Storage getItem error:', e);
      return null;
    }
  },
  async removeItem(key: string) {
    try {
      if (Platform.OS === 'web') {
        localStorage.removeItem(key);
      } else {
        await AsyncStorage.removeItem(key);
      }
    } catch (e) {
      console.error('Storage removeItem error:', e);
    }
  },
  async clear() {
    try {
      if (Platform.OS === 'web') {
        localStorage.clear();
      } else {
        await AsyncStorage.clear();
      }
    } catch (e) {
      console.error('Storage clear error:', e);
    }
  }
};

// The password typed at sign-in, kept in memory only (never saved), so someone who must set a
// new password right after signing in with a temporary one doesn't have to type it twice.
let justSignedInWith: string | null = null;

async function saveSession(data: { access_token: string; user: any }) {
  await storage.setItem('token', data.access_token);
  await storage.setItem('user', JSON.stringify(data.user));
  return { token: data.access_token, user: data.user };
}

export const authService = {
  async login(email: string, password: string) {
    const response = await api.post('/auth/login', { email, password });
    justSignedInWith = response.data.user?.must_change_password ? password : null;
    return saveSession(response.data);
  },

  signInPassword() {
    return justSignedInWith;
  },

  async changePassword(currentPassword: string, newPassword: string) {
    const response = await api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
    justSignedInWith = null;
    return saveSession(response.data);
  },

  async forgotPassword(email: string): Promise<{ ok: boolean; email_enabled: boolean }> {
    const response = await api.post('/auth/forgot-password', { email });
    return response.data;
  },

  async resetPassword(token: string, newPassword: string) {
    const response = await api.post('/auth/reset-password', { token, new_password: newPassword });
    return saveSession(response.data);
  },

  async logout() {
    justSignedInWith = null;
    await storage.removeItem('token');
    await storage.removeItem('user');
    await storage.clear();
  },

  async getCurrentUser() {
    const response = await api.get('/auth/me');
    return response.data;
  },

  async getStoredUser() {
    const userStr = await storage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  async getStoredToken() {
    return await storage.getItem('token');
  },
};

export { storage };
