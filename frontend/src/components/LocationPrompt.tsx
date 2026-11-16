// Asks for location access so clock-in works. On iPhone Safari the browser only shows its
// "Allow location?" question after a tap, and if location was ever refused it never asks again,
// so this shows a button to trigger the question and, when blocked, the exact Settings steps.
//
// mode="card": inline card (Clock screen). mode="modal": pops up once per session after sign-in.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Platform, Linking, StyleSheet, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { COLORS } from '../constants/colors';

type State = 'checking' | 'granted' | 'prompt' | 'denied' | 'insecure' | 'unsupported';

const isWeb = Platform.OS === 'web';
const ua = () => (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');
const isIOS = () =>
  /iPhone|iPad|iPod/i.test(ua()) || (/Macintosh/.test(ua()) && typeof navigator !== 'undefined' && (navigator as any).maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(ua());
const SESSION_KEY = 'locationPrompt.dismissed';

async function webState(): Promise<State> {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!('geolocation' in navigator)) return 'unsupported';
  try {
    const p = await (navigator as any).permissions?.query({ name: 'geolocation' });
    if (p?.state === 'granted') return 'granted';
    if (p?.state === 'denied') return 'denied';
  } catch {
    /* Older Safari has no Permissions API: we only find out by asking */
  }
  return 'prompt';
}

export default function LocationPrompt({ mode = 'card', onGranted }: { mode?: 'card' | 'modal'; onGranted?: () => void }) {
  const [state, setState] = useState<State>('checking');
  const [asking, setAsking] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return mode === 'modal' && isWeb && sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });

  const check = useCallback(async () => {
    if (isWeb) return setState(await webState());
    try {
      const p = await Location.getForegroundPermissionsAsync();
      setState(p.granted ? 'granted' : p.canAskAgain ? 'prompt' : 'denied');
    } catch {
      setState('prompt');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const ask = async () => {
    setAsking(true);
    try {
      if (isWeb) {
        // Must run straight from the tap for Safari to show its question.
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => {
              setState('granted');
              onGranted?.();
              resolve();
            },
            (err) => {
              setState(err.code === 1 ? 'denied' : 'prompt');
              resolve();
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
          );
        });
      } else {
        const p = await Location.requestForegroundPermissionsAsync();
        setState(p.granted ? 'granted' : p.canAskAgain ? 'prompt' : 'denied');
        if (p.granted) onGranted?.();
      }
    } finally {
      setAsking(false);
    }
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  if (state === 'checking' || state === 'granted' || state === 'unsupported') return null;
  if (mode === 'modal' && dismissed) return null;

  const body = (
    <View>
      <View style={styles.head}>
        <MaterialIcons name={state === 'denied' ? 'location-off' : 'my-location'} size={26} color={state === 'denied' ? COLORS.error : COLORS.primary} />
        <Text style={styles.title}>{state === 'denied' ? 'Location is turned off for this app' : 'Allow location to clock in'}</Text>
      </View>

      {state === 'insecure' ? (
        <Text style={styles.text}>
          Your phone only shares location with secure sites. Open the app at https://app.vanguarddrywall.ca instead of this address.
        </Text>
      ) : state === 'prompt' ? (
        <>
          <Text style={styles.text}>
            Clocking in checks that you're on the job site. Tap the button, then choose <Text style={styles.b}>Allow</Text> when your phone asks.
          </Text>
          <TouchableOpacity style={styles.button} onPress={ask} disabled={asking} accessibilityRole="button">
            <MaterialIcons name="location-on" size={20} color={COLORS.white} />
            <Text style={styles.buttonText}>{asking ? 'Waiting for your answer…' : 'Allow location'}</Text>
          </TouchableOpacity>
        </>
      ) : !isWeb ? (
        <>
          <Text style={styles.text}>Location was refused earlier, so your phone won't ask again. Turn it on in Settings, then come back.</Text>
          <TouchableOpacity style={styles.button} onPress={() => Linking.openSettings()}>
            <MaterialIcons name="settings" size={20} color={COLORS.white} />
            <Text style={styles.buttonText}>Open Settings</Text>
          </TouchableOpacity>
        </>
      ) : isIOS() ? (
        <>
          <Text style={styles.text}>Your iPhone is blocking location for Safari. To turn it on:</Text>
          <Step n={1} text="Open the Settings app, then Privacy & Security, then Location Services. Make sure Location Services is on." />
          <Step n={2} text="On that same screen, scroll down to Safari Websites. Choose While Using the App and turn on Precise Location." />
          <Step n={3} text='Come back to Safari. Tap the "aA" (or the icon at the left of the address bar), then Website Settings, then set Location to Allow.' />
          <Step n={4} text="Reload this page and tap Clock In again." />
          <TouchableOpacity style={styles.button} onPress={() => window.location.reload()}>
            <MaterialIcons name="refresh" size={20} color={COLORS.white} />
            <Text style={styles.buttonText}>I've done this, reload</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.text}>Your browser is blocking location for this app. To turn it on:</Text>
          {isAndroid() ? (
            <>
              <Step n={1} text="Make sure Location is on in your phone's quick settings." />
              <Step n={2} text="In Chrome, tap the icon at the left of the address bar, then Permissions, then turn Location on." />
            </>
          ) : (
            <Step n={1} text="Click the icon at the left of the address bar and set Location to Allow." />
          )}
          <Step n={isAndroid() ? 3 : 2} text="Reload this page." />
          <TouchableOpacity style={styles.button} onPress={() => window.location.reload()}>
            <MaterialIcons name="refresh" size={20} color={COLORS.white} />
            <Text style={styles.buttonText}>Reload</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  if (mode === 'modal') {
    return (
      <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
        <View style={styles.overlay}>
          <ScrollView contentContainerStyle={styles.sheetWrap}>
            <View style={styles.sheet}>
              {body}
              <TouchableOpacity onPress={dismiss} style={styles.later}>
                <Text style={styles.laterText}>Not now</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  }
  return <View style={[styles.card, state === 'denied' && { borderLeftColor: COLORS.error }]}>{body}</View>;
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={[styles.text, { flex: 1, marginBottom: 0 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.white, borderRadius: 12, padding: 16, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: COLORS.primary },
  overlay: { flex: 1, backgroundColor: 'rgba(6,24,56,0.55)' },
  sheetWrap: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: COLORS.white, borderRadius: 14, padding: 20, maxWidth: 460, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.textPrimary, flex: 1 },
  text: { fontSize: 14, lineHeight: 20, color: COLORS.textPrimary, marginBottom: 12 },
  b: { fontWeight: '700' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, paddingVertical: 13, borderRadius: 10, marginTop: 4 },
  buttonText: { color: COLORS.white, fontWeight: '700', fontSize: 15 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText: { color: COLORS.primary, fontWeight: '800', fontSize: 13 },
  later: { alignItems: 'center', paddingVertical: 12, marginTop: 6 },
  laterText: { color: COLORS.textSecondary, fontWeight: '600' },
});
