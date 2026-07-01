# Changelog

## Polish audit — 2026-07-01

A professional audit pass. The headline finding: **this codebase was already in
good shape** — it has a single coherent design-token system, responsive
breakpoints, a global focus-visible ring, `prefers-reduced-motion` support, and
keyboard-accessible controls. So this pass deliberately did *not* rewrite working
code. It fixed the genuine "typed it fast" signals and left the solid parts alone.

A restore point is preserved on the `backup/pre-polish-audit` branch.

### Design consistency
- **Removed an off-palette purple gradient from the primary "Build" button.** It
  was `linear-gradient(160deg, #6b4fc0, var(--accent))` with purple-tinted
  shadows — the classic generic-AI gradient. Replaced with a solid clay treatment
  (faint same-hue top highlight + clay-tinted shadow) that matches the earthy
  design system and the app's own component guidelines.
- **Fixed the skeleton shimmer highlight.** It used a hardcoded cool blue-grey
  (`#eceef3`) that clashed with the warm palette; now uses the warm `--panel`
  token so loading states read on-brand.

### Code quality — design system hygiene
- **Moved one-off inline styles out of JSX and into the stylesheet** across
  `Sidebar`, `CalendarPanel`, and `Segments`. Static values (cursors, margins,
  opacity, fixed sizes, the briefing-alert variant, milestone title styling) now
  live in named CSS classes; only genuinely dynamic styles (data-driven kind
  colors, mind-map node positions, staggered animation delays) remain inline.
  This makes spacing/behavior consistent and centrally maintainable.
- **Removed dead CSS.** Orphaned `.ai-toggle-text strong` / `.ai-toggle-text span`
  selectors that no longer matched any markup were deleted; `.ai-toggle-text` was
  repurposed as the tier status line it actually styles.
- Added semantic classes: `.ms-title(.done)`, `.alert.briefing`,
  `.opt-head.spaced`, `.ce-main`, `.cal-empty`, `.cal-conn-slot`,
  `.ai-tier-label`, `.ni-draft`, `.skel-card`.

### Repository hygiene
- Stopped tracking committed `.DS_Store` files and added them to `.gitignore`.

### Deliberately NOT changed (and why)
- **`alert()` on checkout errors** (2 spots) — unpolished, but they're rare error
  paths in the Stripe flow, which is off by default (free mode). Building a global
  toast system for a disabled feature is scope creep; flagged as a follow-up.
- **`window.confirm` on note delete** — native, but standard and safe; a custom
  modal adds risk for little gain here.
- Core engine, state management, and API layer were left untouched — they are
  already well-structured, typed, and documented.

### Verification
- `tsc --noEmit` clean; no runtime console errors; changes confirmed in-browser
  (Build button gradient, checklist cursors, calendar layout).
