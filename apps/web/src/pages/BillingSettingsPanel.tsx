import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { BillingStatus } from "@rakazo/contracts";
import { Button, Skeleton } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { ModelCreditsSettings } from "../components/ModelCredits";
import { SettingsRow, SettingsSection, SettingsStack } from "../components/SettingsLayout";
import { formatBillingDate, formatBillingPrice } from "../lib/billing";
import { rpc } from "../lib/rpc";

export function BillingSettingsPanel() {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    rpc.billing
      .status()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active) setError(t`Could not load billing`);
      });
    return () => {
      active = false;
    };
  }, [t]);

  async function openPortal() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { url } = await rpc.billing.portal();
      window.location.assign(url);
    } catch {
      setError(t`Could not open billing`);
    } finally {
      // Desktop opens the URL in the system browser and this page stays, so re-enable.
      setPending(false);
    }
  }

  const stateLabel = status
    ? status.state === "trialing"
      ? t`Trial`
      : status.state === "active"
        ? t`Active`
        : status.state === "past_due"
          ? t`Past due`
          : status.state === "canceled"
            ? t`Canceled`
            : t`Inactive`
    : null;

  const date = status ? billingDate(status) : null;
  const day = date ? formatBillingDate(date.at, locale) : "";
  const dateLabel = date
    ? date.kind === "trial"
      ? t`Trial ends ${day}`
      : date.kind === "ends"
        ? t`Ends ${day}`
        : t`Renews ${day}`
    : null;

  const price = status?.price ? formatBillingPrice(status.price, locale) : null;
  const seats = status?.seats ?? 0;

  if (status?.funding !== undefined)
    return (
      <ModelCreditsSettings
        status={status}
        refresh={async () => setStatus(await rpc.billing.status())}
      />
    );

  return (
    <SettingsStack>
      <SettingsSection title={<Trans>Plan</Trans>} testId="billing-settings" target="plan">
        <SettingsRow
          label={status ? stateLabel : error ? null : <Skeleton className="h-5 w-24" />}
          description={
            price || dateLabel ? (
              <>
                {price ? (
                  <span className="block">
                    {price}
                    {seats > 1 ? (
                      <>
                        {" · "}
                        <Plural value={seats} one="# seat" other="# seats" />
                      </>
                    ) : null}
                  </span>
                ) : null}
                {dateLabel ? <span className="block">{dateLabel}</span> : null}
              </>
            ) : undefined
          }
        >
          {status?.canManage && status.hasCustomer ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void openPortal()}
            >
              <Trans>Manage</Trans>
            </Button>
          ) : null}
        </SettingsRow>
        {error ? (
          <p role="alert" className="py-3 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
      </SettingsSection>
    </SettingsStack>
  );
}

function billingDate(
  status: BillingStatus,
): { kind: "trial" | "ends" | "renews"; at: string } | null {
  if (status.state === "trialing" && status.trialEndsAt) {
    return { kind: "trial", at: status.trialEndsAt };
  }
  // Unpaid and paused subscriptions do not renew until the owner resumes them.
  if (!status.currentPeriodEndsAt || status.state === "unpaid" || status.state === "paused") {
    return null;
  }
  if (status.cancelAtPeriodEnd || status.state === "canceled") {
    return { kind: "ends", at: status.currentPeriodEndsAt };
  }
  return { kind: "renews", at: status.currentPeriodEndsAt };
}
