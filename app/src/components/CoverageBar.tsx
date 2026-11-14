import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Coverage } from '../api/types';
import { coverageSentence } from '../format';
import { colors, radius, space } from '../theme';

export function CoverageBar({ coverage }: { coverage: Coverage }) {
  const sentence = coverageSentence(coverage);
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`${coverage.label}: ${sentence}`}>
      <Text style={styles.label}>{coverage.label}</Text>
      <View style={styles.bar}>
        <View style={{ flex: coverage.goodPercent, backgroundColor: colors.good }} />
        <View style={{ flex: coverage.badPercent, backgroundColor: colors.bad }} />
        <View style={{ flex: coverage.unknownPercent, backgroundColor: colors.unknown }} />
      </View>
      <Text style={styles.sentence}>{sentence}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.md },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: space.xs },
  bar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.unknown,
  },
  sentence: { fontSize: 13, color: colors.muted, marginTop: space.xs },
});
