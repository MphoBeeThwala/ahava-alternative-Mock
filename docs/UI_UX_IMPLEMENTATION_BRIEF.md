# Ahava UI/UX Implementation Brief

**Status:** approved design, cleared for implementation
**Scope:** `workspace/` (Next.js frontend). Backend and ML service are out of scope except where a phase explicitly says otherwise.
**Companion doc:** `docs/UI_UX_INSPIRATION_AND_PLAN.md` — the "Invisible Hand" rule there still governs Phases 1, 2, 6 and 9. Phases 3, 4, 5, 7 and 8 are allowed to touch logic, under the constraints in §1.
**Visual reference:** `docs/design/Ahava-UX-Redesign.pdf` — six artboards. Where this document and the PDF disagree, **this document wins** (the PDF is a static export and cannot express states).

---

## 0. Read this before writing any code

Work through the phases **in order**. Each phase is a separate commit (or PR) that must leave `main` shippable. Do not start a phase until the previous one passes its Definition of Done (§11).

Before Phase 1, do a read-only orientation pass and report back:

1. List every file under `workspace/src` and note which currently use `style={{…}}` heavily (there are ~539 inline style blocks across ~5,500 lines).
2. Read `workspace/src/lib/api/` in full — `patient.ts`, `doctor.ts`, `nurse.ts`, `bookings.ts`, `visits.ts`, `wearables.ts`, `admin.ts` — and produce a table of every field the API actually returns today.
3. Cross-check that table against §6.3, §7.3 and §8.3 below, which list the fields each redesigned screen wants. **Report any field the design needs that the API does not currently provide.** Do not start building until that gap list exists.

This gap report is the single most important output of the orientation pass. See §1.1.

---

## 1. Ground rules

### 1.1 Never invent clinical data — this is the rule that matters most

This app will be live and patients will act on what it shows. If a screen in the design needs a value the API does not return:

- **Do NOT** hardcode a plausible number, a mock array, a `Math.random()`, a "demo" fallback, or a sample patient.
- **Do NOT** substitute a nearby field that means something different (e.g. showing `createdAt` where the design asks for "review started at").
- **DO** either (a) hide that element entirely behind a truthiness check, or (b) render an explicit empty state that says the data is not available yet.
- **DO** list it in the gap report so a backend ticket can be raised.

Concretely, these elements in the design are **suspected to have no backing data today** and must be treated this way until proven otherwise:

| Element | Screen | Needs |
|---|---|---|
| Nurse live ETA + progress bar | Patient dashboard, patient phone | Nurse position / ETA on the booking or visit object |
| "Left the clinic 08:31 / ETA 09:07" | Patient dashboard | Visit departure + ETA timestamps |
| Vitals "against her baseline" range bars | Doctor console | Per-patient baseline min/max per metric |
| Review timeline step timestamps | Patient dashboard, patient phone | Per-stage timestamps on the triage case |
| "Who saw my record" | Sidebar nav | An access-audit endpoint |
| Model confidence score | Doctor console | Confidence value on the AI triage result |
| SANC / MP registration numbers | Several | Practitioner registration fields |
| Waiting clock ("1h 12m in queue") | Doctor console | Derivable from case `createdAt` — verify before using |

Anything on that list that turns out to exist: wire it. Anything that does not: hide the element, note it, move on. **A missing feature is fine. A fabricated vital sign is a patient-safety incident.**

### 1.2 Preserve behaviour

- Do not change API call signatures, request payloads, validation rules, auth flows, or `RoleGuard` behaviour.
- Keep every existing `onClick` / `onSubmit` handler and its semantics. You may move a handler to a new component; you may not change what it does.
- `AuthContext` and `ToastContext` stay as they are.
- If a UI change appears to require a logic or schema change, **stop and flag it** rather than proceeding.

### 1.3 Engineering hygiene

