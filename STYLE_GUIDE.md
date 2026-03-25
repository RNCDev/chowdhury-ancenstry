# Style Guide

This document is the single source of truth for all UI decisions. **Read this before writing or modifying any CSS, templates, or front-end code.**

## Framework

**Vanilla CSS only.** No CSS frameworks (no Pico, Bootstrap, Tailwind, etc.). All styles live in `static/style.css`. The file begins with a minimal reset and uses CSS custom properties for theming.

## Font

**Source Sans 3** — loaded from Google Fonts in `base.html`. Weights: 400 (body), 500 (labels, nav), 600 (names, buttons), 700 (headings). No other fonts. Apply via `font-family: inherit` on components.

## Color Tokens

All colors are CSS custom properties defined in `:root` in `style.css`. Never use raw hex values in new CSS — always reference these variables.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-deep` | `#0b1a12` | Page background |
| `--bg-surface` | `#132a1d` | Cards, nav, panels |
| `--bg-raised` | `#193526` | Inputs, hover states, elevated surfaces |
| `--text-primary` | `#dce8e0` | Headings, names, strong content |
| `--text-secondary` | `#a3bfad` | Body text, descriptions |
| `--text-muted` | `#6b8f7a` | Labels, placeholders, captions |
| `--accent` | `#5cb878` | Links, primary buttons, focus rings |
| `--accent-hover` | `#4da86a` | Hover state for accent elements |
| `--accent-warm` | `#d4a855` | Spouse connectors in tree visualization |
| `--border-subtle` | `rgba(255,255,255,0.08)` | Card borders, dividers, row separators |
| `--border-accent` | `#3d7a56` | Tree node borders, zoom control borders |

## Spacing & Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `8px` | Inputs, buttons, small elements |
| `--radius-md` | `12px` | Cards, panels, list containers |
| `--shadow-sm` | `0 1px 4px rgba(0,0,0,0.2)` | Cards, nav |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,0.3)` | Floating controls (zoom buttons) |

## Component Patterns

### Cards / Panels
Use the `.card` or `.detail-panel` class. Background is `--bg-surface`, border is `--border-subtle`, radius is `--radius-md`.

### Forms
- Inputs get `--bg-raised` background, `--border-subtle` border
- Focus state: `--accent` border + `0 0 0 2px rgba(92,184,120,0.2)` box-shadow
- Labels: `--text-secondary`, 0.9rem, weight 500
- Primary buttons: `--accent` background, `--bg-deep` text
- Secondary buttons: `--bg-raised` background, `--text-secondary` text
- Danger buttons: transparent background, red-tinted border and text

### Lists (People page)
Card-row pattern: `.people-list` container with `.person-row` items. No HTML tables. Rows use `--bg-surface` background, hover to `--bg-raised`. Name is `--text-primary` weight 600, metadata is `--text-muted`.

### Detail pages
Two-column grid (`.detail-layout`) that collapses to single column below 768px. Each column is a `.detail-panel`. Definition lists for metadata: `<dt>` is uppercase muted label, `<dd>` is primary text.

### Sort controls
Pill-style buttons (`.sort-btn`) with transparent default state, `--bg-raised` on hover, green tint when active.

## Layout Rules

- `main.container`: max-width 960px, centered, 2rem vertical / 1.5rem horizontal padding
- Tree page: full-bleed via `.page-tree` body class (overrides container to full width, no padding)
- Nav: sticky, 60px height, `--bg-surface` background
- Use CSS Grid and Flexbox for layout — no float hacks
- Responsive breakpoints: 768px (detail layout), 600px (form grids), 480px (relationship form)

## Rules

1. **No inline styles in templates.** All styling goes in `static/style.css`.
2. **No CSS frameworks.** Do not add Pico, Bootstrap, Tailwind, or any other CSS library.
3. **Use variables.** Never hardcode colors — always use the `--` custom properties.
4. **No `!important`.** If you need it, the selector specificity is wrong. Fix the selector.
5. **Transitions on interactives.** All hover/focus states get `transition: 0.15s` on the relevant properties.
6. **Mobile-first isn't required**, but all pages must be usable at 375px width. Use the existing breakpoints.
