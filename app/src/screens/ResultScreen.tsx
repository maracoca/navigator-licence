import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PlanResponse } from '../api/types';
import { CoverageBar } from '../components/CoverageBar';
import { OsmLoginCard } from '../components/OsmLoginCard';
import { QuestionPopup } from '../components/QuestionPopup';
import { RouteMap } from '../components/RouteMap';
import { openSettings } from '../location';
import { useOsmAccount } from '../osm/useOsmAccount';
import { useStreetQuestions, type WalkStatus } from '../osm/useStreetQuestions';
import { Button, Card, Notices, SectionTitle } from '../components/ui';
import { minutes, skippedSentence } from '../format';
import { colors, radius, space } from '../theme';

export function ResultScreen(props: { plan: PlanResponse; onEdit: () => void; onNew: () => void }) {
  const { plan } = props;
  const t = plan.totals;
  const over = t.budgetMinutes !== null && !t.withinBudget;
  const osm = useOsmAccount();
  const walk = useStreetQuestions({
    // Questions only for users logged in to OpenStreetMap.
    questions: osm.session ? plan.questions : undefined,
    token: osm.session?.token ?? null,
    onLoginExpired: osm.logout,
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.map}>
        <RouteMap plan={plan} showUser={walk.walking} highlight={walk.active?.street.segments} />
      </View>

      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <Card>
          <Button
            title={walk.walking ? 'End walk' : 'Start walk'}
            kind={walk.walking ? 'secondary' : 'primary'}
            onPress={walk.walking ? walk.stop : walk.start}
            loading={walk.status.kind === 'sending'}
          />
          <WalkStatusLine status={walk.status} canAsk={walk.canAsk} answered={walk.answeredCount} onRetry={walk.retry} />
        </Card>

        {osm.config?.enabled ? (
          <OsmLoginCard config={osm.config} session={osm.session} onLogin={osm.login} onLogout={osm.logout} />
        ) : null}

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
                {s.rating !== null
                  ? ` · ★ ${s.rating.toFixed(1)}${s.ratingCount ? ` (${s.ratingCount.toLocaleString('en')})` : ''}`
                  : ''}
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

      {walk.active && plan.questions ? (
        <QuestionPopup question={walk.active} seconds={plan.questions.rules.showSeconds} onAnswer={walk.answer} />
      ) : null}
    </View>
  );
}

function WalkStatusLine(props: { status: WalkStatus; canAsk: boolean; answered: number; onRetry: () => void }) {
  const { status } = props;
  let text: string | null = null;
  switch (status.kind) {
    case 'walking':
      text = props.canAsk
        ? `Following your walk. ${props.answered} street answer${props.answered === 1 ? '' : 's'} so far.`
        : 'Following your walk.';
      break;
    case 'no-location':
      return (
        <View>
          <Text style={[styles.muted, { color: colors.danger, marginTop: space.sm }]}>{status.message}</Text>
          {status.openSettings ? (
            <Button title="Open Settings" kind="secondary" small onPress={openSettings} style={{ marginTop: space.xs, alignSelf: 'flex-start' }} />
          ) : null}
        </View>
      );
    case 'sending':
      text = 'Sending your answers…';
      break;
    case 'sent': {
      const r = status.result;
      const n = r.applied.length;
      const what = `${n} street answer${n === 1 ? '' : 's'}`;
      text =
        r.mode === 'upload'
          ? `Thank you! ${what} added to OpenStreetMap (changeset ${r.changesetId}).`
          : `Thank you! ${what} saved (dry run: not uploaded to OpenStreetMap).`;
      if (r.skipped.length) text += ` ${r.skipped.length} skipped: ${r.skipped.map((x) => x.reason).join('; ')}.`;
      break;
    }
    case 'error':
      return (
        <View>
          <Text style={[styles.muted, { color: colors.danger }]}>{status.message}</Text>
          <Button title="Try again" kind="secondary" small onPress={props.onRetry} style={{ marginTop: space.xs, alignSelf: 'flex-start' }} />
        </View>
      );
  }
  return text ? <Text style={[styles.muted, { marginTop: space.sm }]}>{text}</Text> : null;
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
