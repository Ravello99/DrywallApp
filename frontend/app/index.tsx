import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Redirect } from 'expo-router';
import { authService } from '../src/services/authService';
import { useAuthStore } from '../src/store/authStore';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../src/constants/colors';
import Footer from '../src/components/Footer';
import { resolveSession, landingFor, clearSessionCache } from '../src/services/session';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [home, setHome] = useState<string | null>(null);
  const router = useRouter();
  const { setUser } = useAuthStore();

  useEffect(() => {
    checkExistingAuth();
  }, []);

  const checkExistingAuth = async () => {
    try {
      const u = await resolveSession(true);
      if (u) {
        setUser(u);
        setHome(landingFor(u));
      }
    } catch (error) {
      console.error('Auth check error:', error);
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    setLoading(true);
    setLoginError('');
    try {
      const { user } = await authService.login(email.trim(), password);
      setUser(user);
      clearSessionCache();
      router.replace(landingFor(user) as any);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      const msg = !error.response
        ? "Can't reach the server. Check your connection and the server address."
        : typeof detail === 'string'
          ? detail
          : 'Invalid email or password';
      setLoginError(msg);
      Alert.alert('Login Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  if (home) return <Redirect href={home as any} />;

  if (checkingAuth) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          {/* Logo/Header - No circular container, just the logo */}
          <View style={styles.header}>
            <Image 
              source={require('../assets/images/vanguard-logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <View style={styles.goldRule} />
            <Text style={styles.title}>Project & Field Management</Text>
          </View>

          {/* Login Form */}
          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <MaterialIcons name="email" size={20} color={COLORS.gray500} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholderTextColor={COLORS.gray400}
              />
            </View>

            <View style={styles.inputContainer}>
              <MaterialIcons name="lock" size={20} color={COLORS.gray500} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholderTextColor={COLORS.gray400}
              />
            </View>

            {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}

            <TouchableOpacity onPress={() => router.push({ pathname: '/forgot-password', params: email ? { email: email.trim() } : {} } as any)} style={{ alignSelf: 'flex-end', paddingVertical: 8, marginBottom: 8 }}>
              <Text style={{ color: COLORS.primary, fontWeight: '600' }}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Branding Footer */}
          <Footer />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 300,
    height: 72,
    marginBottom: 16,
  },
  goldRule: {
    width: 48,
    height: 3,
    backgroundColor: COLORS.accent,
    borderRadius: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.primary,
    marginTop: 12,
    letterSpacing: 0.5,
  },
  form: {
    marginBottom: 24,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  button: {
    backgroundColor: COLORS.primary,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
