# 24 · Tally: subscription tracker

**Live demo:** https://tally-demo-orpin.vercel.app/demo (signs you in to a shared demo account that resets itself)

For anyone who has lost count of what they pay for every month. Upload a CSV export from your bank or card. Tally finds the charges that repeat, shows you the charges each guess is based on, and tracks what you confirm:
- what each costs per month and per year;
- when it renews;
- when a price goes up;
- when a free trial is about to bill you;
- when something keeps charging you after you cancelled it.

There's no bank login and no third-party aggregator. You can also add subscriptions by hand.

## Run

```bash
npm install
npm run dev     # http://localhost:3024
```

Sign up, then on **Import** upload a statement or load the sample one.

| Env var | Effect |
|---|---|
| `RESEND_API_KEY` + `EMAIL_FROM` | Send reminder emails. Without them, emails are kept on the **Sent reminders** page (`/outbox`). |
| `TICK_MS` | How often the reminder job runs (default 15 min; the launch.json entry uses 5 s for testing). |
| `APP_URL` | Base URL used in email links. |

## Finding subscriptions in a statement

**Reading the CSV** (`lib/statement.ts`):
- Columns are found by name. Account-detail lines above the header are skipped.
- Amounts can be a single Amount column or separate Debit/Credit columns. `$1,234.56`, `(12.00)`, `12.00-` and `USD -3.5` all parse.
- **Date order** is worked out: a first number over 12 means day-first, and all-ISO dates are reported as year-first. Text dates like `Jan 5, 2026` and `05-Jan-26` also work.
- **Which way is money out** is also worked out: bank accounts show spending as negative, many card exports as positive. Both can be overridden on the import form.
- Only outgoing payments are kept, and only their date, description and amount. Account and card numbers, balances and incoming money are never stored.
- Re-importing an overlapping statement doesn't double anything, but two identical charges on the same day in one file are both kept.

**Merchant keys** (`lib/merchant.ts`) turn descriptions into a stable key. Removed: phone numbers, store numbers, payment processors (`PAYPAL *ADOBE` → `ADOBE`), bank boilerplate (`POS DEBIT`), payment-app prefixes (`ZELLE TO`), domain endings, trailing locations, and generic words like "subscription".

**Detection** (`lib/detect.ts`) is deliberately conservative. A suggestion needs all of:
- a regular gap between charges (weekly, every 2 weeks, monthly, quarterly or yearly), with at least 80% of the gaps in range;
- a steady price: one change now and then is fine and gets reported; amounts that move every time are spending, not a subscription;
- a recent charge, so a series that stopped (a cancelled meal kit) isn't suggested.

When one merchant bills several plans (Apple: iCloud at $2.99 and Music at $10.99), each amount is detected as its own series. Every suggestion shows:
- its cadence;
- the next expected date, on the usual billing day;
- the most recent price change;
- a "very regular / mostly regular" label;
- the charges it's based on.

You confirm or ignore each one; nothing is added automatically.

## Tracking

- **Billing dates** keep their billing day: a subscription on the 31st bills Feb 28, then Mar 31. Editing a subscription without touching its date keeps that billing day.
  - Past dates roll forward on their own.
  - A free trial whose end date passes becomes active, billing from the day it ended.
- **Totals:** monthly and yearly. Calendar cycles convert exactly ($36.99 a month is $443.88 a year); weekly cycles use 52.18 weeks a year.
- **Charges are matched to subscriptions** by merchant key. With several plans under one merchant, each charge goes to the plan closest in price; a charge more than 35% away from every plan stays unmatched.
- **Overview alerts:**
  - **charged after you cancelled** (with the total, so you can ask for a refund);
  - **price changed** (the latest charge differs from what's on file, with a one-click update);
  - **free trial ending** within 3 days;
  - **yearly renewal** within 14 days;
  - **possible duplicate** (same name, or same merchant at about the same price).

  Alerts can be dismissed, and stay dismissed.
- **Reminder emails:**
  - Sent N days before each charge (per subscription, default 3) and 3 days before a trial ends.
  - Everything due goes in one email, and each item is sent once.
  - A date that has already passed is never reminded about.
  - Reminders can be turned off.
- The **"Paid with"** field takes a label only. Anything that looks like a card number is refused.
- Removing an imported statement removes its transactions too. Subscriptions can be exported to CSV, with a guard against spreadsheet formula injection.

## Verified

- **Unit tests** (`tests/unit.mjs`, run with `npm test`, 13 checks):
  - billing-day clamping and roll-forward, and monthly/yearly conversions;
  - statement parsing: preamble, Debit/Credit columns, day-first dates, card exports with positive purchases, sign override, bad files;
  - merchant keys;
  - detection on 13 months of generated spending: finds Netflix (with its price rise), Spotify, both Apple plans, the gym, Adobe, rent and a yearly domain; ignores groceries, coffee, Amazon, fuel, varying utilities, card autopay and a stopped meal kit;
  - rejection of irregular, single, stopped and ever-changing series;
  - import de-duplication;
  - candidate exclusion and charge matching across two Apple plans;
  - every alert type, and dismissals;
  - trial-to-active rolling;
  - reminders: grouped, sent once, none for past dates, and off means off.
- **End to end in the browser:**
  - A card CSV with Debit/Credit and card-number columns found NYT (with a $17 → $25 rise) and Spotify, and ignored groceries and payments.
  - The card number in a "Paid with" label was refused.
  - A free trial was added, and a reminder email arrived in the outbox within one 5-second tick.
  - Cancelling Spotify as of Nov 1 flagged its Nov 9 charge.
  - On a second account, the sample statement was detected as expected. Rent was ignored, Netflix tracked, and setting the old price raised a price alert that the one-click update cleared. The Hulu after-cancel alert was dismissed.
  - Re-uploading the same file added 0 payments ("3 already imported").
  - Removing a statement removed its charges and alerts.
  - Each account sees only its own subscriptions (404 on the other account's).
  - Logged out, the pages redirect to login and the CSV export returns 401.
  - No horizontal overflow at phone width.
- `next build` passes.

**Not verified:** real email delivery (no Resend key on this machine) and real bank exports beyond the formats above.

## Known limitations

- Single currency (USD formatting).
- Changes to the merchant-key rules don't re-key transactions already imported. A real product would store a rules version and re-key on upgrade.
- Utility bills and other recurring payments whose amount changes every month aren't detected. Add them by hand.

## Next steps toward a paid product

- Optional live bank connection (Plaid or similar), so new charges arrive without exports.
- Price-change detection on every new charge, with a notification.
- Cancellation help: known cancel links and steps for common services.
- Shared household view (fits #25), with "who pays for what".
- Calendar (ICS) feed of upcoming charges, as in #18.
