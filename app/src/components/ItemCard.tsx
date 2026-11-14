import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import type { Item } from '../api/types';
import { colors, space } from '../theme';
import { Button, Card } from './ui';

const STAY_STEP = 5;

function matchedKinds(item: Item): string {
  const parts: string[] = [];
  if (item.osm.length) parts.push('OSM: ' + item.osm.map((o) => o.name).join(', '));
  if (item.googleTypes.length) parts.push('Google: ' + item.googleTypes.join(', '));
  return parts.join(' · ');
}

export function ItemCard(props: {
  item: Item;
  onChange: (item: Item) => void;
  onRemove: () => void;
}) {
  const { item, onChange } = props;
  const set = (patch: Partial<Item>) => onChange({ ...item, ...patch });
  const kinds = matchedKinds(item);

  return (
    <Card>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>
            {item.order !== null ? `${item.order}. ` : ''}
            {item.label}
            {item.count > 1 ? ` ×${item.count}` : ''}
          </Text>
          <Text style={styles.phrase}>“{item.phrase}”</Text>
          {item.details ? <Text style={styles.small}>Wishes: {item.details}</Text> : null}
          {kinds ? <Text style={styles.small}>{kinds}</Text> : null}
        </View>
        <Button title="Remove" kind="danger" small onPress={props.onRemove} accessibilityLabel={`Remove ${item.label}`} />
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>{item.required ? 'Required' : 'Optional (only if along the way)'}</Text>
        <Switch value={item.required} onValueChange={(required) => set({ required })} />
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Order</Text>
        <Text style={styles.value}>{item.order === null ? 'any' : item.order}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>How many</Text>
        <Text style={styles.value}>{item.count}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Pace</Text>
        <Text style={styles.value}>{item.pace}</Text>
      </View>

      <View style={styles.row}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.rowLabel}>Stay</Text>
          {item.stayFixed ? <Text style={styles.small}>Fixed: won't be shortened</Text> : null}
        </View>
        <View style={styles.stepper}>
          <Button
            title="−5"
            kind="secondary"
            small
            accessibilityLabel="5 minutes less"
            disabled={item.stayMinutes <= 0}
            onPress={() => set({ stayMinutes: Math.max(0, item.stayMinutes - STAY_STEP), stayFixed: true })}
          />
          <Text style={[styles.value, styles.stayValue]}>{item.stayMinutes} min</Text>
          <Button
            title="+5"
            kind="secondary"
            small
            accessibilityLabel="5 minutes more"
            onPress={() => set({ stayMinutes: item.stayMinutes + STAY_STEP, stayFixed: true })}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.sm },
  label: { fontSize: 18, fontWeight: '700', color: colors.text },
  phrase: { fontSize: 14, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
  small: { fontSize: 12, color: colors.muted, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.xs,
    minHeight: 40,
  },
  rowLabel: { fontSize: 15, color: colors.text, flexShrink: 1 },
  value: { fontSize: 15, color: colors.text, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stayValue: { minWidth: 60, textAlign: 'center' },
});
