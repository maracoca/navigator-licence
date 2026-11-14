import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StreetPreference } from '../api/types';
import { colors, radius, space } from '../theme';

export function StreetChip(props: {
  pref: StreetPreference;
  onChange: (p: StreetPreference) => void;
  onRemove: () => void;
}) {
  const { pref } = props;
  const required = pref.mode === 'require';
  return (
    <View style={[styles.chip, required && styles.chipRequired]}>
      <Text style={styles.label}>{pref.label}</Text>
      <Pressable
        onPress={() => props.onChange({ ...pref, mode: required ? 'prefer' : 'require' })}
        accessibilityRole="button"
        accessibilityLabel={`${pref.label}: ${pref.mode}. Tap to switch.`}
        style={[styles.mode, required && styles.modeRequired]}
        hitSlop={6}
      >
        <Text style={[styles.modeText, required && styles.modeTextRequired]}>{pref.mode}</Text>
      </Pressable>
      <Pressable
        onPress={props.onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${pref.label}`}
        hitSlop={8}
        style={styles.remove}
      >
        <Text style={styles.removeText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingLeft: space.md,
    paddingRight: space.sm,
    paddingVertical: space.xs,
    borderWidth: 1,
    borderColor: colors.primarySoft,
  },
  chipRequired: { borderColor: colors.primary },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  mode: {
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  modeRequired: { backgroundColor: colors.primary },
  modeText: { fontSize: 13, color: colors.primary },
  modeTextRequired: { color: colors.primaryText, fontWeight: '600' },
  remove: { paddingHorizontal: 4 },
  removeText: { fontSize: 14, color: colors.muted },
});
