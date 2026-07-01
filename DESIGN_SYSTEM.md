# Design System & Continuity Guide

This document preserves the intentional design language of Evolve. Reference it before adding UI, changing styles, or building components. The goal is to keep the app feeling **cohesive, intentional, and professional** — not rapid or generic.

## Philosophy

**One considered palette. No themes, no toggles.** The app uses a single earthy, warm color system that was deliberately chosen and is baked into every surface. Do not add dark mode, light mode toggles, or alternative palettes.

**Type and color do the work, not ornament.** Character comes from typography, motion, shape (asymmetric notch radii), and the clay accent — not gradients, excessive shadows, or decorative elements.

**Static styles belong in CSS, not JSX.** Inline `style={{}}` in components should only hold genuinely dynamic values (data-driven colors, node positions, staggered animation delays). All fixed, reusable styles must live in named CSS classes — this keeps spacing, affordances, and behavior consistent and centrally maintainable.

---

## Color Tokens

All colors are defined in `:root` in `src/index.css`. **Never use hardcoded hex colors outside the design system.**

### Base palette (earthy + warm)
```
--bg: #ece5d7              /* page background */
--panel: #fbf9f3           /* card surface, white-ish warm */
--panel-2: #f3ede1         /* raised surfaces, sidebar bg */
--ink: #2a2620             /* primary text */
--ink-soft: #6a6253        /* secondary text, disabled */
--ink-faint: #a89d88       /* tertiary, labels, hints */
--line: #e3dac7            /* borders */
--line-soft: #ece4d4       /* subtle dividers, backgrounds */
--accent: #b0563a          /* clay / terracotta — the signature color */
```

### Computed accents (never hardcode these)
```
--accent-soft: color-mix(in srgb, var(--accent) 13%, var(--panel))
--accent-ink: color-mix(in srgb, var(--accent) 64%, var(--ink))
--card-highlight: rgba(255, 253, 246, 0.7)  /* warm inset top edge on cards */
```

### Per-kind tints (for note classification)
Each note kind (academic, event, project, goal, tasks, purchase, general) has a base color and a soft variant:
```
--academic: #3a7ec0 (blue)
--academic-soft: color-mix(in srgb, var(--academic) 13%, var(--panel))
--event: #cd7a35 (orange)
--event-soft: color-mix(in srgb, var(--event) 13%, var(--panel))
--project: #4f8a5b (green)
--project-soft: color-mix(in srgb, var(--project) 13%, var(--panel))
--goal: #c0496a (pink)
--goal-soft: color-mix(in srgb, var(--goal) 13%, var(--panel))
--tasks: #8268c4 (purple)
--tasks-soft: color-mix(in srgb, var(--tasks) 13%, var(--panel))
--purchase: #3a9aa0 (teal)
--purchase-soft: color-mix(in srgb, var(--purchase) 13%, var(--panel))
--general: #8a8170 (grey-brown)
--general-soft: color-mix(in srgb, var(--general) 13%, var(--panel))
```

## Things to AVOID

### ❌ Off-palette gradients
The Build button used to have `linear-gradient(160deg, #6b4fc0, var(--accent))` — a purple-to-clay gradient. This is the classic "AI-generated UI" tell. **Never do this.** Use solid colors or same-hue subtle gradients if you need depth (see the fixed Build button for reference).

### ❌ Hardcoded shimmer highlights
The skeleton loader used to have `#eceef3` (cool blue-grey). This clashed with the warm palette. Always use palette tokens. Fixed to `var(--panel)`.

### ❌ Inline styles for static values
```javascript
// ❌ DO NOT DO THIS
<span style={{ marginTop: 12, opacity: 0.6, fontSize: 13 }}>Draft</span>

// ✅ DO THIS — create a CSS class
<span className="ni-draft">Draft</span>
```
The CSS class can be reused, centalized, and evolved. Inline styles scatter the design across the codebase.

### ❌ Native `alert()` and `confirm()`
They're jarring and look unfinished. Rare-path errors (Stripe checkout) are OK for now, but flag them as debt. For user-facing confirmations, build a proper inline confirmation UI.

### ❌ Inconsistent cursor styles
Every clickable element must signal its affordance. Add `cursor: pointer` to `.check-item`, `.check-box`, `.gen-recs-toggle`, etc. in CSS — never inline.