- Branch per phase: `ux/phase-1-foundations`, `ux/phase-2-components`, etc.
- **No new runtime dependencies** without asking first. Everything in this brief is achievable with what is already installed (Next.js, React, Tailwind v4). In particular: do **not** add an icon library, a component library, a chart library, or a CSS-in-JS runtime.
- After every phase: `pnpm lint`, `pnpm type-check`, `pnpm --filter workspace build` must all pass clean. No new warnings.
- No `any` types introduced. No `@ts-ignore`.
- Do not reformat or restructure files you were not asked to change in that phase.

---

## 2. The design system — exact values

These are lifted from the approved design. Use them literally; do not round, re-derive, or "improve" them.

### 2.1 Tokens

`workspace/src/app/globals.css` already defines the palette and it is **correct — do not change the existing colour values.** Warm stone against teal is deliberate and differentiating.

Add the following to `:root` alongside what is there:

```css
:root {
  /* --- existing, unchanged --- */
  /* --background #f5f3ef  --foreground #1c1917  --muted #57534e
     --card #ffffff  --border #e7e5e4
     --primary #0d9488  --primary-hover #0f766e  --primary-soft rgba(13,148,136,0.12)
     --success #059669  --warning #d97706  --danger #dc2626
     --radius 0.875rem  --radius-lg 1.125rem  --ease-out  --duration */

  /* --- add: role accents (currently hardcoded in DashboardLayout.tsx) --- */
  --role-patient: #0d9488;
  --role-doctor:  #2563eb;
  --role-nurse:   #059669;
  --role-admin:   #7c3aed;

  /* --- add: acuity (semantic, distinct from status) --- */
  --acuity-emergency: #dc2626;
  --acuity-emergency-ink: #b91c1c;
  --acuity-emergency-bg: rgba(220,38,38,0.045);
  --acuity-urgent: #d97706;
  --acuity-urgent-ink: #b45309;
  --acuity-urgent-bg: rgba(217,119,6,0.05);
  --acuity-routine: #0d9488;
  --acuity-routine-ink: #0f766e;
  --acuity-routine-bg: rgba(13,148,136,0.045);

  /* --- add: surfaces & ink --- */
  --card-sunken: #fdfcfb;
  --ink-2: #44403c;
  --ink-3: #78716c;
  --border-strong: #d6d3d1;

  /* --- add: type ramp --- */
  --text-page: 25px;      /* weight 800, letter-spacing -0.02em  */
  --text-section: 19px;   /* weight 700, letter-spacing -0.015em */
  --text-card: 15px;      /* weight 700 */
  --text-body: 14px;      /* weight 400 — FLOOR for patient-facing copy */
  --text-meta: 12px;      /* weight 600 */
  --text-eyebrow: 11px;   /* weight 800, uppercase, letter-spacing 0.09em */

  /* --- add: hit targets --- */
  --tap-min: 44px;
  --tap-primary: 56px;
}
```

Also add a utility used throughout the design for any numeric readout:

```css
.num { font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
```

Every vital sign, score, timestamp, duration, ID and currency value gets `.num`. Without it, digits jitter as values update, which looks unstable on a monitoring screen.

### 2.2 Type rules

- **Nothing below 11px anywhere.** 11px is permitted only for uppercase eyebrow labels. The codebase currently ships 41 inline font sizes under 12px, some at 8px — all must go.
- Patient-facing body copy floor is **14px**.
- Clinician-facing dense tables may use 12px for metadata only, never for a clinical value.
- Headings use negative letter-spacing as given; body copy does not.
- Add `text-wrap: pretty` to paragraph-length copy.

### 2.3 Icons — replace all 154 emoji

The app currently uses 154 emoji as icons and exactly one SVG. Emoji render differently per OS, cannot take `currentColor`, have inconsistent optical weight, and are announced by screen readers as things like "medical symbol". They are the single biggest reason the app reads as a prototype.

Create `workspace/src/components/ui/Icon.tsx`:

```tsx
export type IconName =
  | 'home' | 'heart' | 'calendar' | 'stethoscope' | 'watch' | 'user'
  | 'lock' | 'bell' | 'search' | 'chevron-right' | 'plus' | 'check'
  | 'alert-triangle' | 'alert-square' | 'check-circle' | 'phone'
  | 'clock' | 'pulse' | 'mic' | 'save' | 'signal-off' | 'menu' | 'close';

interface IconProps {
  name: IconName;
  size?: number;          // default 20
  className?: string;
  /** Accessible label. Omit for purely decorative icons (renders aria-hidden). */
  label?: string;
}
```

