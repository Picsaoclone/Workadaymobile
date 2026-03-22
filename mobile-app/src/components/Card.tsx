import React from 'react';
import { Platform, StyleSheet, View, ViewProps } from 'react-native';
import { colors } from '../theme/colors';

export function Card({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: colors.shadow,
          shadowOffset: { width: 3, height: 4 },
          shadowOpacity: 0.16,
          shadowRadius: 0,
        }
      : {
          // Android elevation often looks like a gray outline.
          elevation: 0,
        }),
  },
});
