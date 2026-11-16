import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const CONFIGURED_URL: string =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL || '';

// The web version is served by the backend itself, so in a browser talk to whatever address
// the page was opened from (works via public IP, office IP or a domain alike). Phones use the
// configured server address.
function resolveApiUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    try {
      const configuredPort = CONFIGURED_URL ? new URL(CONFIGURED_URL).port : '';
      if (!CONFIGURED_URL || window.location.port === configuredPort) return window.location.origin;
    } catch {
      return window.location.origin;
    }
  }
  return CONFIGURED_URL;
}

export const API_URL = resolveApiUrl();

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.removeItem('token');
      await AsyncStorage.removeItem('user');
    }
    return Promise.reject(error);
  }
);

export default api;