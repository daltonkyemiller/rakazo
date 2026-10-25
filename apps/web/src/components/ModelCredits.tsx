import { Trans, useLingui } from "@lingui/react/macro";
import type { BillingStatus } from "@rakazo/contracts";
import {
  DEFAULT_MONTHLY_CREDIT_AMOUNT,
  MODEL_CREDIT_AMOUNTS,
  ModelCreditAmountSchema,
} from "@rakazo/contracts";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@rakazo/ui-web";
import { Check, RefreshCw } from "lucide-react";
import { useState } from "react";
import { rpc } from "../lib/rpc";
import { useSignOut } from "../lib/sign-out";
import { SettingsRow, SettingsSection, SettingsStack } from "./SettingsLayout";

type CreditAmount = (typeof MODEL_CREDIT_AMOUNTS)[number];

export function CreditAmountSelect({
  value,
  onChange,
  monthly = false,
  size = "xl",
}: {
  value: CreditAmount;
  onChange: (amount: CreditAmount) => void;
  monthly?: boolean;
  size?: "default" | "xl";
}) {
  const { t } = useLingui();
  const items = MODEL_CREDIT_AMOUNTS.map((amount) => ({
    value: amount,
    label: monthly ? t`$${amount / 100} / month` : `$${amount / 100}`,
  }));
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(ModelCreditAmountSchema.parse(next));
      }}
      items={items}
    >
      <SelectTrigger
        aria-label={monthly ? t`Monthly credits` : t`Credit amount`}
        className="w-full"
        size="default"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="p-1">
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className={size === "xl" ? "py-2 text-base" : undefined}
          >
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CreditChoice({ status }: { status: BillingStatus }) {
  const { t } = useLingui();
  const features = [
    t`Bots and browser automation`,
    t`Scheduled routines`,
    t`Web, desktop and mobile`,
  ];
  const [amount, setAmount] = useState<CreditAmount>(DEFAULT_MONTHLY_CREDIT_AMOUNT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const { logOut, signingOut } = useSignOut(
    () => window.location.assign("/sign-in"),
    () => setError(true),
  );
  async function choose(ownKey: boolean) {
    setPending(true);
    setError(false);
    try {
      if (ownKey) {
        await rpc.billing.selectFunding({ funding: "byok" });
        window.location.assign("/onboarding");
      } else {
        const { url } = await rpc.billing.purchaseCredits({
          amountCents: amount,
          monthly: true,
        });
        window.location.assign(url);
      }
    } catch {
      setError(true);
      setPending(false);
    }
  }
  return (
    <div
      data-testid="billing-paywall"
      className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-6 py-12"
    >
      <Button
        className="fixed top-4 right-6"
        variant="text"
        disabled={pending || signingOut}
        onClick={() => void logOut()}
      >
        <Trans>Log out</Trans>
      </Button>
      <h1 className="text-heading1 font-medium">
        <Trans>Choose how to use Rakazo</Trans>
      </h1>
      <div className="grid gap-4 min-[480px]:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-medium">
              <Trans>Your subscription or API key</Trans>
            </h2>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <p className="flex h-12 items-center text-3xl font-medium tracking-tight">
              <Trans>Free</Trans>
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans>ChatGPT, Claude, or any model provider.</Trans>
            </p>
            <ul className="space-y-3 text-sm">
              {features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="border-t-0 bg-transparent">
            <Button
              className="w-full bg-background dark:bg-transparent"
              variant="outline"
              disabled={pending || !status.canManage}
              onClick={() => void choose(true)}
            >
              <Trans>Connect my own</Trans>
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-lg font-medium">
              <Trans>Rakazo credits</Trans>
            </h2>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <CreditAmountSelect monthly value={amount} onChange={setAmount} />
            <p className="text-sm text-muted-foreground">
              <Trans>${amount / 100} in monthly model credits. No API key needed.</Trans>
            </p>
            <ul className="space-y-3 text-sm">
              {features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Separator className="data-horizontal:w-8" />
            <ul className="space-y-3 text-sm">
              {[t`Models at provider cost`, t`Top up anytime`].map((benefit) => (
                <li key={benefit} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="border-t-0 bg-transparent">
            <Button
              className="w-full"
              disabled={pending || !status.canManage || !status.creditPurchasesEnabled}
              onClick={() => void choose(false)}
            >
              <Trans>Continue with credits</Trans>
            </Button>
          </CardFooter>
        </Card>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not open billing</Trans>
        </p>
      ) : null}
    </div>
  );
}

export function ModelCreditsSettings({
  status,
  refresh,
}: {
  status: BillingStatus;
  refresh: () => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const [amount, setAmount] = useState<CreditAmount>(
    ModelCreditAmountSchema.catch(DEFAULT_MONTHLY_CREDIT_AMOUNT).parse(status.monthlyAmountCents),
  );
  const [topupAmount, setTopupAmount] = useState<CreditAmount>(1000);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const balance = new Intl.NumberFormat(i18n.locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(status.balanceUsd ?? 0);
  async function action(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      await work();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  const recurring =
    status.monthlyAmountCents && !["canceled", "none", "incomplete"].includes(status.state);
  return (
    <div data-testid="model-credits">
      <SettingsStack>
        <SettingsSection title={<Trans>Credits</Trans>} target="credits">
          <SettingsRow
            label={<Trans>Available credits</Trans>}
            description={
              status.funding === "byok" ? (
                <Trans>Using your API key</Trans>
              ) : (
                <Trans>Monthly credits expire at renewal. Top-ups do not expire.</Trans>
              )
            }
          >
            <span className="text-xl font-medium tabular-nums">{balance}</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t`Refresh credits`}
              disabled={pending}
              onClick={() => void action(refresh)}
            >
              <RefreshCw />
            </Button>
            {status.canManage ? (
              <Button
                size="sm"
                disabled={!status.creditPurchasesEnabled}
                onClick={() => setPurchaseOpen(true)}
              >
                <Trans>Add credits</Trans>
              </Button>
            ) : null}
          </SettingsRow>
          {status.canManage ? (
            <SettingsRow label={<Trans>Monthly credits</Trans>} target="monthly-credits">
              <div className="w-40">
                <CreditAmountSelect monthly size="default" value={amount} onChange={setAmount} />
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  pending ||
                  !status.creditPurchasesEnabled ||
                  Boolean(recurring && amount === status.monthlyAmountCents)
                }
                onClick={() =>
                  void action(async () => {
                    if (recurring) {
                      await rpc.billing.setMonthlyCredits({ amountCents: amount });
                      await refresh();
                    } else {
                      const { url } = await rpc.billing.purchaseCredits({
                        amountCents: amount,
                        monthly: true,
                      });
                      window.location.assign(url);
                    }
                  })
                }
              >
                {recurring ? (
                  amount > (status.monthlyAmountCents ?? 0) ? (
                    <Trans>Upgrade now</Trans>
                  ) : amount < (status.monthlyAmountCents ?? 0) ? (
                    <Trans>Downgrade at renewal</Trans>
                  ) : (
                    <Trans>Update</Trans>
                  )
                ) : (
                  <Trans>Subscribe</Trans>
                )}
              </Button>
            </SettingsRow>
          ) : null}
          {status.canManage ? (
            <div className="flex flex-wrap gap-2 py-3 empty:hidden">
              {status.hasCustomer ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void action(async () => {
                      const { url } = await rpc.billing.portal();
                      window.location.assign(url);
                    })
                  }
                >
                  <Trans>Manage billing</Trans>
                </Button>
              ) : null}
              {status.funding === "byok" && (status.balanceUsd ?? 0) > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || !status.creditPurchasesEnabled}
                  onClick={() =>
                    void action(async () => {
                      await rpc.billing.selectFunding({ funding: "credits" });
                      window.location.reload();
                    })
                  }
                >
                  <Trans>Use Rakazo credits</Trans>
                </Button>
              ) : null}
              {status.funding !== "byok" && (!recurring || status.cancelAtPeriodEnd) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void action(async () => {
                      await rpc.billing.selectFunding({ funding: "byok" });
                      window.location.assign("/onboarding");
                    })
                  }
                >
                  <Trans>Use my API key</Trans>
                </Button>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="py-3 text-[13px] text-destructive">
              <Trans>Could not update billing</Trans>
            </p>
          ) : null}
        </SettingsSection>
      </SettingsStack>
      <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              <Trans>Add credits</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>One-time purchase. Credits do not expire.</Trans>
            </DialogDescription>
          </DialogHeader>
          <CreditAmountSelect value={topupAmount} onChange={setTopupAmount} />
          <Button
            disabled={pending}
            onClick={() =>
              void action(async () => {
                const { url } = await rpc.billing.purchaseCredits({
                  amountCents: topupAmount,
                  monthly: false,
                });
                window.location.assign(url);
              })
            }
          >
            <Trans>Continue to checkout</Trans>
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
