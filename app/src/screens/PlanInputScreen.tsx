import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import type { PlaceInput } from '../api/types';
import { MOCK } from '../api/client';
import { Button, ErrorBox } from '../components/ui';
import { colors, radius, space } from '../theme';

export interface PlanForm {
  origin: string;
  originCoords: { lat: number; lng: number } | null;
  destination: string;
  budget: string;
  request: string;
}

export const EMPTY_FORM: PlanForm = {
  origin: '',
  originCoords: null,
  destination: '',
  budget: '',
  request: '',
};

export function formOrigin(f: PlanForm): PlaceInput {
  return f.originCoords
    ? { lat: f.originCoords.lat, lng: f.originCoords.lng, label: 'My location' }
    : { text: f.origin.trim() };
}

/** Returns null for an empty field, NaN for an invalid one. */
export function formBudget(f: PlanForm): number | null {
  const t = f.budget.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

export function PlanInputScreen(props: {
  city: string | null;
  form: PlanForm;
  onChange: (f: PlanForm) => void;
  onNext: () => void;
  loading: boolean;
  error: string | null;
}) {
  const { form, onChange } = props;
  const set = (patch: Partial<PlanForm>) => onChange({ ...form, ...patch });
  const [locating, setLocating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function useMyLocation() {
    setLocalError(null);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setLocalError('Location permission was not granted. Type a starting point instead.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      set({ originCoords: { lat: pos.coords.latitude, lng: pos.coords.longitude }, origin: '' });
    } catch {
      setLocalError('Could not get your location. Type a starting point instead.');
    } finally {
      setLocating(false);
    }
  }

  function next() {
    setLocalError(null);
    if (!form.originCoords && !form.origin.trim()) return setLocalError('Enter a starting point.');
    if (!form.destination.trim()) return setLocalError('Enter a destination.');
    if (Number.isNaN(formBudget(form))) return setLocalError('Time budget must be a whole number of minutes.');
    if (!form.request.trim()) return setLocalError('Describe what you want to do on the way.');
    props.onNext();
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Plan a walk</Text>
        {props.city ? <Text style={styles.city}>Plans walks in {props.city}</Text> : null}
        {MOCK ? <Text style={styles.mock}>Mock mode: answers are sample data.</Text> : null}

        <Text style={styles.label}>From</Text>
        {form.originCoords ? (
          <View style={styles.locRow}>
            <Text style={styles.locText}>
              My location ({form.originCoords.lat.toFixed(4)}, {form.originCoords.lng.toFixed(4)})
            </Text>
            <Button title="Clear" kind="secondary" small onPress={() => set({ originCoords: null })} />
          </View>
        ) : (
          <TextInput
            style={styles.input}
            value={form.origin}
            onChangeText={(origin) => set({ origin })}
            placeholder="e.g. Gara Cluj-Napoca"
            placeholderTextColor={colors.muted}
            returnKeyType="next"
          />
        )}
        {!form.originCoords ? (
          <Button
            title="Use my location"
            kind="secondary"
            small
            loading={locating}
            onPress={useMyLocation}
            style={{ marginTop: space.sm, alignSelf: 'flex-start' }}
          />
        ) : null}

        <Text style={styles.label}>To</Text>
        <TextInput
          style={styles.input}
          value={form.destination}
          onChangeText={(destination) => set({ destination })}
          placeholder="e.g. Parcul Central"
          placeholderTextColor={colors.muted}
          returnKeyType="next"
        />

        <Text style={styles.label}>Time budget (minutes, optional)</Text>
        <TextInput
          style={styles.input}
          value={form.budget}
          onChangeText={(budget) => set({ budget: budget.replace(/[^0-9]/g, '') })}
          placeholder="e.g. 90"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
        />

        <Text style={styles.label}>What do you want on the way?</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={form.request}
          onChangeText={(request) => set({ request })}
          placeholder="Visit a museum, then grab a quick coffee, and sit on a bench if there's one along the way. Well-lit streets please."
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
        />

        <View style={{ height: space.lg }} />
        <ErrorBox message={localError ?? props.error} />
        <Button title="Next" onPress={next} loading={props.loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xl * 2 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: space.sm },
  city: { color: colors.muted, fontSize: 15, marginBottom: space.sm },
  mock: { color: colors.warn, marginBottom: space.sm },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: space.lg, marginBottom: space.sm },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 16,
    color: colors.text,
  },
  multiline: { minHeight: 120 },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  locText: { color: colors.text, flex: 1 },
});
