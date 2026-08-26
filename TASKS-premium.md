# Premium — what is paid, and how the unlock works

> "$8 per month is in my opinion worth it for the planning part."

A blueprint, not a build. **Nothing here is implemented.** The decisions come
first, because the wrong split makes the app feel mean and no amount of
StoreKit fixes that.

**Checkboxes mean "an agent may take this".**

---

## The line: what is free, what is paid

The instinct above is the right one, and it has a principle behind it worth
stating: **what you record is free, what the app computes for you is paid.**

Anything that is *your data* — spots you found, photos you took, cars you
ticked off — stays free forever. Charging for access to your own records makes
the app hostile, and it is the thing that would make someone delete it rather
than subscribe. What earns money is the work the app does *on top of* that.

| Free, always | Premium |
|---|---|
| Spots: create, edit, photograph | **The route planner** — order, walk times, when to leave |
| The map, offline, with terrain | **Sun and light planning** — the dial, the scrub, golden hour |
| Events and the entry list | **Weather** for an event |
| The timetable, typed or pasted | **PDF import + column mapping** |
| Gear | **Saved import layouts** (templates) |
| Event bundles: export and import | **Multi-day planning** |

Two notes on that split:

**Export stays free, deliberately.** Someone who stops paying must be able to
get their data out. A tool that holds your work hostage is one nobody
recommends, and this app is niche enough that word of mouth is the whole
marketing plan.

**The PDF mapper is the strongest paid feature.** It is the piece with the most
work behind it, the piece nothing else does, and the one that is obviously
worth money the first time it turns a WEC entry list into 35 tickable cars.

- [ ] **P0. Confirm the split with Branco before anything is built.** This
      table is a proposal. Getting it wrong is more expensive than any code
      here, because moving a feature *behind* a paywall after release is the
      one change users genuinely resent.

---

## Pricing

$8/month is defensible for the planning half. Two things worth deciding
alongside it:

- **An annual option**, priced around 8–10 months' worth. Most people who keep
  a niche tool prefer paying once a year, and it removes eleven chances to
  cancel.
- **A season, not a year?** Motorsport is seasonal. Someone who shoots April to
  October has no use for it in January, and will cancel in November whatever
  you do. A cheaper annual price that acknowledges that may keep more people
  than a monthly plan they churn out of every winter.

Enrol in the **Apple Small Business Program**: Apple's cut drops from 30% to
**15%** under $1M/year. That moves break-even on the $99 membership from about
$142/year of sales to about $117.

- [ ] **P1. Decide monthly-only, or monthly plus annual.**
- [ ] **P2. Enrol in the Small Business Program.** A form, once, worth 15%.

---

## Free access for yourself and others

All of these already exist and need no special code:

- **Your own phone** — simplest is a build-time flag, or an unlock tied to your
  local user id. Costs nothing, never expires, no Apple involvement.
- **TestFlight testers get everything free.** In-app purchases in a TestFlight
  build run in the **sandbox**, so a friend testing at a circuit has premium
  without a code.
- **Offer codes** — 1,000 per quarter, free, for subscriptions.
- **Promo codes** — 100 per app version, for a one-off unlock.

- [ ] **P3. A founder/override flag**, so your own devices and a couple of
      friends never see a paywall.

---

## How the unlock is stored

The app has **no accounts and no backend**, and this must not be the thing that
forces one. Purchase state can live locally like everything else.

- [ ] **P4. Pick the library.** `expo-in-app-purchases` is deprecated;
      **RevenueCat** is the usual answer for Expo and has a free tier well
      above anything this app will earn. It also handles receipt validation and
      restore, which are the fiddly parts.

- [ ] **P5. Entitlement as a domain concept, not a boolean in the UI.** A
      single `isPremium` scattered through screens is how a paywall ends up
      half-applied. One place answers the question, everything else asks it.

- [ ] **P6. Fail open, never closed.** If the entitlement check cannot run —
      no signal, which is *the normal case at a circuit* — the app must assume
      the subscription is valid rather than lock a paying user out of their
      route plan at Brünnchen. Cache the last known state and trust it for a
      generous window. §1.4 makes this non-negotiable: an app that needs the
      internet to let you use what you paid for is broken for this audience.

- [ ] **P7. Restore purchases** must work, and be findable. New phone, reinstall,
      Apple ID change. Apple rejects apps without it.

- [ ] **P8. Nothing already created ever becomes unreadable.** If someone stops
      paying, plans they made stay visible and exportable — the *making* of new
      ones is what stops. Anything else is holding data hostage.

---

## The paywall itself

- [ ] **P9. Show it where the value is, not on launch.** The moment to ask is
      when someone taps "plan a route" or opens a PDF — with the thing they
      wanted visible behind it. A paywall on first run, before the app has
      done anything for them, converts nobody and annoys everybody.

- [ ] **P10. Say what it costs, plainly**, with the renewal terms and a link to
      the terms and privacy policy. Apple requires this; it is also just
      decent.

- [ ] **P11. A free trial worth having.** One race weekend is the natural unit
      — long enough to plan, shoot, and see whether it helped. Apple's
      introductory offers handle this.

---

## Before any of this ships

- [ ] **P12. The app has to be finished and good first.** Nobody subscribes to
      a tool they have used once. The compass is unverified on hardware, the
      theme migration is half done, and it has never run at a circuit. Charging
      before those are right converts trust into refunds.

- [ ] **P13. Terms and privacy policy published** at a public URL — Apple
      requires both, and a subscription raises the bar on the terms. Drafts
      exist: `PRIVACY.md`, `TERMS.md`. See the review note in both.

- [ ] **P14. Register a business.** Selling through the App Store needs it, and
      the KvK is where the free guidance on terms and liability lives.

---

## Done means

- The free/paid split is Branco's decision, written down, and not moved
  afterwards.
- No feature that stores *your own data* is behind the paywall.
- Entitlement fails open with no signal, and is proven so with the network off.
- Restore works on a fresh install.
- The paywall appears at the point of value, never on launch.
