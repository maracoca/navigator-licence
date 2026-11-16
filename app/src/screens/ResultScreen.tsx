import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PlanResponse } from '../api/types';
import { CoverageBar } from '../components/CoverageBar';
import { RouteMap } from '../components/RouteMap';
import { Button, Card, Notices, SectionTitle } from '../components/ui';
import { minutes, skippedSentence } from '../format';
import { colors, radius, space } from '../theme';

export function ResultScreen(props: { plan: PlanResponse; onEdit: () => void; onNew: () => void }) {
  const { plan } = props;
  const t = plan.totals;
  const over = t.budgetMinutes !== null && !t.withinBudget;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.map}>
        <RouteMap plan={plan} />
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Card style={over ? styles.overCard : undefined}>
          <Text style={styles.totalLine}>
            {minutes(t.walkMinutes)} walking + {minutes(t.stayMinutes)} stays ={' '}
            <Text style={[styles.total, over && { color: colors.danger }]}>{minutes(t.totalMinutes)}</Text>
          </Text>
          {t.budgetMinutes !== null ? (
            <Text style={[styles.budget, over && { color: colors.danger, fontWeight: '600' }]}>
              {over
                ? `Over your ${minutes(t.budgetMinutes)} budget by ${minutes(t.totalMinutes - t.budgetMinutes)}`
                : `Within your ${minutes(t.budgetMinutes)} budget`}
            </Text>
          ) : null}
          {t.staysShortened ? <Text style={styles.note}>Stays were shortened to fit your time.</Text> : null}
          <Text style={styles.muted}>Shortest direct walk: {minutes(t.shortestWalkMinutes)}</Text>
        </Card>

        <Notices items={plan.notices} />

        <SectionTitle>Route</SectionTitle>
        <View style={styles.stopRow}>
          <View style={[styles.dot, { backgroundColor: colors.origin }]} />
          <Text style={styles.stopName}>Start: {plan.origin.name}</Text>
        </View>
        {plan.stops.map((s, i) => (
          <View key={`${s.itemId}-${i}`} style={styles.stopRow}>
            <View style={styles.num}>
              <Text style={styles.numText}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stopName}>{s.name}</Text>
              <Text style={styles.muted}>
                {s.label} · arrive at +{minutes(s.arriveMinute)} · stay {minutes(s.stayMinutes)}
                {s.rating !== null ? ` · ★ ${s.rating.toFixed(1)}` : ''}
              </Text>
              {s.wishConfirmed ? <Text style={styles.wish}>✓ {s.wishConfirmed}</Text> : null}
              {s.address ? <Text style={styles.muted}>{s.address}</Text> : null}
            </View>
          </View>
        ))}
        <View style={styles.stopRow}>
          <View style={[styles.dot, { backgroundColor: colors.destination }]} />
          <Text style={styles.stopName}>End: {plan.destination.name}</Text>
        </View>

        {plan.coverage.length > 0 ? (
          <>
            <SectionTitle>Streets</SectionTitle>
            {plan.coverage.map((c) => (
              <CoverageBar key={c.property} coverage={c} />
            ))}
          </>
        ) : null}

        {plan.skipped.length > 0 ? (
          <>
            <SectionTitle>Skipped</SectionTitle>
            {plan.skipped.map((s, i) => (
              <View key={`${s.itemId}-${i}`} style={styles.skipped}>
                <Text style={styles.stopName}>{s.label}</Text>
                <Text style={styles.muted}>{skippedSentence(s)}</Text>
              </View>
            ))}
          </>
        ) : null}

        <View style={styles.buttons}>
          <Button title="Edit request" kind="secondary" onPress={props.onEdit} style={{ flex: 1 }} />
          <Button title="New plan" onPress={props.onNew} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: '42%', backgroundColor: colors.border },
  panel: { flex: 1 },
  panelContent: { padding: space.lg, paddingBottom: space.xl },
  overCard: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  totalLine: { fontSize: 16, color: colors.text },
  total: { fontSize: 18, fontWeight: '700', color: colors.text },
  budget: { marginTop: space.xs, color: colors.good },
  note: { marginTop: space.xs, color: colors.warn },
  muted: { color: colors.muted, fontSize: 13, marginTop: 2 },
  wish: { color: colors.good, fontSize: 13, fontWeight: '600', marginTop: 2 },
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  stopName: { fontSize: 15, fontWeight: '600', color: colors.text },
  dot: { width: 14, height: 14, borderRadius: 7, marginTop: 3, marginHorizontal: 7 },
  num: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { color: '#fff', fontWeight: '700' },
  skipped: {
    padding: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.sm,
  },
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
});
