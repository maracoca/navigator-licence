import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as api from './src/api/client';
import type { HealthResponse, Item, PlanResponse, StreetPreference } from './src/api/types';
import {
  EMPTY_FORM,
  formBudget,
  formOrigin,
  PlanForm,
  PlanInputScreen,
} from './src/screens/PlanInputScreen';
import { ReviewScreen } from './src/screens/ReviewScreen';
import { ResultScreen } from './src/screens/ResultScreen';
import { colors } from './src/theme';

type Screen = 'input' | 'review' | 'result';

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('input');
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [items, setItems] = useState<Item[]>([]);
  const [street, setStreet] = useState<StreetPreference[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<HealthResponse | null>(null);

  // Best effort: only provides the city name and the street-preference menu.
  async function loadHealth() {
    try {
      setServer(await api.health());
    } catch {
      // The request screens show connection errors themselves.
    }
  }

  useEffect(() => {
    loadHealth();
  }, []);

  async function runUnderstand() {
    setError(null);
    setLoading(true);
    try {
      if (!server) loadHealth();
      const res = await api.understand({ request: form.request.trim() });
      setItems(res.items);
      setStreet(res.street);
      setNotices(res.notices);
      setScreen('review');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function runPlan() {
    setError(null);
    setLoading(true);
    try {
      const res = await api.plan({
        origin: formOrigin(form),
        destination: { text: form.destination.trim() },
        budgetMinutes: formBudget(form),
        items,
        street,
      });
      setPlan(res);
      setScreen('result');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  function go(next: Screen) {
    setError(null);
    setScreen(next);
  }

  function newPlan() {
    setForm(EMPTY_FORM);
    setItems([]);
    setStreet([]);
    setNotices([]);
    setPlan(null);
    go('input');
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {/* The result map runs under the top inset; its panel handles the bottom one. */}
      <SafeAreaView
        style={styles.root}
        edges={screen === 'result' ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}
      >
        {screen === 'input' && (
          <PlanInputScreen city={server?.city ?? null} form={form} onChange={setForm} onNext={runUnderstand} loading={loading} error={error} />
        )}
        {screen === 'review' && (
          <ReviewScreen
            items={items}
            street={street}
            notices={notices}
            streetProperties={server?.streetProperties ?? []}
            onItemsChange={setItems}
            onStreetChange={setStreet}
            onBack={() => go('input')}
            onPlan={runPlan}
            loading={loading}
            error={error}
          />
        )}
        {screen === 'result' && plan && (
          <ResultScreen plan={plan} onEdit={() => go('review')} onNew={newPlan} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
