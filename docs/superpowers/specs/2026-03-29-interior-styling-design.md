# Interior App Styling & FAB Design

## Context

The login page is fully styled with a warm cream/brown earthy palette and animated vine background. All other pages (tree, people list, person detail, add/edit forms) are unstyled — bare-bones CSS with no custom properties applied. This design brings the rest of the app up to the same aesthetic standard and restructures navigation around a floating action button and direct tree interaction.

## Key Decisions

- **No navigation bar** — remove entirely from all pages
- **Floating Action Button (FAB)** — replaces Add Person and Logout nav links
- **Back arrow** on inner pages — top-left, links to tree (home)
- **Tree node click → edit page** (changed from current detail page)
- **People list row click → detail page** (unchanged — detail page remains reachable from here)
- **Full re-skin in one pass** — apply all style guide tokens globally

---

## 1. Global Foundation

### CSS Custom Properties

Define all tokens from `STYLE_GUIDE.md` in `:root` in `style.css`:

- Backgrounds: `--bg-page`, `--bg-card`, `--bg-input`, `--bg-hover`
- Text: `--text-primary`, `--text-body`, `--text-muted`, `--text-placeholder`
- Borders: `--border-default`, `--border-focus`
- Accent: `--accent`, `--accent-hover`, `--accent-link`
- Feedback: `--color-error`, `--color-error-bg`, `--color-success`, `--color-success-bg`
- Shadows: `--shadow-sm`, `--shadow-md`
- Spacing: `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`, `--space-xl`
- Radius: `--radius-sm`, `--radius-md`

### Body Styles

- Background: `--bg-page`
- Font: `'Source Sans 3', sans-serif`
- Color: `--text-body`
- Line-height: 1.6

### Navigation Removal

- Remove `<nav class="site-nav">` from `base.html`
- Add a back arrow `<a>` element to `base.html` inside the authenticated block
- Hide via CSS on pages that don't need it: `.page-tree .back-arrow, .page-login .back-arrow { display: none; }`
- Templates that currently lack `body_class` must add one: `person_form.html` → `page-form`, `person_detail.html` → `page-detail`, `person_list.html` → `page-list`
- Back arrow styling: `--text-muted`, hover `--text-primary`, transition 0.15s, positioned top-left with padding, statically present (no entrance animation)

### Flash Messages

- Left-border accent (3px)
- Error: `--color-error-bg` background, `--color-error` border/text
- Success: `--color-success-bg` background, `--color-success` border/text
- Radius: `--radius-sm`
- Padding: `0.6rem 0.9rem`

### Login Page CSS Migration

- Migrate all hardcoded hex values in the `.page-login` / `.login-card` CSS rules to use the new `:root` custom properties. Visual appearance stays identical.

---

## 2. Floating Action Button (FAB)

### Main Button

- Circular, ~56px diameter
- Fixed position: bottom-right (`bottom: 1.5rem; right: 1.5rem`)
- Background: `--accent` (`#5a4d3a`)
- Shadow: `--shadow-md`
- Border-radius: 50%
- Icon: inline SVG — 3-4 overlapping leaf shapes arranged in a bowl/nest formation, rendered in muted green/earth tones (dusty sage, olive) against the dark button background
- Hover: `--accent-hover`, slight scale or shadow increase
- Transition: 0.15s
- z-index: 1000 (above all content including zoom controls)

### Expanded State

- On click, two action items slide up vertically (~200ms ease-out transition)
- Each action is a rounded pill: `--bg-card` background, `1px solid --border-default`, `--text-body` text, `--radius-sm`
- ~8px gap between items
- Items:
  1. **Add Person** — "+" icon + "Add Person" label, links to `/person/new`
  2. **Logout** — exit/door icon + "Logout" label, links to `/logout`
- Minimum 44px height for touch targets

### Backdrop

- Semi-transparent overlay (`rgba(0, 0, 0, 0.1)`) behind the expanded menu
- Clicking backdrop or FAB again closes the menu
- Covers full viewport

### Accessibility

- FAB is a `<button>` element with `aria-label="Actions"` and `aria-expanded="false|true"`
- Action items are focusable `<a>` elements
- Escape key closes the expanded menu

### Visibility

- Present on all authenticated pages (tree, list, detail, edit forms)
- NOT shown on login page (hidden via `.page-login .fab { display: none; }`)
- Implemented in `base.html` within the authenticated block

### JavaScript

- FAB toggle logic lives in a small inline `<script>` at the end of `base.html` (too small to warrant a separate file)
- Handles: click to toggle, backdrop click to close, Escape to close

### Tree Page: FAB & Zoom Controls Coexistence

- Move zoom controls to **bottom-left** (`left: 1rem` instead of `right: 1rem`) so they don't collide with the FAB in the bottom-right

---

## 3. Tree Page

### Node Styling (`.person-card`)

- Fill: `--bg-card`
- Stroke: `1px solid --border-default`
- Corner radius: change `rx` from `8` to `6` to match `--radius-sm` (6px) per style guide
- Name text: `--text-primary`, weight 600, 14px
- Year text: `--text-muted`, 12px
- Hover: fill changes to `--bg-hover`, cursor pointer

### Spouse Nodes (`.spouse-card`)

- Same as person-card but with dashed border to visually distinguish
- Slightly muted: `--bg-hover` fill instead of `--bg-card`

### Connecting Lines

