# FixPoint — Tamil Nadu Community Issue Reporting & Resolution Platform

A client-server web app scoped to Tamil Nadu's 37 districts: citizens report issues
within their own district, that district's admin reviews and assigns them to a
category-matched, same-district worker, and a state-level super-admin can see
across every district at once.

## Running it

Needs **Node.js 22.5+** (uses Node's built-in SQLite — nothing to `npm install`).

```
cd server
node server.js
```

Open **http://localhost:3000**. If you already have a `data.db` file from an
earlier version of this app, **delete it** before starting — the account model
changed (one admin per district instead of a single admin), so old accounts
won't have the fields the new version expects.

## Logins

**Super-admin** (sees and manages every district):
- `admin@fixpoint.local` / `admin123`

**District admins** — one per district, all password `admin123`, email pattern
`admin.<district>@fixpoint.local` (district name lowercased, spaces/symbols
removed). Examples:
- `admin.tiruchirappalli@fixpoint.local`
- `admin.chennai@fixpoint.local`
- `admin.madurai@fixpoint.local`

(On the login screen's Department tab, there's a district dropdown that fills
this in for you automatically — no need to memorize the pattern.)

**Demo workers** (password `worker123` for all), seeded in two districts so you
can test cross-district behavior:

| District | Name | Email | Category |
|---|---|---|---|
| Tiruchirappalli | Ravi Kumar | ravi.roads@fixpoint.local | Roads & Potholes |
| Tiruchirappalli | Meena S | meena.sanitation@fixpoint.local | Garbage & Sanitation |
| Tiruchirappalli | Arun Das | arun.water@fixpoint.local | Water Supply |
| Tiruchirappalli | Priya N | priya.electrical@fixpoint.local | Street Lighting & Electrical |
| Tiruchirappalli | Suresh V | suresh.property@fixpoint.local | Public Property / Other |
| Chennai | Karthik R | karthik.roads.chennai@fixpoint.local | Roads & Potholes |
| Chennai | Divya M | divya.sanitation.chennai@fixpoint.local | Garbage & Sanitation |
| Chennai | Bala S | bala.water.chennai@fixpoint.local | Water Supply |
| Chennai | Lakshmi P | lakshmi.electrical.chennai@fixpoint.local | Street Lighting & Electrical |
| Chennai | Manoj K | manoj.property.chennai@fixpoint.local | Public Property / Other |

Citizens and additional workers sign up for themselves and pick their district
once — every report they file afterward automatically uses that district.

## What district scoping actually enforces (not just UI hiding)

This is checked server-side, not just hidden in the interface:
- A district admin's `/api/admin/complaints` call only ever returns rows from
  their own district — the server filters before sending anything back.
- Approving, rejecting, or assigning a report outside your district returns a
  403, even if you know the report's ID.
- Assigning a worker checks **both** category match **and** district match —
  a Trichy worker cannot be assigned a Chennai job.
- Chat threads are scoped the same way: a district admin only sees
  conversations from citizens/workers in their own district.
- Only the super-admin (the one account with no district) sees across all 37.

## What changed from the single-city version

- Citizens pick their home district once, at signup — every report they file
  uses it automatically, no need to re-enter it each time.
- The old free-roam "community map" (any GPS point on Earth) is gone. The
  location picker in the report form now opens centered on the citizen's own
  district instead of the whole country, and there's no more world map to pan
  around on the citizen dashboard — one less heavy thing to load on mobile data.
- The admin's overview map centers on their district (or all of Tamil Nadu for
  the super-admin) instead of a wide India-level view.
- Every ticket, worker card, and dashboard header now shows which district
  it belongs to.

## Mobile-friendliness pass

- All form inputs now use 16px text — smaller text makes iOS Safari
  auto-zoom in when you tap a field, which felt broken on a phone; this fixes it.
- Buttons and tabs now meet a ~44px minimum touch target.
- Ticket cards stack into a single column on narrow phone screens instead of
  cramming a 3-column layout.
- The dashboard's top navigation scrolls smoothly with touch instead of
  wrapping awkwardly.
- Dropped the heavy always-on citizen map (see above) — noticeably lighter to
  load on mobile data.

Everything from the previous version — accounts, the report lifecycle, the
buzzer assignment alert, chat, worker ratings — works exactly as before,
just now with a district attached to it.