### ❌ Hardcoded padding/margin/sizing without a pattern
The design system has:
- `--radius: 17px` (main cards)
- `--radius-sm: 11px` (inputs, small controls)
- `--radius-notch: 21px 21px 21px 6px` (segment cards, asymmetric)
- `--radius-notch-note: 22px 7px 22px 22px` (note card header)

Use these. Don't add `border-radius: 14px` or other one-off values.

### ❌ Excessive shadows or multiple shadows on unrelated elements
Shadows follow a pattern:
```
--shadow-sm: light elevation, small elements
--shadow: standard elevation
--shadow-lg: hover/lifted states
```
Use these. Don't add custom shadows like `0 10px 40px rgba(0,0,0,0.2)`.

### ❌ Placeholder/generic copy
Every field placeholder should be specific to that field, not generic filler. E.g., `placeholder="e.g. next Thursday"` not `placeholder="Enter date"`.

### ❌ Random spacing
The design system uses intentional gaps:
- `8px` (tight, within components)
- `9px` (default gap in flex layouts)
- `12px` (medium spacing between sections)
- `16px` (large spacing, between major blocks)

Don't use `11px`, `14px`, `18px` without a reason. If you need a new spacing value, add it to `:root` as a token and document why.

### ❌ Meaningless animations or motion that violates `prefers-reduced-motion`
All animations respect `@media (prefers-reduced-motion: reduce)`. Every keyframe animation must have a corresponding `@media` block that disables it for users who prefer reduced motion.

### ❌ Off-brand icons or emoji walls
The app uses a mix of hand-picked emoji and text labels. Don't sprinkle decorative emoji everywhere; every icon should serve a purpose.

---

## Typography

```
--display: 'Inter', system sans       /* headings + brand only */
--font: 'Inter', system sans          /* body text */
```

### Sizing & hierarchy
```
15px (body)           /* most text, default */
13px (secondary)      /* labels, descriptions, metadata */
12px / 11px (tertiary) /* fine print, hints, timestamps */
14-15px (headings)    /* section titles (not gigantic) */
```

### Font weights
- 400 (normal) — body text
- 500–550 (medium) — labels, secondary
- 600–650 (semibold) — titles, badges
- 700 (bold) — only for emphasis, rare

### Letter spacing
- `-0.005em` (base, already on body)
- `normal` on labels and UI (override the base)

**Never use uppercase "eyebrow" labels or wide letter-spacing for aesthetic effect.** Keep type natural and calm.

---

## Shape Language

The app uses an **asymmetric "leaf" corner** as its signature shape:

```
--radius-notch: 21px 21px 21px 6px      /* three soft, one tucked (bottom-left) */
--radius-notch-note: 22px 7px 22px 22px /* note header tucks top-right, near toggle */
--radius-notch-sm: 13px 13px 13px 4px   /* small variant */
```

This is intentional and distinctive — it reads as **crafted**, not generic rounded-rectangle everywhere. Don't replace it with uniform `border-radius: 16px`.

---

## Spacing & Layout

### The app shell
```css
.app {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr) 340px;
  height: 100vh;
  overflow: hidden;
}
```
Three columns: sidebar (fixed), main (flex), calendar (fixed). Responsive breakpoints at `620px` (stack to single column) and `980px` (hide calendar).

### Component gaps
- `gap: 8px` — tight, within a single section
- `gap: 9px` — default in most flex rows
- `gap: 10px` — moderate
- `gap: 12px` — between sections

Don't add random gaps; use these.

### Card padding
- `12-14px` — standard internal padding
- `11px` — inputs, small cards
- `16-20px` — large cards, headers

---

## Interactive Elements

### Focus state (global)
```css
:where(button, input, textarea, [role='button'], [tabindex]):focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 2px;
}
```
This is baked into **every** focusable element. Never override it with a different focus style.

### Hover states
- Buttons: `transform: translateY(-2px)` + enhanced shadow (not color change).
- Cards: subtle shadow lift or border color change.
- Never use `brightness()` or `opacity` for hover; that's jarring.

### Disabled state
```css
:disabled {
  background: var(--line);           /* greyed out */
  color: var(--ink-faint);           /* faded text */
  cursor: default;                   /* not clickable */
  box-shadow: none;                  /* no elevation */
}
```

---

## Animations & Motion