Implementation rules:

- One inline `<svg>` per name, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.7}` (use `2.2` only for the acuity glyphs), `strokeLinecap="round"`, `strokeLinejoin="round"`.
- Colour comes from the parent's `color` — never hardcode a stroke colour inside the component.
- `label` given → `role="img"` + `aria-label`. `label` omitted → `aria-hidden="true"` + `focusable="false"`.
- Ship it as a single file with a `Record<IconName, ReactNode>` map. No dependency, no dynamic import, no sprite sheet.

Paths for the eight icons already drawn in the approved design are in the PDF; redraw the rest to match the same stroke weight and 24px grid. Keep them geometrically simple — these are read at 18–22px.

Then sweep every emoji out of `workspace/src`. Verification: `grep -rP '[\x{1F300}-\x{1FAFF}]' workspace/src` returns nothing.

### 2.4 Acuity — colour is never the only signal

Roughly 1 in 12 men has a red–green colour deficiency. Every acuity indication carries **three** signals:

| Level | Colour spine | Glyph | Word |
|---|---|---|---|
| Emergency | `--acuity-emergency` | triangle (`alert-triangle`) | "Emergency" |
| Urgent | `--acuity-urgent` | rounded square (`alert-square`) | "Urgent" |
| Routine | `--acuity-routine` | circle-check (`check-circle`) | "Routine" |

The spine is a 5px full-height bar on the **left edge** of the row, implemented as the first column of a `grid-template-columns: 5px minmax(0,1fr)`. Not a border, not a left-border-accent card — a real grid column, so it never collapses.

Map the existing `alertLevel` values (`GREEN` / `YELLOW` / `RED`) onto routine / urgent / emergency. Keep the API values unchanged.

### 2.5 Interaction

- Minimum hit target **44px**; primary actions on phone screens **56px**.
- Keep the existing `--duration: 200ms` and `--ease-out`. No new animation.
- Respect `prefers-reduced-motion: reduce` — wrap the existing `.card-interactive` and `.btn-primary` transforms in a media query that disables them.
- Focus rings already exist in `globals.css` and are good. Do not remove them.

---

## 3. Phase 1 — Foundations

**Presentation-only. No logic changes.**

### 3.1 Fix the viewport (do this first, it is one line)

`workspace/src/app/layout.tsx` currently has:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,      // ← remove
  userScalable: false,  // ← remove
};
```

`maximumScale: 1` and `userScalable: false` block pinch-zoom on every phone. That is a WCAG 2.1 SC 1.4.4 failure, and for a South African healthcare product with older and low-vision users it is both an accessibility and a compliance exposure. Remove both lines. Nothing else in the app depends on them.

### 3.2 Tokens

Add everything in §2.1 to `globals.css`. Add the `.num` utility. Add the `prefers-reduced-motion` guard.

### 3.3 Icon component

Build `Icon.tsx` per §2.3. **Do not sweep the emoji yet** — that happens per-screen in later phases so each diff stays reviewable. Exception: `DashboardLayout.tsx` is swept now, because every screen renders it.

### 3.4 DashboardLayout

`workspace/src/components/DashboardLayout.tsx` (currently 361 lines, 27 inline style blocks, 17 emoji):

- Replace all emoji with `<Icon>`.
- Replace the `roleColor` object with the `--role-*` tokens.
- Move the inline `style={{…}}` blocks to Tailwind classes or token-driven classes.
- Keep every `aria-*` attribute already there — this file has 18 of the app's 28, and they are correct.
- Keep the mobile drawer behaviour, the verification banner, and the passport-completion banner exactly as they are.
- Add a "skip to main content" link as the first focusable element, targeting the existing `id="main-content"`.

**Definition of done:** app looks near-identical, no emoji in the shell, pinch-zoom works on a phone, `pnpm build` clean.

