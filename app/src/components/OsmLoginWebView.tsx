import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { colors, space } from '../theme';

/**
 * Pulls the login code out of an OSM address. With the "copy the code" redirect, OSM ends on a page whose
 * address carries the code (…/oauth2/authorize/native?code=…); the first authorize page has no `code`.
 */
export function codeFromUrl(url: string, server: string): string | null {
  if (!url.startsWith(server)) return null;
  const m = url.match(/[?&]code=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * OpenStreetMap's own login page, shown inside the app. When OSM shows the code, the page closes
 * and the code is handed back, so the user never has to copy it.
 */
export function OsmLoginWebView(props: {
  visible: boolean;
  authorizeUrl: string;
  server: string;
  onCode: (code: string) => void;
  onCancel: () => void;
}) {
  const { server, onCode, visible } = props;
  // Both navigation callbacks may see the code page; hand the code back once per opening.
  const delivered = useRef(false);
  useEffect(() => {
    if (visible) delivered.current = false;
  }, [visible]);
  const catchCode = (url: string): boolean => {
    const code = codeFromUrl(url, server);
    if (!code) return false;
    if (!delivered.current) {
      delivered.current = true;
      onCode(code);
    }
    return true;
  };

  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onCancel}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>OpenStreetMap login</Text>
          <Pressable onPress={props.onCancel} hitSlop={10} accessibilityLabel="Cancel">
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        {props.visible ? (
          <WebView
            source={{ uri: props.authorizeUrl }}
            // Stop before the code page loads; check every navigation as a fallback.
            onShouldStartLoadWithRequest={(req: { url: string }): boolean => !catchCode(req.url)}
            onNavigationStateChange={(nav: WebViewNavigation): void => {
              catchCode(nav.url);
            }}
            incognito
            startInLoadingState
            renderLoading={(): React.ReactElement => <ActivityIndicator style={StyleSheet.absoluteFill} />}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.card },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  cancel: { fontSize: 16, color: colors.primary },
});
