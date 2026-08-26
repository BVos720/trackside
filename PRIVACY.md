# Privacy Policy — Trackside

**Last updated: 26 August 2026**

> **PLACEHOLDERS — fill these before publishing.**
> `[LEGAL NAME]` — your name or trading name, as the data controller.
> `[CONTACT EMAIL]` — a real address you monitor.
> `[COUNTRY]` — assumed the Netherlands throughout; change if not.
>
> This document was drafted from the app's actual source code, not from a
> template. It is accurate to what the software does. It has **not** been
> reviewed by a lawyer — see the note at the end.

---

## The short version

**Trackside does not collect your data.** There is no account, no login, no
server of ours, and no analytics. Everything you create — your spots, events,
timetables, entry lists, gear and photos — is stored on your device and stays
there.

Three things reach the internet, and only when you use the feature that needs
them. They are listed in full below.

---

## What is stored, and where

Everything below is held **on your device only**. We never receive it, and we
cannot see it, recover it, or restore it for you.

| What | Contains |
|---|---|
| Spots | Names, coordinates, notes, access classifications, camera settings |
| Events | Names, dates, the spots you selected, your planned route and times |
| Timetables | Sessions you imported or typed |
| Entry lists | Car numbers, teams, drivers, and which you have photographed |
| Gear | Bodies and lenses you added, and their crop factors |
| Photos | Reference images you attach to a spot |
| Import layouts | Saved column mappings for reading PDFs |
| Preferences | Theme, accent colour, map detail settings, display name |
| Weather | Cached forecasts for events you planned |

If you delete the app, all of it is deleted with it. There is no backup on our
side. **Export an event bundle from the app if you want a copy you keep.**

---

## What leaves your device

Nothing about you is transmitted. Three network requests occur, each tied to a
specific feature:

### 1. Weather forecasts — only when you ask for one

When you request a forecast for an event, your device sends the **coordinates
of that event** and its timezone to **Open-Meteo** (`api.open-meteo.com`) to
retrieve cloud cover and precipitation. No name, no device identifier, no
account — Open-Meteo requires no API key and we hold no credentials with them.

The coordinates sent are the *event's* location — a circuit — not your live
position.

Open-Meteo's privacy policy: <https://open-meteo.com/en/terms>

### 2. 3D terrain — only when you switch it on

With 3D terrain or hillshading enabled, the map requests elevation tiles from
**Amazon Web Services** (`elevation-tiles-prod.s3.amazonaws.com`). What is sent
is the tile coordinates of the area on screen, which reveals roughly what part
of the world you are looking at.

Terrain is a planning feature intended for use at home. It is off at a circuit
and requires a connection, so it does not run in the field.

### 3. Map icons

The map style requests its icon sheet from **protomaps**
(`protomaps.github.io`). No information about you is included.

### In every case

Because these are ordinary internet requests, the service on the other end can
see **your IP address**, as with any website you visit. Under the GDPR an IP
address is personal data, which is why it is disclosed here even though we
neither receive nor store it.

**The map itself, its labels, and the circuit data are bundled inside the app**
and are not downloaded. Trackside is designed to work with no signal, which is
also why so little leaves the device.

---

## Permissions the app asks for

**Location** — to show where you are on the map and to work out how long a walk
between spots will take. Used on your device only. Your position is never
transmitted, including to us.

**Compass** — to turn the sun dial and your position marker to face the way you
are facing. On-device only.

**Photo library** — only when you add a reference photo to a spot. Trackside
reads the image you pick and nothing else. It does not scan your library.

You can refuse any of these. The app continues to work with reduced function —
without location it will not show where you are, and without photos you simply
have no reference images.

---

## Photos and location data in images

Photos carry hidden metadata: **where and when they were taken**, and on which
device. For reference photos of a race circuit this matters more than usual —
the locations are often ones you would not want to publish.

When you add a photo on iOS or Android, Trackside **re-encodes it**, which
removes that metadata from the stored copy. Your original, in your photo
library, is untouched.

**On the web version this stripping does not happen.** The file is stored as
your browser provided it, metadata included. Since photos on the web version
are held only in memory for one session and are not uploaded anywhere, they do
not leave your machine — but the distinction is recorded here rather than
glossed over.

Nothing you photograph is uploaded, shared or published by Trackside.

---

## What we do not do

- No accounts, no sign-in, no profiles
- No analytics, telemetry, crash reporting or usage tracking of any kind
- No advertising and no advertising identifiers
- No third-party SDKs that collect data
- Nothing is sold, shared or disclosed to anyone, because nothing is received

This is verifiable rather than a claim: the app contains no analytics or
tracking libraries at all.

---

## Payments

If Trackside offers a paid subscription, the payment is handled entirely by
**Apple** through the App Store. We never see your card details, billing
address or any payment information. Apple provides only whether a subscription
is active.

Apple's privacy policy: <https://www.apple.com/legal/privacy/>

---

## Your rights under the GDPR

You are in control of everything, because everything is on your device:

- **Access and portability** — export an event bundle from within the app; it
  is plain JSON you can read in any text editor.
- **Erasure** — delete an item in the app, or uninstall it to remove everything.
- **Rectification** — edit anything, at any time.

We cannot action a data request on your behalf, because we hold nothing to
action it against. If you believe otherwise, contact us at `[CONTACT EMAIL]`.

If you have a complaint, you may contact your national data protection
authority. In `[COUNTRY]` this is the Autoriteit Persoonsgegevens
(<https://autoriteitpersoonsgegevens.nl>).

---

## Children

Trackside is a tool for photographers at motorsport events and is not directed
at children. We do not knowingly collect anything from anyone, of any age.

---

## Changes

If this policy changes, the date at the top changes with it. If a change ever
means data would be collected — which is not currently planned — you will be
told in the app before it takes effect, not quietly in an update.

---

## Contact

`[LEGAL NAME]`
`[CONTACT EMAIL]`

---

> **Not legal advice.** This was drafted to describe the software accurately,
> by reading its source. It has not been reviewed by a lawyer. Before
> publishing — particularly alongside a paid subscription, and for an app used
> in an environment where people can be hurt — have a qualified professional in
> `[COUNTRY]` review both this and the Terms of Use.