---

## 4. Phase 2 — Shared components

**Presentation-only.** Build these in `workspace/src/components/ui/`. Each takes `children` or explicit props and owns **no** business logic and **no** data fetching.

| Component | Purpose | Notes |
|---|---|---|
| `Icon.tsx` | (from Phase 1) | |
| `Card.tsx` | exists — keep the API, add `variant?: 'default' \| 'sunken'` and `padding?: 'sm' \| 'md'` | |
| `PageHeader.tsx` | compact 72px page header: title, subtitle, right-hand slot | **Replaces the 200px gradient hero** that currently repeats on patient, doctor and nurse dashboards |
| `StatCard.tsx` | label, big `.num` value, unit, delta, optional sparkline slot | |
| `Sparkline.tsx` | tiny inline SVG line from `number[]` | Pure presentation; no axes, no library. Renders nothing if fewer than 2 points |
| `AcuityRow.tsx` | the 5px spine + glyph + word + content per §2.4 | |
| `StatusBadge.tsx` | exists — extend variants to include `info` and `neutral` | Keep current API |
| `Timeline.tsx` | vertical step list: done / current / pending | Used by the review timeline |
| `RangeBar.tsx` | a value marker against a shaded normal band | **Only render when a real baseline range is supplied** — see §1.1 |
| `Skeleton.tsx` | pulsing placeholder block | The app has **zero** loading states today; every async screen gets one |
| `EmptyState.tsx` | icon + one line + one optional action | |
| `DataTable.tsx` | header row, hover, right-aligned `.num` columns, responsive card fallback below 768px | |

`Skeleton` matters more than it sounds: every screen currently goes blank and then pops. On a slow connection that reads as broken. Each screen that fetches must render a skeleton of its own shape.

---

## 5. Phase 3 — Patient dashboard

**File:** `workspace/src/app/patient/dashboard/page.tsx` (currently 433 lines).
**This phase may restructure JSX freely. It may not change any API call.**

### 5.1 The problem being fixed

The current screen has eight competing blocks, prints the readiness score three times, and links to Early Warning three separate times above the fold (the strip at line ~150, the large card at line ~167, and the sidebar). Four teal CTAs share identical visual weight, so there is no primary action. And `82` appears with no sentence explaining what it means.

### 5.2 Target structure

Replace the gradient hero and the eight blocks with:

1. **`PageHeader`** — "Good morning, {firstName}", date, last-sync time, notification bell.
2. **One-glance card** — a single three-column card:
   - *Left:* readiness ring (SVG circle, `stroke-dasharray`), the score, and a status pill derived from `alertLevel`.
   - *Centre:* **a plain-language sentence answering "am I alright?"**, then three `StatCard`s (HR, BP, SpO₂) with sparklines from `biometricHistory`.
   - *Right:* exactly **one** filled primary button ("Log today's vitals"), one outlined secondary ("Book a nurse visit"), one text link ("See full risk detail" → `/patient/early-warning`).
3. **Row of two:** review timeline (`Timeline`) and next visit.
4. **Recent readings** as a `DataTable`, not the current unaligned text run.

Delete the duplicate Early Warning strip and card. Early Warning is reachable from the sidebar and the text link — three entry points is two too many.

The biometric entry form moves **out** of the dashboard into a modal or a dedicated route opened by the primary button. It should not sit on the overview as four bare inputs.

### 5.3 Data mapping

Available today (verified in `lib/api/patient.ts` and the current page):

- `patientApi.getMonitoringSummary()` → `readinessScore`, `alertLevel`, `baselineEstablished`
- `patientApi.getBiometricHistory(20)` → array with `createdAt`, `heartRate`, `bloodPressureSystolic/Diastolic`, `oxygenSaturation`, `temperature`, `readinessScore`
- `bookingsApi.getMyBookings()` → `id`, `scheduledDate`, `status`, `encryptedAddress`
- `terraApi.getStatus()` → `connected`, `devices[]`

Sparklines come from `biometricHistory` — real data, already fetched.