### Entrance animations
```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes chip-rise {
  from {
    opacity: 0;
    transform: translateY(7px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes popIn {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

### Duration & easing
- **Quick interactions:** 0.15s (border, color changes)
- **Entrance animations:** 0.4–0.5s (fade in, list items)
- **Easing:** `ease`, `cubic-bezier(0.2, 0.8, 0.2, 1)` (smooth, not bouncy)

### Respect motion preferences
Every animation must have a paired `@media (prefers-reduced-motion: reduce)` that disables it. See the CSS for examples.

---

## Component Patterns

### Checklist items
```css
.check-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--line-soft);
  cursor: pointer;
}

.check-box {
  width: 19px;
  height: 19px;
  border-radius: 6px;
  border: 1.8px solid var(--line);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.check-box.on {
  background: var(--tint);          /* uses the note's kind color */
  border-color: var(--tint);
  color: #fff;
}

.check-item.done .ci-text {
  text-decoration: line-through;
  color: var(--ink-faint);
}
```

### Buttons
- **Primary (Build):** solid clay gradient with same-hue top highlight, clay-tinted shadow.
- **Secondary:** outlined, solid background, border on hover.
- **Disabled:** greyed out, no shadow, cursor: default.

### Pills & badges
```css
.meta-pill {
  background: var(--accent-soft);
  color: var(--accent-ink);
  border-radius: 20px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
}
```

### Alerts
```css
.alert {
  display: flex;
  gap: 11px;
  background: var(--event-soft);
  border: 1px solid color-mix(in srgb, var(--event) 22%, transparent);
  border-radius: 11px;
  padding: 12px 13px;
  margin-bottom: 13px;
}

.alert.briefing {
  background: var(--project-soft);
  border-color: color-mix(in srgb, var(--project) 30%, transparent);
}
```

### Dropdowns / Toggles
The collapsible recommendations section uses:
```css
.gen-recs-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.gen-recs-chevron {
  transform: rotate(-90deg);
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.gen-recs-chevron.open {
  transform: rotate(0deg);
}
```

---

## Accessibility Requirements

- **Keyboard navigation:** Every interactive element must be focusable with Tab and operate with Enter/Space.
- **ARIA roles:** Use semantic roles (`tablist`, `tab`, `radio`, `radiogroup`, `button`, `status`).
- **Color contrast:** All text must have WCAG AA contrast (4.5:1 for small text).
- **Motion:** All animations must respect `prefers-reduced-motion: reduce`.
- **Labels:** Form inputs and buttons must have accessible labels (visible or aria-label).

---

## Responsive Design

### Mobile breakpoint: `620px` and below
- Stack to single column (sidebar left, main center, calendar bottom).
- Hide unnecessary UI.
- Increase touch target sizes.

### Tablet breakpoint: `980px` and below
- Calendar panel hides or becomes a modal.
- Main panel gets full width.

### Desktop: `980px` and above
- Three-column layout (sidebar, main, calendar).

---

## When Adding New Features

1. **Define it in the design system first.** If it's a new component or spacing value, add it to `DESIGN_SYSTEM.md` and `:root` in the CSS.
2. **Use existing tokens.** Colors, radii, shadows, gaps, font sizes — pull from the defined set. If you need something new, it probably means the design isn't cohesive yet.
3. **Keep inline styles minimal.** Only data-driven values in JSX; static styles in CSS classes.
4. **Test keyboard navigation and focus.** Every new interactive element must be keyboard-accessible.
5. **Respect motion preferences.** If you animate, add the `@media (prefers-reduced-motion)` variant.
6. **Verify contrast.** Use a tool like WebAIM to check text/background contrast is WCAG AA.

---

## When Refactoring

- **Move inline styles to CSS classes** — this is always a win.
- **Consolidate spacing** — if you see three different gaps in one component, standardize them.
- **Check for hardcoded colors** — replace with tokens.
- **Audit border-radius** — use the signature notch or the standard rounded corners, not one-offs.
- **Test in the browser** — changes to design tokens ripple everywhere; make sure they look intentional.

---

## Summary

The app's design is **intentional, cohesive, and on-brand.** Every color, radius, shadow, and spacing value serves a purpose. Maintaining this means:

✅ Use the defined token system.
✅ Keep static styles in CSS, dynamic in JSX.
✅ Respect accessibility requirements (keyboard, motion, contrast).
✅ Avoid off-palette gradients, hardcoded colors, and one-off styling.
✅ Test changes in the browser — design isn't done until it looks right.

If something feels inconsistent, check this document first. If it's not here, it probably shouldn't be added without deliberate design thought.
