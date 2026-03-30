# Style Guide

This document is the single source of truth for all UI decisions. **Read this before writing or modifying any CSS, templates, or front-end code.**

## Framework

**Vanilla CSS only.** No CSS frameworks (no Pico, Bootstrap, Tailwind, etc.). All styles live in `static/style.css`. The file begins with a minimal reset and uses CSS custom properties for theming.

## Font

**Source Sans 3** — loaded from Google Fonts in `base.html`. Weights: 400 (body), 500 (labels, nav), 600 (names, buttons), 700 (headings). No other fonts. Apply via `font-family: inherit` on components.

## Design Philosophy

This is a **friendly, warm consumer app** — not a dashboard or developer tool. Every design choice should favor:

- **Readability first.** Large base font (1rem / 16px minimum), generous line-height (1.6+), high contrast between text and background. Body text should never feel cramped.
- **Warmth over neutrality.** The palette is earthy and inviting — creams, tans, and browns — not cold grays. The app should feel like opening a family photo album, not a spreadsheet.
- **Breathing room.** Generous padding and margins everywhere. Cards get at least 1.5rem padding. Sections get clear vertical spacing. When in doubt, add more whitespace.
- **Soft edges.** Rounded corners, subtle shadows, no harsh lines. Borders should be barely-there dividers, not heavy outlines.
- **Clear hierarchy.** One dominant heading per page. Use size, weight, and color to guide the eye — not decoration. Keep the number of visual "weights" small (heading, body, muted — that's usually enough).
- **Minimal friction.** Large tap targets (44px+ on mobile), obvious interactive states, no ambiguity about what's clickable.

## Color Tokens

All colors are CSS custom properties defined in `:root` in `style.css`. **Never use raw hex values in new CSS** — always reference these variables.

### Backgrounds

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-page` | `#f5f0e1` | Page background — warm cream |
| `--bg-card` | `#fffcf3` | Cards, panels, nav — soft white |
| `--bg-input` | `#fffdf6` | Input fields — near-white |
| `--bg-hover` | `#f0e9d8` | Hover states, raised surfaces |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#3b2f1e` | Headings, names, strong content |
| `--text-body` | `#5a4d3a` | Body text, descriptions |
| `--text-muted` | `#8b7a5e` | Labels, captions, secondary info |
| `--text-placeholder` | `#b5a88e` | Placeholder text in inputs |

### Borders & Dividers

| Token | Value | Usage |
|-------|-------|-------|
| `--border-default` | `#d4c9a8` | Card borders, input borders, dividers |
| `--border-focus` | `#8b7a5e` | Focus rings, active states |

### Accent

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#5a4d3a` | Primary buttons, active nav items |
| `--accent-hover` | `#4a3f2e` | Hover state on primary actions |
| `--accent-link` | `#6b5d3e` | In-text links (underlined on hover) |

### Feedback

| Token | Value | Usage |
|-------|-------|-------|
| `--color-error` | `#b43c28` | Error borders, error text |
| `--color-error-bg` | `rgba(180, 60, 40, 0.08)` | Error message background |
| `--color-success` | `#4a6441` | Success borders, success text |
| `--color-success-bg` | `rgba(74, 100, 65, 0.08)` | Success message background |

### Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 3px rgba(90, 62, 40, 0.08)` | Cards, nav — barely visible lift |
| `--shadow-md` | `0 4px 12px rgba(90, 62, 40, 0.12)` | Modals, floating controls |

## Spacing & Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `6px` | Inputs, buttons, small elements |
| `--radius-md` | `10px` | Cards, panels, list containers |
| `--space-xs` | `0.25rem` | Tight gaps (icon padding, inline spacing) |
| `--space-sm` | `0.5rem` | Between related items |
| `--space-md` | `1rem` | Between sections, form fields |
| `--space-lg` | `1.5rem` | Card padding, major section gaps |
| `--space-xl` | `2.5rem` | Page-level vertical rhythm |

## Component Patterns

### Cards / Panels
Background `--bg-card`, border `1px solid --border-default`, radius `--radius-md`, padding `--space-lg`, shadow `--shadow-sm`.

### Forms
- Inputs: `--bg-input` background, `--border-default` border, `--radius-sm`
- Focus: `--border-focus` border + `0 0 0 2px rgba(139, 122, 94, 0.2)` box-shadow
- Labels: `--text-body`, 0.9rem, weight 600, placed above input
- Primary buttons: `--accent` background, `--bg-page` text, `--radius-sm`, weight 600
- Secondary buttons: `--bg-card` background, `--border-default` border, `--text-body` text
- Danger buttons: transparent background, `--color-error` border and text

### Compact Form Variant
For dense data-entry forms (e.g., the person add/edit form), a compact variant is acceptable. Scoped to `.page-form`:
- Section margins reduced from `--space-lg` to `--space-md`
- Input vertical padding reduced
- Section titles use a left-border accent (`3px solid --accent`, normal case) instead of uppercase text
- This is an intentional departure from the default generous whitespace for forms where vertical density improves usability

### Tabs
Used inside cards to switch between content panes. Structure: `.form-tabs` flex container with `.form-tab` buttons. Active tab gets `--accent` bottom border, `--text-primary` color, weight 600. Inactive tabs are `--text-muted`. Tab switching is pure client-side JS (toggle `display` on content divs). Form data is preserved because hidden fields remain in the DOM.

### Lists
Card-row pattern: container with row items. Rows use `--bg-card` background, hover to `--bg-hover`. Name is `--text-primary` weight 600, metadata is `--text-muted`.

### Detail Pages
Two-column grid that collapses to single column below 768px. Each column is a card. Definition lists for metadata: `<dt>` is uppercase muted label, `<dd>` is primary text.

### Flash Messages
Left-border accent (3px). Error: `--color-error-bg` background, `--color-error` border. Success: `--color-success-bg` background, `--color-success` border. Radius `--radius-sm`.

### Back Arrow
Fixed top-left on inner pages (form, detail, list). SVG chevron-left icon, links to tree (home). `--text-muted` color, hover `--text-primary`. Hidden on tree page and login page via `.page-tree .back-arrow, .page-login .back-arrow { display: none; }`. Every interior template must set a `body_class` block.

### Utility Pill
Fixed top-right with `--space-xl` padding from edge. `--bg-card` background, `--border-default` border, `--radius-sm`, `--shadow-sm`. Contains "Add Person" (icon + label) and a muted logout icon, separated by a thin divider. On mobile (< 480px), the "Add Person" label hides, leaving just the icon. Hidden on login page.

## Layout Rules

- `main.container`: max-width 960px, centered, `--space-xl` vertical / `--space-lg` horizontal padding
- Tree page: full-bleed (overrides container to full width, no padding)
- No top nav bar — navigation is via back arrow (inner pages) and FAB (global actions)
- Use CSS Grid and Flexbox — no float hacks
- Responsive breakpoints: 768px (detail layout), 600px (form grids), 480px (relationship form)

## Rules

1. **No inline styles in templates.** All styling goes in `static/style.css`.
2. **No CSS frameworks.** Do not add Pico, Bootstrap, Tailwind, or any other CSS library.
3. **Use variables.** Never hardcode colors — always use the `--` custom properties above.
4. **No `!important`.** Fix selector specificity instead.
5. **Transitions on interactives.** Hover/focus states get `transition: 0.15s` on the relevant properties.
6. **Mobile-friendly.** All pages must be usable at 375px width. Use the existing breakpoints.
7. **Contrast.** Body text on page background must meet WCAG AA (4.5:1). `#5a4d3a` on `#f5f0e1` ≈ 5.2:1 — maintain this or better.
8. **Touch targets.** Buttons and tappable rows must be at least 44px tall on mobile.
9. **No decoration for decoration's sake.** Icons, borders, and visual elements must serve a purpose (hierarchy, grouping, or interaction affordance).