**The plain-language sentence must be derived from real state, not written as static copy.** Suggested mapping (confirm the thresholds with a clinician before shipping):

- `alertLevel === 'GREEN'` && `baselineEstablished` → "Nothing needs your attention today."
- `alertLevel === 'YELLOW'` → name the metric that moved, e.g. "Your blood pressure has been higher than usual this week."
- `alertLevel === 'RED'` → a direct instruction to seek care, plus the emergency action promoted to primary.
- `!baselineEstablished` → "We're still learning your normal — {n} of 14 readings so far."

**Not available today** (per §1.1): nurse ETA, departure time, live progress. Until the API provides them, the "Next visit" card shows the booking date, status and address only — no ETA, no progress bar, no "on the way" pill.

**Definition of done:** one filled button on the screen; readiness appears once; no emoji; skeleton while loading; empty states for no readings and no bookings; works at 390px wide.

---

## 6. Phase 4 — Doctor triage console

**Files:** `workspace/src/app/doctor/dashboard/page.tsx` (414 lines) and `_components/*`.

This is the highest-value screen in the product — it is what a clinician network is sold on, and the metric it moves is **time to signed decision**.

### 6.1 Target structure

Three panes, full height, no page scroll:

- **Sidebar** (existing `DashboardLayout`, doctor accent).
- **Worklist** (~386px): sorted queue. Each row is an `AcuityRow` carrying acuity spine + glyph + word, a **waiting clock**, patient initials/name/age/sex, one-line complaint, and out-of-range vitals as chips. Sort tabs: *By urgency* (default) / *Longest wait* / *Mine*.
- **Review pane:** case header with patient identity and acuity, then two columns — the AI draft plus the patient's own words on the left, vitals and the decision panel on the right.

### 6.2 The AI draft must look like a draft

This is a design requirement, not decoration. The AI triage summary is labelled **"Unsigned draft"** in a warning-toned chip, shows its confidence, and lists the specific signals it used, each attributed to its source ("patient text", "watch, 09:02", "medical passport"). Doctors do not sign black boxes. Showing the evidence is what makes review fast and defensible.

Below the decision panel, state plainly: *nothing reaches the patient until you sign; your name, registration number and timestamp are attached.* Confirm that this is actually what the backend does before rendering that sentence — if the backend can release an AI result without a doctor signature, that is a finding to escalate immediately, not a copy problem.

### 6.3 Decision panel

Wire to the **existing** modals — `PrescriptionModal`, `ReferralModal`, `ReviewModal`, `FollowUpRequestModal` — and their existing handlers. Do not rewrite them; re-present them.

- Primary action is the one the acuity implies (emergency → "Refer as emergency", styled `--danger`).
- Add keyboard shortcuts: `E` refer, `P` prescribe, `M` ask for more, `N` send a nurse. Show the key as a `kbd` chip on each button. Bind on the review pane, not `window`, and never swallow browser shortcuts or modifier combos.
- Keep the existing MP-number lookup field.

### 6.4 Data

Waiting clock is derivable from the case `createdAt` if present — **verify**. Model confidence and per-patient baseline ranges are on the §1.1 suspect list: if absent, omit the confidence chip and render vitals as plain values without `RangeBar`. Do not invent a normal range.

---

## 7. Phase 5 — Nurse field mode

**File:** `workspace/src/app/nurse/dashboard/page.tsx` (430 lines, 51 inline style blocks, 8 sub-12px font sizes).

The nurse is standing in someone's home, one-handed, on a phone. She currently gets the desktop dashboard shrunk down. **Design this screen mobile-first and let the desktop layout be the adaptation, not the other way round.**

- Visit-in-progress header: patient, age, relevant chronic conditions, elapsed timer.
- Vitals as large cards, not a form grid. Each captured vital shows its value at 28–34px. Each uncaptured one is a dashed card with a 44px "Add" button.
- **Flag out-of-range at the moment of entry**, against the patient's own baseline where available (§1.1) or standard clinical ranges otherwise — and say which is being used.
- Voice notes rather than typing. If no transcription service exists, store the audio and note the gap — do not fake a transcript.
- A persistent bottom action bar: "Escalate to a doctor now" (`--danger`, 56px, always reachable) and "Finish visit".

