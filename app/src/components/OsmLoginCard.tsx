import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import type { OsmConfig } from '../api/types';
import type { OsmSession } from '../osm/session';
import { colors, radius, space } from '../theme';
import { OsmLoginWebView } from './OsmLoginWebView';
import { Button, Card } from './ui';

/** A code from OSM's "copy this code" page: one token, no spaces. */
const looksLikeCode = (s: string) => /^[A-Za-z0-9_\-~.]{20,200}$/.test(s.trim());

/**
 * One-time OpenStreetMap login on OSM's own page, shown inside the app (OsmLoginWebView): the code OSM shows
 * after "Allow" is picked up automatically. Fallback: open the page in the browser and paste the code.
 */
export function OsmLoginCard(props: {
  config: Extract<OsmConfig, { enabled: true }>;
  session: OsmSession | null;
  onLogin: (code: string) => Promise<void>;
  onLogout: () => void;
}) {
  const { config, session } = props;
  const [step, setStep] = useState<'start' | 'code'>('start');
  const [sheet, setSheet] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testServer = config.server.includes('.dev.');

  if (session) {
    return (
      <Card>
        <Text style={styles.title}>Street lighting questions: on</Text>
        <Text style={styles.text}>
          Logged in to OpenStreetMap{testServer ? ' (test server)' : ''} as {session.user}.
          {config.upload ? '' : ' Answers are not uploaded yet (dry run).'}
        </Text>
        <Button title="Log out" kind="secondary" small onPress={props.onLogout} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} />
      </Card>
    );
  }

  async function onCode(c: string) {
    setSheet(false);
    setCode(c);
    await submit(c);
  }

  async function openInBrowser() {
    setError(null);
    await WebBrowser.openBrowserAsync(config.authorizeUrl);
    setStep('code');
    // Coming back from the browser: the code is most likely on the clipboard already.
    try {
      const text = await Clipboard.getStringAsync();
      if (looksLikeCode(text)) setCode(text.trim());
    } catch {
      // Paste by hand.
    }
  }

  async function submit(c = code) {
    setBusy(true);
    setError(null);
    try {
      await props.onLogin(c.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text style={styles.title}>Help map street lighting</Text>
      <Text style={styles.text}>
        Log in to OpenStreetMap{testServer ? ' (test server)' : ''} once. During the walk the app will sometimes ask
        whether a street is lit; your answers are added to the map in your name.
      </Text>
      {step === 'start' ? (
        <View style={styles.row}>
          <Button title="Log in to OpenStreetMap" onPress={() => setSheet(true)} small loading={busy} />
          <Button title="Use the browser instead" kind="secondary" small onPress={openInBrowser} />
        </View>
      ) : (
        <View style={{ marginTop: space.sm }}>
          <Text style={styles.text}>After approving, copy the code OpenStreetMap shows and paste it here:</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="Code from OpenStreetMap"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <View style={styles.row}>
            <Button
              title="Paste"
              kind="secondary"
              small
              onPress={async () => setCode((await Clipboard.getStringAsync()).trim())}
            />
            <Button title="Log in" small onPress={() => submit()} loading={busy} disabled={!code.trim()} />
            <Button title="Open OSM again" kind="secondary" small onPress={openInBrowser} />
          </View>
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <OsmLoginWebView
        visible={sheet}
        authorizeUrl={config.authorizeUrl}
        server={config.server}
        onCode={onCode}
        onCancel={() => setSheet(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  text: { fontSize: 13, color: colors.muted, marginTop: space.xs },
  input: {
    marginTop: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space.sm,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.card,
  },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' },
  error: { color: colors.danger, fontSize: 13, marginTop: space.sm },
});
