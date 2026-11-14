import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, space } from '../theme';

type ButtonKind = 'primary' | 'secondary' | 'danger';

export function Button(props: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const kind = props.kind ?? 'primary';
  const disabled = props.disabled || props.loading;
  const fg = kind === 'primary' ? colors.primaryText : kind === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      style={({ pressed }) => [
        styles.btn,
        props.small && styles.btnSmall,
        kind === 'primary' && styles.btnPrimary,
        kind === 'secondary' && styles.btnSecondary,
        kind === 'danger' && styles.btnDanger,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
        props.style,
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnText, props.small && styles.btnTextSmall, { color: fg }]}>{props.title}</Text>
      )}
    </Pressable>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={[styles.box, { backgroundColor: colors.dangerSoft }]} accessibilityRole="alert">
      <Text style={{ color: colors.danger }}>{message}</Text>
    </View>
  );
}

export function Notices({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <View style={[styles.box, { backgroundColor: colors.warnSoft }]}>
      {items.map((n, i) => (
        <Text key={i} style={{ color: colors.warn }}>
          {n}
        </Text>
      ))}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmall: { minHeight: 36, paddingHorizontal: space.md },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  btnDanger: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.danger },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.8 },
  btnText: { fontSize: 16, fontWeight: '600' },
  btnTextSmall: { fontSize: 14 },
  box: { padding: space.md, borderRadius: radius.md, gap: space.xs, marginBottom: space.md },
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
