import type { BotColorDef } from "@rakazo/core";
import { fontWeight, typeScale } from "@rakazo/ui-tokens";
import type { ReactNode } from "react";
import type { ViewProps } from "react-native";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { questionCardWidth } from "../lib/message-presentation";
import { native, useMobileTokens } from "../lib/native";

export type QuestionOption = { id: string; letter: string; label: string };

const styles = StyleSheet.create({
  card: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  heading: { flex: 1, gap: 2 },
  question: { ...typeScale.body, fontWeight: fontWeight.semibold },
  secondary: { ...typeScale.secondary, marginTop: 2 },
  code: { ...typeScale.caption, fontFamily: "Menlo", marginTop: 2 },
  options: { marginHorizontal: -8, marginTop: 6 },
  row: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  letter: {
    alignItems: "center",
    borderRadius: 7,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  letterText: { fontSize: 12.5, fontWeight: fontWeight.medium },
  label: { ...typeScale.body, flex: 1 },
  inactive: { ...typeScale.caption, marginTop: 8 },
});

/**
 * One surface for a multiple-choice question. Unanswered it lists lettered options; answered it
 * keeps only the pick, its letter in the asking bot's color.
 */
export function QuestionCard({
  question,
  subtitle,
  subtitleIsCode,
  options,
  answer,
  accent,
  pendingId,
  disabled,
  onChoose,
  accessory,
  accessibilityActions,
  onAccessibilityAction,
  testID,
}: {
  question: string;
  subtitle?: string;
  subtitleIsCode?: boolean;
  options: readonly QuestionOption[];
  /** The pick, or typed text without a letter; set once the question is answered. */
  answer?: { letter?: string; label: string };
  accent?: BotColorDef;
  pendingId?: string | null;
  disabled?: boolean;
  /** Absent when the question can no longer be answered here. */
  onChoose?: (optionId: string) => void;
  accessory?: ReactNode;
  accessibilityActions?: ViewProps["accessibilityActions"];
  onAccessibilityAction?: ViewProps["onAccessibilityAction"];
  testID?: string;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const { width: windowWidth } = useWindowDimensions();
  const answered = answer !== undefined;
  const busy = pendingId != null;

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        { backgroundColor: tokens.muted, width: questionCardWidth(windowWidth) },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text
            accessibilityRole="header"
            accessibilityActions={accessibilityActions}
            onAccessibilityAction={onAccessibilityAction}
            style={[
              styles.question,
              { color: answered ? tokens.mutedForeground : tokens.foreground },
            ]}
          >
            {question}
          </Text>
          {subtitle && !answered ? (
            <Text
              style={[
                subtitleIsCode ? styles.code : styles.secondary,
                { color: tokens.mutedForeground },
              ]}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {answered ? null : accessory}
      </View>
      {answer ? (
        <View
          testID="question-answer"
          accessible
          accessibilityLabel={t("Answered: {answer}", { answer: answer.label })}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
          style={[styles.row, styles.options]}
        >
          {answer.letter ? (
            <View
              testID="question-answer-letter"
              style={[styles.letter, { backgroundColor: accent?.light ?? tokens.primary }]}
            >
              <Text
                style={[styles.letterText, { color: accent?.eyeColor ?? tokens.primaryForeground }]}
              >
                {answer.letter}
              </Text>
            </View>
          ) : null}
          <Text style={[styles.label, { color: tokens.foreground }]}>{answer.label}</Text>
        </View>
      ) : !onChoose ? (
        <Text style={[styles.inactive, { color: tokens.mutedForeground }]}>
          {t("No longer active")}
        </Text>
      ) : (
        <View style={styles.options}>
          {options.map((option) => {
            const pending = pendingId === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityActions={accessibilityActions}
                onAccessibilityAction={onAccessibilityAction}
                accessibilityState={{ disabled: disabled || busy, busy: pending }}
                disabled={disabled || busy}
                onPress={() => onChoose(option.id)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed || pending ? native.fill : "transparent",
                    opacity: busy && !pending ? 0.5 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.letter,
                    {
                      backgroundColor: tokens.background,
                      borderColor: tokens.border,
                      borderWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Text style={[styles.letterText, { color: tokens.mutedForeground }]}>
                    {option.letter}
                  </Text>
                </View>
                <Text style={[styles.label, { color: tokens.foreground }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
