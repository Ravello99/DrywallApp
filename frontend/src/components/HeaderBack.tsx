// Back arrow for stacked screens. Goes back when there's history, otherwise to the area's home
// (e.g. after refreshing a page in the browser or opening a notification link directly).
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';

export default function HeaderBack({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <TouchableOpacity
      accessibilityLabel="Back"
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as any))}
      style={{ paddingHorizontal: 12, paddingVertical: 6 }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <MaterialIcons name="arrow-back" size={24} color={COLORS.white} />
    </TouchableOpacity>
  );
}
