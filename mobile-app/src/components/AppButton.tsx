import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';

interface AppButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'outline';
  style?: ViewStyle;
}

export function AppButton({ label, onPress, loading, disabled, variant = 'primary', style }: AppButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.outline,
        pressed && !isDisabled ? styles.pressed : undefined,
        isDisabled ? styles.disabled : undefined,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.primary} />
      ) : (
        <Text style={[styles.text, variant === 'primary' ? styles.primaryText : styles.outlineText]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: colors.shadow,
          shadowOffset: { width: 2, height: 3 },
          shadowOpacity: 0.14,
          shadowRadius: 0,
        }
      : {
          elevation: 0,
        }),
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.border,
  },
  outline: {
    backgroundColor: colors.white,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.86,
  },
  disabled: {
    opacity: 0.6,
  },
  text: {
    fontSize: 16,
    fontFamily: 'BeVietnamPro_800ExtraBold',
  },
  primaryText: {
    color: colors.white,
  },
  outlineText: {
    color: colors.text,
  },
});
