# Compact Form & Tabbed Relationships Design

**Date:** 2026-03-29
**Status:** Draft

## Problem

The person form (Add/Edit) is vertically long with generous spacing, and relationship management lives only on the detail page. The user wants:
1. A more compact, modern-feeling form
2. Relationships accessible from both the form page (via tabs) and the detail page

## Design

### 1. Compact Form Layout

Keep all 6 existing sections (Name, Birth Name, Details, Contact, Photo & Notes, Delete) separate, but tighten the vertical rhythm. This is an intentional departure from the Style Guide's "generous whitespace" philosophy — the user specifically requested a more compact form.

- **Section margins:** Reduce `.form-section` margin-bottom from `var(--space-lg)` to `var(--space-md)`. Scoped to `.page-form .form-section` to avoid affecting other pages.
- **Input padding:** Reduce vertical padding on inputs. Scoped to `.page-form input, .page-form select, .page-form textarea` so it only affects the person form, not the login page, search box, or detail page inputs.
- **Section headers:** Replace full-width uppercase `.form-section-title` with a left-border accent style:
  - 3px solid `var(--accent)` left border
  - Normal case (not uppercase)
  - Font size `0.85rem`, color `var(--text-body)`, weight 600
  - Padding-left `var(--space-sm)`
  - Remove letter-spacing and text-transform
- **Notes textarea:** Reduce from 3 rows to 2

**Note:** The Style Guide will be updated to document this compact form variant as an acceptable pattern for dense data-entry forms.

### 2. Tab System

Two tabs inside the `.form-card`: **Details** and **Relationships**.

**Tab bar structure:**
- `.form-tabs` — flex row container, `border-bottom: 1px solid var(--border-default)`, `margin-bottom: var(--space-md)`
- `.form-tab` — button elements, `padding: var(--space-sm) var(--space-md)`, no border, transparent bg, `color: var(--text-muted)`, `cursor: pointer`, `transition: 0.15s`
- `.form-tab.active` — `color: var(--text-primary)`, `font-weight: 600`, `border-bottom: 2px solid var(--accent)` (overlaps container border via negative margin-bottom)
- `.form-tab:hover` — `color: var(--text-body)`

**Responsive:** At all viewport widths, the two tabs fit side by side (they're short labels). No stacking or scrolling needed.

**Tab switching:** Pure client-side JS. Two content divs (`.tab-content-details`, `.tab-content-relationships`) toggle `display: none` / `display: block`. The `<form>` element wraps only the Details tab content. Switching tabs does not affect unsaved form data — the form fields remain in the DOM (just hidden), so values are preserved.

### 3. Relationships Tab Content

**On Edit Person page (person exists):**

- **Relationship list:** Reuses `.rel-item` pattern from detail page
  - Each row: relationship label (muted) + person name (link) + remove button (`.btn-outline-danger.btn-sm`, same as detail page for consistency)
  - Subtle bottom border between rows
  - Empty state: "No relationships yet" in muted text

- **Add relationship form:** Below the list, separate from the main person form
  - `[Type dropdown] [Person dropdown] [+ Add button]` in `.add-rel-grid` layout
  - Type options: Parent of, Child of, Spouse, Former Spouse, Adoptive Parent of, Adopted by

- **AJAX behavior:**
  - **Add:** `fetch()` POST to `/relationship/add` with `Content-Type: application/x-www-form-urlencoded`. On success, the server returns JSON: `{"ok": true, "rel_id": 123, "label": "Parent", "person_name": "Sangeeta Chowdhury", "person_id": 2}`. JS uses this to build and insert a new `.rel-item` with a CSS fade-in animation.
  - **Remove:** `fetch()` POST to `/relationship/<id>/delete`. On success returns `{"ok": true}`. JS fades out the row.
  - **Errors:** Server returns `{"ok": false, "error": "Relationship already exists"}` with HTTP 400. JS displays the error as an inline message below the add form.

**On Add Person page (no person ID yet):**
- Relationships tab visible but shows: "Save this person first to manage relationships" in muted text
- Add form is not rendered
- After save, the user is redirected to Edit Person page (requires changing the redirect in `_save_person` from `person_detail` to `person_edit`)

### 4. Detail Page — No Changes

The detail page keeps its existing full relationship management panel (right column with list + add/remove controls). Both the detail page and the edit form provide relationship management.

### 5. Delete Button Placement

The delete button (trash icon, existing `.form-delete` pattern) stays at the bottom of the Details tab content, inside the form. It is not visible on the Relationships tab.

### 6. Files to Modify

- **`templates/person_form.html`** — Add tab bar, wrap form in Details tab, add Relationships tab content
- **`static/style.css`** — Add tab styles (`.form-tabs`, `.form-tab`), update `.page-form`-scoped form section styles for compactness
- **`static/form.js`** (new file) — Tab switching logic + fetch-based relationship add/remove
- **`templates/person_form.html`** — Include `form.js` via the `{% block scripts %}` block (not base.html)
- **`app.py`** — Changes:
  1. Extract relationship + all_people queries from `person_detail` into a helper function, reuse in `person_edit`
  2. Pass `relationships` and `all_people` to the edit form template
  3. Modify `/relationship/add` and `/relationship/<id>/delete` routes: if request has `Accept: application/json` header, return JSON instead of redirect
  4. Change `_save_person` redirect for new persons from `person_detail` to `person_edit`
- **`STYLE_GUIDE.md`** — Add a note about the compact form variant

### 7. JSON Response Shapes

**POST `/relationship/add`** — Success (200):
```json
{"ok": true, "rel_id": 123, "label": "Parent", "person_name": "Sangeeta Chowdhury", "person_id": 2}
```
The `label` is the display label from the current person's perspective (e.g., "Parent", "Child", "Spouse"). The `person_name` and `person_id` are the *other* person in the relationship.

**POST `/relationship/add`** — Error (400):
```json
{"ok": false, "error": "Relationship already exists"}
```

**POST `/relationship/<id>/delete`** — Success (200):
```json
{"ok": true}
```

## Verification

1. Run `python app.py` and visit `http://localhost:5000`
2. Navigate to Add Person — verify compact form, Relationships tab shows "save first" message
3. Save a new person — verify redirect to Edit Person (not detail) with functional Relationships tab
4. Add a relationship via the tab — verify it appears without page reload
5. Remove a relationship — verify it disappears without page reload
6. Switch between tabs — verify form data is preserved (fill in fields, switch to Relationships, switch back)
7. Visit person detail page — verify relationships still fully manageable there
8. Test on mobile viewport (375px) — verify tabs and form are responsive
9. Verify the login page, search box, and detail page inputs are NOT affected by the compact styling
10. Verify all existing functionality still works (tree, people list, etc.)
