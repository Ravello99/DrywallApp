import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, COMPANY } from '../constants/colors';

export default function Footer() {
  return (
    <View style={styles.container}>
      <Text style={styles.mainText}>{COMPANY.name}</Text>
      <Text style={styles.subText}>Developed by Nicholas Ravello</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  mainText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.primary,
    textAlign: 'center',
  },
  subText: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 4,
    textAlign: 'center',
  },
});
