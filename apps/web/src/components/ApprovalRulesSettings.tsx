import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionApprovalRule, ActionAutoReviewSettings } from "@rakazo/contracts";
import { Button, Switch } from "@rakazo/ui-web";
import { Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { SettingsRow, SettingsSection, SettingsStack } from "./SettingsLayout";

function describeRule(rule: ActionApprovalRule): string {
  if (rule.effect === "require_approval") {
    if (rule.matchKind === "category") {
      if (rule.matchValue === "email") return t`Ask before email actions`;
      if (rule.matchValue === "purchase") return t`Ask before purchase actions`;
      return t`Ask before ${rule.matchValue} actions`;
    }
    if (rule.matchKind === "connector") return t`Ask before ${rule.matchValue} connector`;
    return t`Ask before ${rule.matchValue}`;
  }
  if (rule.matchKind === "category") {
    if (rule.matchValue === "email") return t`Allow email actions without asking`;
    if (rule.matchValue === "purchase") return t`Allow purchase actions without asking`;
    return t`Allow ${rule.matchValue} actions without asking`;
  }
  if (rule.matchKind === "connector") return t`Allow ${rule.matchValue} connector without asking`;
  return t`Allow ${rule.matchValue} without asking`;
}

export function ApprovalRulesSettings() {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const autoReviewId = useId();
  const skipApprovalsId = useId();
  const [rules, setRules] = useState<ActionApprovalRule[]>([]);
  const [autoReview, setAutoReview] = useState<ActionAutoReviewSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPreset, setSavingPreset] = useState<"email" | "purchase" | null>(null);
  const [savingAutoReview, setSavingAutoReview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextRules, nextAutoReview] = await Promise.all([
        rpc.approvalRules.list(),
        rpc.autoReview.get(),
      ]);
      setRules(nextRules);
      setAutoReview(nextAutoReview);
    } catch (err) {
      setError(errorText(err, t`Could not load approval rules`));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function setPreset(matchValue: "email" | "purchase") {
    if (loading || savingPreset) return;
    if (
      rules.some(
        (rule) =>
          rule.effect === "require_approval" &&
          rule.matchKind === "category" &&
          rule.matchValue === matchValue,
      )
    ) {
      return;
    }
    setSavingPreset(matchValue);
    setError(null);
    try {
      const saved = await rpc.approvalRules.set({
        effect: "require_approval",
        matchKind: "category",
        matchValue,
      });
      setRules((current) => [...current, saved]);
    } catch (err) {
      setError(errorText(err, t`Could not save rule`));
    } finally {
      setSavingPreset(null);
    }
  }

  async function removeRule(id: string) {
    setError(null);
    try {
      await rpc.approvalRules.remove({ id });
      setRules((current) => current.filter((rule) => rule.id !== id));
    } catch (err) {
      setError(errorText(err, t`Could not remove rule`));
    }
  }

  async function saveAutoReview(input: { enabled?: boolean; skipApprovals?: boolean }) {
    if (loading || savingAutoReview) return;
    setSavingAutoReview(true);
    setError(null);
    try {
      setAutoReview(await rpc.autoReview.set(input));
    } catch (err) {
      setError(errorText(err, t`Could not save Auto Review`));
    } finally {
      setSavingAutoReview(false);
    }
  }

  const hasPreset = (matchValue: "email" | "purchase") =>
    rules.some(
      (rule) =>
        rule.effect === "require_approval" &&
        rule.matchKind === "category" &&
        rule.matchValue === matchValue,
    );
  const presets = [
    { matchValue: "email" as const, label: <Trans>Ask before sending external email</Trans> },
    { matchValue: "purchase" as const, label: <Trans>Ask before purchases</Trans> },
  ].filter((preset) => !hasPreset(preset.matchValue));

  return (
    <div data-testid="action-confirmation-settings">
      <SettingsStack>
        <SettingsSection>
          <SettingsRow label={<Trans>Run actions without asking</Trans>} labelFor={skipApprovalsId}>
            <Switch
              id={skipApprovalsId}
              data-testid="skip-approvals-toggle"
              checked={autoReview?.skipApprovals ?? false}
              disabled={loading || savingAutoReview || !autoReview}
              onCheckedChange={(checked) => void saveAutoReview({ skipApprovals: checked })}
            />
          </SettingsRow>
          <SettingsRow
            label={<Trans>Flag unexpected actions</Trans>}
            labelFor={autoReviewId}
            target="auto-review"
            description={
              autoReview?.enabled && !autoReview.checkerAvailable ? (
                <Trans>Add a model in Settings to use this.</Trans>
              ) : undefined
            }
          >
            <Switch
              id={autoReviewId}
              data-testid="auto-review-toggle"
              checked={autoReview?.enabled ?? false}
              disabled={loading || savingAutoReview || !autoReview}
              onCheckedChange={(checked) => void saveAutoReview({ enabled: checked })}
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={<Trans>Rules</Trans>} target="approval-rules">
          {loading ? (
            <p className="py-3 text-[13px] text-muted-foreground">
              <Trans>Loading rules…</Trans>
            </p>
          ) : (
            rules.map((rule) => (
              <SettingsRow key={rule.id} label={describeRule(rule)}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => void removeRule(rule.id)}
                >
                  <Trans>Remove</Trans>
                </Button>
              </SettingsRow>
            ))
          )}
          {!loading && presets.length > 0 ? (
            <div className="flex flex-wrap gap-2 py-3">
              {presets.map((preset) => (
                <Button
                  key={preset.matchValue}
                  variant="outline"
                  size="sm"
                  disabled={savingPreset !== null}
                  onClick={() => void setPreset(preset.matchValue)}
                >
                  <Plus data-icon="inline-start" />
                  {preset.label}
                </Button>
              ))}
            </div>
          ) : null}
          {error ? <p className="py-3 text-[13px] text-destructive">{error}</p> : null}
        </SettingsSection>
      </SettingsStack>
    </div>
  );
}
