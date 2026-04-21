# UI/UX Inspiration & Senior Developer Plan

## Core principle

**The UI/UX must not have a negative effect on the code and functionality.**  
All changes are presentation-only: same behaviour, same APIs, same flows. We improve clarity, consistency, and trust without coupling logic to visuals.

---

## Master Prompt (guardrail for UI/UX work)

**Copy and use this prompt when starting any UI/UX task (AI or developer):**

> **Role:** You are a Senior Frontend Engineer and UI/UX Specialist.
> **Task:** Improve the UI/UX of the [Specific Component/Page] based on `docs/UI_UX_INSPIRATION_AND_PLAN.md`.
> **Core Constraint: "The Invisible Hand" Rule**
> You must improve the visual layer **without altering the underlying business logic, state management, or API interactions.**
> **Implementation Requirements:**
> 1. **Styling Only:** Use CSS variables (Design Tokens) from `globals.css` (e.g., `var(--primary)`, `var(--radius)`).
> 2. **Structural Integrity:** Retain all existing props, event handlers (onClick, onSubmit), and data-binding logic. Do not change how data is fetched or validated.
> 3. **Component Mapping:**
>    * **Hierarchy:** Use the layout patterns from the `assets/` screenshots (clear primary actions, KPI blocks).
>    * **Consistency:** Apply the phased approach—ensure cards, tables, and status badges match the global design tokens.
>    * **Feedback:** Replace basic alerts with the defined "Polish" phase patterns (toasts/loading states) while keeping the same trigger logic.
> 4. **Safety Check:** If a UI change requires changing a function's logic or a backend schema, **stop and flag it.** Do not proceed with logic changes.
> **Reference Context:**
> * **Inspiration:** Refer to the 21 screenshots for scheduling, dashboards, and patient lists.
> * **Tone:** Professional, healthcare-oriented, accessible, and high-density (efficient for doctors/nurses).
> **Output:** Provide the file-by-file changes (Tailwind classes, CSS, or JSX structure) that align with Phase [Insert Phase #] of the plan.

---

## Rules of engagement (refactor, don’t rewrite)

### 1. The "Wrapper" Strategy

Do not rewrite logic-heavy components; wrap them.

| Don’t | Do |
|-------|-----|
| Change the `PatientList` (or similar) filtering logic | Wrap the existing logic in a new `Card` (or layout) component and apply `var(--shadow)`, grid, and tokens to the container |

### 2. Acuity mapping (data → UI only; no logic change)

Use design tokens to communicate urgency. Same data, different visual treatment:

| Data value | UI treatment | Token |
|------------|--------------|--------|
| High risk / Critical | Red badge or border | `var(--danger)` |
| Stable / Routine | Green badge | `var(--success)` |
| Pending / Draft | Orange or yellow badge | `var(--warning)` |

### 3. Phased priority (where to focus first)

| Priority | Area | Phase | Why |
|----------|------|-------|-----|
| **High** | Shared Nav & Layout | Phase 1 | Establishes the “feel” of the app everywhere instantly. |
| **Medium** | Doctor / Admin dashboards | Phase 2 | High-density, clear KPIs for daily workflow. |
| **Low** | Settings / Support | Phase 4 | Important for polish; less impact on core workflow. |

---

## Inspiration assets

The following reference images are saved in the workspace and can be used for design alignment:

| Location | Theme |
|----------|--------|
| `assets/` (Screenshot_2026-02-18_*.png) | Scheduling (AWV), Patient Details, Anatomical Overview, Alerts & Communication, Finance Dashboard, Hospital Dashboard, Provider Dashboard, Mobile Wellness + CareBot, Patient Support Center, Analytics Central, Pharmacy Selection, Heart/Vitals Detail, Send Reminder, My Patients, ACG Dashboard, Flows |

Reference images are under the project’s `assets/` folder (e.g. in `.cursor/projects/.../assets/`). Open any `Screenshot_2026-02-18_*.png` to compare layout, cards, tables, and navigation with the plan below.

**Recurring patterns across these references:**

- **Navigation:** Dark sidebar (blue/purple) with icon + label; active state clearly highlighted; top bar for tabs (All Patients / My Patients / Schedules) and utilities (search, notifications, profile).
- **Layout:** Card-based content; clear separation between nav, filters, list/detail, and actions.
- **Forms:** Logical grouping (e.g. Doctor, Visit Type, Date Range, Preferred Slot); icon-based choices (In-Home / Tele-Visit / Group); date range pickers; primary CTA (e.g. Schedule) prominent.
- **Data display:** KPI cards at top (large number + label); tables with avatars, acuity/status dots, and row actions; expandable rows for detail; color-coded severity (red / orange / green).
- **Communication:** Chat-style layout with quick actions (Appointments, Insurance, etc.); patient context panel (demographics, vitals, documents) beside conversation; transcription/call controls.
- **Visual language:** White/light grey content area; single accent (blue/purple/green); ample whitespace; consistent typography and iconography; subtle shadows and rounded corners.

---

## How we inspire and change our UX (senior developer plan)

### 1. Increase user experience

- **Scannable hierarchy:** Every screen has one clear title (e.g. “Patient Portal”, “Pending Visits”), optional back/context, then grouped content. No change to data or APIs—only to headings, spacing, and section labels.
- **Guided actions:** Primary action per view is obvious (e.g. “Book a Visit”, “Schedule”, “Submit”). Use size and accent color only; keep existing handlers and validation.
- **Progressive disclosure:** Use cards/sections so users see summary first (e.g. Health Status, Readiness Score); “Details” or expand for more. Implement with existing data—no new endpoints required.
- **Feedback and state:** Loading, success, and errors use the same API responses; we only improve how we show them (spinners, toasts, inline messages) and ensure focus/announcements for accessibility.

### 2. Increase seamlessness

- **Consistent navigation:** One global nav pattern across roles (sidebar or top bar with role-specific links). Same routes and `RoleGuard`; we only unify layout and active state styling.
- **Context preservation:** When opening a modal (e.g. Send Reminder, View Visit), keep the list/dashboard visible in the background and support “Cancel” to return. No change to state management beyond existing modal open/close.
- **Inline actions:** Where the references use row actions (call, view, menu), we add buttons/links that call existing APIs (e.g. approve visit, update status). No new workflows—same calls, clearer placement.
- **Filters and search:** Add or refine filter UI (date range, status, provider) that maps to existing list endpoints and query params. Backend contracts stay the same.

### 3. Increase professionalism

- **Design tokens:** Single source for colors, spacing, radius, and type (e.g. in `globals.css` and Tailwind config). Apply to existing components without changing structure.
- **Card and table consistency:** Shared card style (padding, border, shadow) and table style (header, row hover, alignment). Reuse across Patient, Nurse, Doctor, Admin dashboards.
- **Status and acuity:** Use color and icon consistently (e.g. red/orange/green for acuity; badges for visit status). Data already exists; we standardize how it’s rendered.
- **Copy and tone:** Clear, consistent labels and empty states (e.g. “No pending visits” with short guidance). No logic change—only strings and layout.

---

## Phased implementation (non-invasive)

### Phase 1 – Foundation (no behaviour change)

- **Design tokens:** Extend `workspace/src/app/globals.css` with CSS variables for primary accent, card background, border, radius, and typography scale. Use these in Tailwind `theme` if applicable.
- **Navigation:** Introduce a shared layout (e.g. `DashboardLayout`) with sidebar or top nav, role-based links, and clear active state. Keep `NavBar` behaviour (logout, user name, role); optionally move into the new layout.
- **Cards:** Create a small set of reusable card components (e.g. `Card`, `CardHeader`, `CardTitle`) that wrap existing content. Apply to Patient “Health Status” and “Record Biometrics” sections first.
- **Deliverable:** Same screens, same actions; consistent look and navigation only.

### Phase 2 – Dashboards and lists

- **KPI blocks:** On Patient dashboard, present “Readiness Score” and alert level in a clear KPI block (large number + label + status badge). Same data from `monitoringSummary`.
- **Tables:** Standardise table styling for Doctor (pending visits), Nurse (visits), Admin (users): header row, row hover, optional avatars/initials, status badges, and action column (existing handlers).
- **Filters:** Add simple filter UI (e.g. status, date) where lists already support query params. Wire to existing API calls.
- **Deliverable:** Same data and actions; improved scanability and consistency.

### Phase 3 – Forms and flows

- **Booking / scheduling:** If we have a booking form, group fields (e.g. visit type, date range, preferred slot) and use a single prominent submit button. Optional: icon-style choices for visit type (In-Home / Tele-Visit) if it fits our flow. No change to submit payload or validation.
- **Modals:** Align “Send Reminder” or similar modals with reference: clear title, from/to, optional template preview, primary “Send” and secondary “Cancel”. Keep existing send logic.
- **Deliverable:** Same validation and API calls; clearer layout and CTAs.

### Phase 4 – Polish and accessibility

- **Loading and errors:** Replace raw `alert()` with inline or toast messages where appropriate; add loading states for async actions. Use same error messages from API.
- **Empty states:** Consistent “No X yet” message and, if relevant, one short next step (e.g. “Book a visit”).
- **A11y:** Ensure focus order, aria-labels on icon buttons, and contrast for status colors. No feature changes.
- **Deliverable:** Same functionality; better feedback and accessibility.

---

## Implementation rules (protect code and functionality)

When using an AI or onboarding a developer on UI/UX work, start with the **Master Prompt** above.

1. **Styling only where it matters:** Use CSS and utility classes for layout and appearance. Do not add conditional logic that exists only for UI (e.g. hiding content that should be visible to assistive tech).
2. **Preserve behaviour:** Before changing a component, list what it does (API calls, validation, navigation). Refactors must not remove or alter those; only presentation.
3. **Component boundaries:** New UI components (cards, badges, layout) accept `children` or explicit props; they do not own business logic or fetch data unless we explicitly move existing logic into them in a separate step.
4. **Single source of truth:** Theme and layout live in a small set of files (e.g. `globals.css`, layout components). Avoid duplicating the same visual logic across many pages.
5. **Inspiration as reference:** Screenshots guide structure and style. We do not rewrite working code to match a reference exactly if that would increase complexity or break stability.

---

## Mapping inspiration to Ahava today

| Area | Current state | Inspiration takeaway | Action (non-invasive) |
|------|----------------|----------------------|------------------------|
| **Patient dashboard** | Cards for Health Status, Biometrics, Triage, Bookings | KPI-first block, icon-based actions, clear CTAs | Phase 1–2: tokens, card components, KPI block for readiness; keep all existing handlers |
| **Doctor dashboard** | Pending visits list, triage cases, approve/refer | Table with status, acuity, row actions, optional expand | Phase 2: table styling, status badges, inline actions; same APIs |
| **Nurse dashboard** | Visits, availability toggle | Clear list + status updates and filters | Phase 2: consistent list/card style and filters |
| **Admin dashboard** | User management | Table with search/filter, actions | Phase 2: same table pattern as Doctor/Nurse |
| **Navigation** | Top bar with logo, user, logout | Sidebar + top tabs, active state, icons | Phase 1: optional sidebar layout, keep role-based links and logout |
| **Forms** | Inline inputs (biometrics, triage, login) | Grouped sections, primary button, optional icons | Phase 3: group existing fields, single primary button; no validation change |
| **Alerts / feedback** | `alert()` for success/error | Inline or toast, loading spinners | Phase 4: replace alerts with non-blocking feedback |

---

## Design tokens (suggested)

Add or align in `workspace/src/app/globals.css` (and Tailwind if used):

```css
:root {
  /* Existing */
  --background: #f8fafc;
  --foreground: #0f172a;
  --muted: #475569;
  --card: #ffffff;
  --border: #e2e8f0;

  /* Inspiration-aligned optional accents (use one primary) */
  --primary: #4f46e5;      /* indigo – primary actions */
  --primary-hover: #4338ca;
  --success: #059669;
  --warning: #d97706;
  --danger: #dc2626;
  --radius: 0.75rem;       /* 12px – card/button rounding */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
}
```

Use `--primary` for main CTAs and active nav; keep existing semantic colours for status (e.g. green/yellow/red for acuity/alert). This keeps the UI consistent with the references without affecting behaviour.

---

## Summary

- **Guardrail:** Use the **Master Prompt** and **Rules of engagement** (Wrapper, Acuity mapping, Phased priority) for every UI/UX task so refactors stay safe and logic is untouched.
- **Inspiration:** Use the saved reference images for layout (sidebar + cards + tables), form grouping, status/acuity treatment, and a single accent colour.
- **Plan:** Four phases—foundation (tokens, nav, cards), dashboards/lists (KPIs, tables, filters), forms/flows (grouping, modals), polish (feedback, empty states, a11y).
- **Rule:** Every change is presentation-only. Same code paths, same APIs, same functionality; we improve clarity, seamlessness, and professionalism without negative impact on the codebase.

*Last updated: Feb 2025 — Senior developer plan for UI/UX inspiration; principle: no negative effect on code and functionality.*
