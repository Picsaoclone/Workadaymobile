import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

const styles = StyleSheet.create({
  title: {
    fontSize: 18,
    fontFamily: 'BeVietnamPro_800ExtraBold',
    color: colors.text,
  },
});
