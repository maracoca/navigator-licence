import React, { useEffect, useRef, useState } from 'react';
import { Animated, type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ActiveQuestion } from '../osm/useStreetQuestions';
import { colors, radius, space } from '../theme';

/**
 * A Waze-style question: slides in at the bottom, two big buttons, disappears on its own
 * after `seconds` (no answer = skipped) and can be swiped down.
 */
export function QuestionPopup(props: {
  question: ActiveQuestion;
  seconds: number;
  onAnswer: (value: 'yes' | 'no' | null) => void;
}) {
  const { question, seconds, onAnswer } = props;
  const [slide] = useState(() => new Animated.Value(200));
  const [timeLeft] = useState(() => new Animated.Value(1));
  /** A question is answered (or dismissed) once. */
  const done = useRef(false);
  const answerRef = useRef(onAnswer);
  const touchY = useRef(0);
  useEffect(() => {
    answerRef.current = onAnswer;
  }, [onAnswer]);

  function close(value: 'yes' | 'no' | null) {
    if (done.current) return;
    done.current = true;
    Animated.timing(slide, { toValue: 200, duration: 180, useNativeDriver: true }).start(() => answerRef.current(value));
  }
  const closeLater = useRef(close);
  useEffect(() => {
    closeLater.current = close;
  });

  useEffect(() => {
    done.current = false;
    slide.setValue(200);
    timeLeft.setValue(1);
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    Animated.timing(timeLeft, { toValue: 0, duration: seconds * 1000, useNativeDriver: false }).start(({ finished }) => {
      if (finished) closeLater.current(null);
    });
  }, [question.street.wayId, seconds, slide, timeLeft]);

  // Swipe down to dismiss.
  const swipe = {
    onTouchStart: (e: GestureResponderEvent) => {
      touchY.current = e.nativeEvent.pageY;
    },
    onTouchMove: (e: GestureResponderEvent) => slide.setValue(Math.max(0, e.nativeEvent.pageY - touchY.current)),
    onTouchEnd: (e: GestureResponderEvent) => {
      if (e.nativeEvent.pageY - touchY.current > 60) close(null);
      else Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start();
    },
  };

  const street = question.street.name ? question.street.name : 'this street';

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: slide }] }]} {...swipe}>
      <View style={styles.card}>
        <View style={styles.grip} />
        <Text style={styles.title}>{question.text}</Text>
        <Text style={styles.sub}>
          {street} · your answer goes to OpenStreetMap
        </Text>
        <View style={styles.row}>
          <Pressable style={[styles.big, { backgroundColor: colors.good }]} onPress={() => close('yes')} accessibilityLabel="Yes">
            <Text style={styles.bigText}>Yes</Text>
          </Pressable>
          <Pressable style={[styles.big, { backgroundColor: colors.bad }]} onPress={() => close('no')} accessibilityLabel="No">
            <Text style={styles.bigText}>No</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => close(null)} hitSlop={10} accessibilityLabel="Not sure">
          <Text style={styles.notSure}>Not sure</Text>
        </Pressable>
        <View style={styles.track}>
          <Animated.View
            style={[styles.bar, { width: timeLeft.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    paddingTop: space.sm,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    overflow: 'hidden',
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.md },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  sub: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: space.xs },
  row: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  big: { flex: 1, height: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  bigText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  notSure: { textAlign: 'center', color: colors.muted, fontSize: 15, marginTop: space.md, paddingVertical: space.xs },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: colors.border },
  bar: { height: 4, backgroundColor: colors.primary },
});