---

## 8. Phase 6 — Responsive and accessibility sweep

### 8.1 Kill the fixed inline grids

Inline styles cannot carry media queries, so these silently fail to collapse on mobile:

| File | Line (approx) | Problem |
|---|---|---|
| `app/page.tsx` | 58 | hero `gridTemplateColumns: '1fr 1fr'` |
| `app/page.tsx` | 158 | `repeat(4,1fr)` stats |
| `app/admin/dashboard/page.tsx` | 279 | `'1fr 1fr'` |
| `app/patient/wearable/page.tsx` | 290 | `'1fr 1fr'` |
| `app/patient/visit-tracker/[visitId]/page.tsx` | 229 | `'1fr 1fr'` |
| `app/nurse/dashboard/page.tsx` | 256 | `'1fr 1fr 1fr'` |

Convert each to Tailwind responsive classes. Then check the landing page and every dashboard at 360px, 390px and 768px and fix what breaks.

### 8.2 Accessibility

The app has 28 `aria-*` attributes across 5,504 lines, 18 of them in `DashboardLayout`. Everything else is effectively unlabelled.

- Every icon-only button gets an accessible name.
- Every form input gets a real `<label>` — placeholders are not labels, and the biometric inputs currently rely on placeholders alone.
- Modals (`components/ui/Modal.tsx`): focus trap, restore focus on close, `Esc` to close, `aria-modal`, labelled by the title.
- Toasts announce via `role="status"` (or `alert` for errors).
- Check contrast on every status colour against its background at 4.5:1 for text.
- Tab through each screen and confirm a visible focus ring and a sane order.

### 8.3 Inline styles

Progressively move the ~539 inline style blocks into components and token-driven classes. The goal is that a future restyle is one file, not nineteen. This does not need to finish in one pass — but no phase may *add* new inline style blocks.

---

## 9. Phase 7 — Offline (explore before building)

**Do not implement from this brief. Produce a proposal first.**

The design assumes: readings captured offline and queued, an honest offline indicator, and SMS as a result-delivery fallback. Before any of that is built, investigate and report:

1. Is there a service worker today? (`workspace/next.config.ts`, `workspace/www/`, and the Capacitor config at `workspace/capacitor.config.ts` — note the app also ships as Android/iOS via Capacitor, which changes the options substantially.)
2. What does `lib/api/client.ts` do on network failure right now?
3. Which writes are safe to queue and replay? Biometric submission is plausibly idempotent-ish; **triage submission and prescriptions are not** — a replayed clinical action is dangerous.
4. What is the conflict story if a queued reading arrives after a later one?
5. Does the backend expose an SMS channel at all?

Then propose the smallest useful slice — most likely: offline capture of biometrics only, queued in IndexedDB, with a visible "waiting to send" state and explicit user-visible failure. Get that signed off before writing it.

---

## 10. Definition of done, every phase

- [ ] `pnpm lint` clean, no new warnings
- [ ] `pnpm type-check` clean, no new `any`, no `@ts-ignore`
- [ ] `pnpm --filter workspace build` succeeds
- [ ] `pnpm test` still passes
- [ ] Checked at 360px, 768px and 1440px
- [ ] Keyboard-only pass through the changed screens
- [ ] No emoji in any touched file
- [ ] No new inline `style={{…}}` blocks
- [ ] Loading skeleton and empty state for every async region touched
- [ ] Gap report updated if any new missing-data case was found
- [ ] Screenshots of before/after in the PR

---

## 11. Do not do

- Do not add an icon, component, chart or animation library.
- Do not change the colour palette. It is approved and differentiating.
- Do not change API contracts, payloads or validation.
- Do not touch `apps/backend` or `apps/ml-service` in Phases 1–6.
- Do not restore `userScalable: false` for any reason.
- Do not "improve" files outside the current phase's scope.
- Do not render any clinical value, range, timestamp or practitioner credential that the API did not supply. If in doubt, hide it and report it.
