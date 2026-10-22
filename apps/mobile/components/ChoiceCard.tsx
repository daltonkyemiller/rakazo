import type { MessageBlock } from "@rakazo/contracts";
import type { BotColorDef } from "@rakazo/core";
import { useRef, useState } from "react";
import type { ViewProps } from "react-native";
import { Alert, Pressable, StyleSheet } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { DISMISSED_CHOICE_ANSWER_ID } from "../lib/message-presentation";
import { useMobileTokens } from "../lib/native";
import { useThreadReadOnly } from "../lib/thread-read-only";
import { errorText } from "../lib/user-error";
import { NativeSymbol } from "./native-symbol";
import { QuestionCard } from "./QuestionCard";

const styles = StyleSheet.create({
  dismiss: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
});

export function ChoiceCard({
  botId,
  block,
  accent,
  onDismissed,
  accessibilityActions,
  onAccessibilityAction,
}: {
  botId: string;
  block: Extract<MessageBlock, { kind: "choice" }>;
  accent?: BotColorDef;
  onDismissed?: () => void;
  accessibilityActions?: ViewProps["accessibilityActions"];
  onAccessibilityAction?: ViewProps["onAccessibilityAction"];
}) {
  const { t } = useI18n();
  const readOnly = useThreadReadOnly();
  const tokens = useMobileTokens();
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Set in the handler, so a second tap cannot pass before the buttons re-render disabled.
  const pending = useRef(false);
  // Shows the outcome before the thread stream delivers the updated block.
  const [localAnswerId, setLocalAnswerId] = useState<string>();
  const answerId = block.answerId ?? localAnswerId;
  if (answerId === DISMISSED_CHOICE_ANSWER_ID) return null;

  // Dismissing records the server's dismissed answer id, so both outcomes share this path.
  async function submit(optionId: string) {
    if (readOnly || pending.current || answerId) return;
    pending.current = true;
    setPendingId(optionId);
    try {
      if (optionId === DISMISSED_CHOICE_ANSWER_ID) {
        await rpc("onboarding/dismissFocus", { botId });
      } else {
        await rpc("onboarding/choose", { botId, optionId });
      }
      setLocalAnswerId(optionId);
      if (optionId === DISMISSED_CHOICE_ANSWER_ID) onDismissed?.();
    } catch (reason) {
      Alert.alert(t("Could not complete action"), errorText(reason, t("Please try again.")));
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  }

  const picked = block.options.find((option) => option.id === answerId);

  return (
    <QuestionCard
      testID="choice-card"
      question={block.question}
      subtitle={block.subtitle}
      options={block.options}
      answer={picked ? { letter: picked.letter, label: picked.label } : undefined}
      accent={accent}
      pendingId={pendingId}
      disabled={readOnly}
      onChoose={(optionId) => void submit(optionId)}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      accessory={
        readOnly ? null : (
          <Pressable
            testID="choice-card-dismiss"
            accessibilityRole="button"
            accessibilityLabel={t("Dismiss")}
            accessibilityState={{ disabled: pendingId !== null }}
            disabled={pendingId !== null}
            hitSlop={10}
            onPress={() => void submit(DISMISSED_CHOICE_ANSWER_ID)}
            style={styles.dismiss}
          >
            <NativeSymbol ios="xmark" android="close" size={14} color={tokens.mutedForeground} />
          </Pressable>
        )
      }
    />
  );
}