- Parent-child: keep `rgba(92, 184, 120, 0.3)` (muted green, ties to vine theme)
- Spouse connector: keep `rgba(212, 168, 85, 0.5)` (muted gold)

### Zoom Controls

- Move to **bottom-left** to avoid FAB collision
- `--bg-card` background, `--border-default` border, `--radius-sm`
- `--shadow-sm` lift
- Icon stroke: `--text-body`
- Hover: `--bg-hover`

### Tree Container Height

- Change `height: calc(100vh - 40px)` to `height: 100vh` (nav bar is removed, no offset needed)

### Click Behavior Change

- **Current**: `window.location.href = /person/${d.data.id}` (detail page)
- **New**: `window.location.href = /person/${d.data.id}/edit` (edit page)
- Same change for spouse nodes

### Background & Empty State

- Page background: `--bg-page`
- Empty state text: `--text-muted` (replacing hardcoded `#9ab5a6`)
- Remove inline `style="padding-top: 4rem;"` from `tree.html` empty state div; use a CSS class instead

---

## 4. Forms (Add/Edit Person)

### Layout

- Back arrow top-left (visible via `page-form` body class)
- Page title: `--text-primary`, weight 700, 1.5rem

### Form Card (`.form-card`)

- `--bg-card` background
- `1px solid --border-default`
- `--radius-md` corners
- `--space-lg` padding
- `--shadow-sm`

### Section Titles (`.form-section-title`)

- `--text-muted`, weight 600, 0.85rem
- Uppercase, letter-spacing 0.04em

### Inputs

- `--bg-input` background
- `1px solid --border-default`
- `--radius-sm` corners
- Padding: `0.7rem 0.85rem`
- Focus: `--border-focus` + `0 0 0 2px rgba(139, 122, 94, 0.2)` glow
- Placeholder: `--text-placeholder`

### Labels

- `--text-body`, weight 600, 0.9rem

### Buttons

- Submit: full-width, `--accent` background, `--bg-page` text, `--radius-sm`, weight 600, hover `--accent-hover`
- Danger (delete): transparent, `--color-error` border/text, hover `--color-error-bg` fill

### Spacing

- `--space-lg` gap between form sections

---

## 5. Person Detail Page

### Layout

- Back arrow top-left (visible via `page-detail` body class)
- Name: `--text-primary`, weight 700
- Birth name (nee): `--text-muted`, italic

### Panels

- Two-column grid, each panel is a card (`--bg-card`, `--border-default`, `--radius-md`, `--space-lg`, `--shadow-sm`)
- Collapses to single column at 768px

### Photo

- `--radius-md` corners

### Definition List

- `<dt>`: uppercase, `--text-muted`, weight 600, 0.75rem
- `<dd>`: `--text-body`

### Relationships

- Items separated by bottom border `--border-default`
- Labels: `--text-muted`
- Person names: `--accent-link` colored links
- Add Relationship form: same input/select/button styling as edit forms

### Action Buttons

- Edit: secondary (`--bg-card` bg, `--border-default` border)
- Delete: danger style

---

## 6. People List Page

### Layout

- Back arrow top-left (visible via `page-list` body class)
- Page title + search box in header row

### Search

- `--bg-input`, `--border-default`, focus ring
- Search icon: `--text-muted`

### Sort Bar

- Sort buttons as small pills
- Active sort: `--accent` text with underline

### Person Rows

- `--bg-card` background, hover `--bg-hover`
- Bottom border: `--border-default`
- Name: `--text-primary`, weight 600
- Tags (DOB, place): `--text-muted`
- Arrow chevron: `--text-muted`
- Links to detail page (unchanged)

### Empty State

- `--text-muted`, centered

---

## Files to Modify

| File | Changes |
|------|---------|
| `static/style.css` | Add `:root` custom properties, restyle all components, add FAB styles, add back-arrow styles, remove nav styles, migrate login CSS to use variables, move zoom controls to bottom-left, update tree container height |
| `templates/base.html` | Remove `<nav>`, add back-arrow `<a>`, add FAB markup + inline JS (in authenticated block) |
| `static/tree.js` | Change node click to `/person/<id>/edit`, change `rx` from 8 to 6, apply CSS-friendly attributes to nodes for styling |
| `templates/tree.html` | Remove inline style from empty state div |
| `templates/person_form.html` | Add `{% block body_class %}page-form{% endblock %}` |
| `templates/person_detail.html` | Add `{% block body_class %}page-detail{% endblock %}` |
| `templates/person_list.html` | Add `{% block body_class %}page-list{% endblock %}` |
| `templates/login.html` | No changes needed (already has `page-login` body class) |
| `STYLE_GUIDE.md` | Update Navigation section to document FAB pattern instead of top nav bar |

## Verification

1. Run `python app.py` and visit `http://localhost:5000`
2. Login page: should look unchanged (same visuals, now using CSS variables under the hood)
3. Tree page: nodes have card styling, clicking a node navigates to edit page, no nav bar, FAB visible bottom-right, zoom controls bottom-left
4. FAB: tap to expand, see Add Person and Logout actions, tap backdrop to close, Escape closes, keyboard navigable
5. Add/Edit form: warm styled card, back arrow top-left returns to tree
6. People list: styled rows, search, sort, back arrow, rows link to detail page
7. Person detail: two-column card layout, styled relationships, back arrow
8. Mobile (375px): all pages usable, 44px touch targets, FAB accessible
9. No hardcoded colors remain in CSS (all use custom properties)
10. No inline styles remain in templates
