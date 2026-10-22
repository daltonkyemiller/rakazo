import type { MessageBlock } from "@rakazo/contracts";
import type { BotColorDef } from "@rakazo/core";
import { askChoiceOptions, resolveAskChoice } from "@rakazo/core";
import { useRef, useState } from "react";
import type { ViewProps } from "react-native";
import { Alert } from "react-native";
import { plainAskTitle } from "../lib/ask-title";
import { useI18n } from "../lib/i18n";
import { errorText } from "../lib/user-error";
import { QuestionCard } from "./QuestionCard";

/** A bot's multiple-choice question: one tap sends the pick as the answer. */
export function AskQuestionCard({
  block,
  accent,
  canAnswer,
  onAnswer,
  accessibilityActions,
  onAccessibilityAction,
}: {
  block: Extract<MessageBlock, { kind: "ask" }>;
  accent?: BotColorDef;
  canAnswer: boolean;
  onAnswer: (answer: string) => Promise<void>;
  accessibilityActions?: ViewProps["accessibilityActions"];
  onAccessibilityAction?: ViewProps["onAccessibilityAction"];
}) {
  const { t } = useI18n();
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Set in the handler, so a second tap cannot pass before the rows re-render disabled.
  const pending = useRef(false);
  // Shows the pick before the thread stream delivers the answered block.
  const [acceptedAnswer, setAcceptedAnswer] = useState<string>();
  const actions = block.actions ?? [];
  const options = askChoiceOptions(actions);
  const answered = block.status === "answered" || acceptedAnswer !== undefined;
  const answerText = block.status === "answered" ? block.answer : acceptedAnswer;
  const pickedId = answerText ? resolveAskChoice(answerText, actions)?.id : undefined;
  const picked = options.find((option) => option.id === pickedId);

  async function choose(optionId: string) {
    if (pending.current || answered) return;
    pending.current = true;
    setPendingId(optionId);
    try {
      await onAnswer(optionId);
      setAcceptedAnswer(optionId);
    } catch (error) {
      Alert.alert(t("Could not submit answer"), errorText(error, t("Please try again.")));
    } finally {
      pending.current = false;
      setPendingId(null);
    }
  }

  return (
    <QuestionCard
      testID="question-card"
      question={plainAskTitle(block.text)}
      subtitle={block.detail}
      subtitleIsCode={block.detailFormat === "code"}
      options={options}
      answer={answered ? (picked ?? { label: answerText || t("Answered") }) : undefined}
      accent={accent}
      pendingId={pendingId}
      onChoose={canAnswer ? (optionId) => void choose(optionId) : undefined}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
    />
  );
}
