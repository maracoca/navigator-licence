import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Item, StreetPreference, StreetProperty } from '../api/types';
import { ItemCard } from '../components/ItemCard';
import { StreetChip } from '../components/StreetChip';
import { Button, ErrorBox, Notices, SectionTitle } from '../components/ui';
import { colors, radius, space } from '../theme';

export function ReviewScreen(props: {
  items: Item[];
  street: StreetPreference[];
  notices: string[];
  streetProperties: StreetProperty[];
  onItemsChange: (items: Item[]) => void;
  onStreetChange: (street: StreetPreference[]) => void;
  onBack: () => void;
  onPlan: () => void;
  loading: boolean;
  error: string | null;
}) {
  const { items, street } = props;
  const [picking, setPicking] = useState(false);
  const addable = props.streetProperties.filter((p) => !street.some((s) => s.property === p.id));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Check your stops</Text>
        <Notices items={props.notices} />

        <SectionTitle>Places</SectionTitle>
        {items.length === 0 ? (
          <Text style={styles.empty}>No places. The route will go straight to the destination.</Text>
        ) : (
          items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onChange={(next) => props.onItemsChange(items.map((i) => (i.id === item.id ? next : i)))}
              onRemove={() => props.onItemsChange(items.filter((i) => i.id !== item.id))}
            />
          ))
        )}

        <SectionTitle>Streets</SectionTitle>
        {street.length === 0 ? (
          <Text style={styles.empty}>No street preferences.</Text>
        ) : (
          <>
            <View style={styles.chips}>
              {street.map((p) => (
                <StreetChip
                  key={p.property}
                  pref={p}
                  onChange={(next) =>
                    props.onStreetChange(street.map((s) => (s.property === p.property ? next : s)))
                  }
                  onRemove={() => props.onStreetChange(street.filter((s) => s.property !== p.property))}
                />
              ))}
            </View>
            <Text style={styles.hint}>Tap prefer/require to switch. “Require” avoids streets known not to match.</Text>
          </>
        )}
        {addable.length > 0 ? (
          picking ? (
            <View style={styles.picker}>
              {addable.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${p.label}`}
                  style={({ pressed }) => [styles.pickItem, pressed && { backgroundColor: colors.primarySoft }]}
                  onPress={() => {
                    props.onStreetChange([...street, { property: p.id, label: p.label, mode: 'prefer' }]);
                    setPicking(false);
                  }}
                >
                  <Text style={styles.pickText}>{p.label}</Text>
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" style={styles.pickItem} onPress={() => setPicking(false)}>
                <Text style={[styles.pickText, { color: colors.muted }]}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Button
              title="+ Street preference"
              kind="secondary"
              small
              onPress={() => setPicking(true)}
              style={{ alignSelf: 'flex-start', marginTop: space.md }}
            />
          )
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <ErrorBox message={props.error} />
        <View style={styles.buttons}>
          <Button title="Back" kind="secondary" onPress={props.onBack} disabled={props.loading} style={{ flex: 1 }} />
          <Button title="Plan route" onPress={props.onPlan} loading={props.loading} style={{ flex: 2 }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xl },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: space.md },
  empty: { color: colors.muted, marginBottom: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  picker: {
    marginTop: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pickItem: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickText: { fontSize: 15, color: colors.primary },
  hint: { color: colors.muted, fontSize: 12, marginTop: space.sm },
  footer: {
    padding: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  buttons: { flexDirection: 'row', gap: space.md },
});
