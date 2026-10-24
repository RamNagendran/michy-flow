# michy-flow

Operations platform for Michy Rubbers: purchases, warehouse stock, production, output stock and sales.

```
client/  React 19 + TypeScript + Vite + antd    → Vercel
server/  FastAPI (async) + SQLAlchemy 2 + Alembic → Render
DB       PostgreSQL (Supabase / Render Postgres)
```

Auth is a JWT Bearer token in the `Authorization` header (client and API are on different domains).
The access token is short-lived; the client swaps the refresh token for a new pair on a 401.

## Run locally

**Server** (Python 3.12, port 8000)

```bash
cd server
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env              # set DATABASE_URL and JWT_SECRET
uvicorn app.main:app --reload --port 8000
```

On startup the app runs the Alembic migrations against `DATABASE_URL`, so missing tables are
created and pending changes applied automatically (turn off with `AUTO_MIGRATE=false`).

API docs: http://localhost:8000/docs (only when `ENV_NAME=development`).

Tests run against a local `michy_flow_test` database (override with `TEST_DATABASE_URL`):

```bash
createdb michy_flow_test
pytest && ruff check . && ruff format --check .
```

**Client** (Node 24, port 3000)

```bash
cd client
nvm use
npm install
cp .env.example .env.local        # VITE_BACKEND_API=http://localhost:8000
npm run dev
```

## Database changes

Never use `create_all`. Change the models, then generate a migration and review it:

```bash
alembic revision --autogenerate -m "describe the change"   # review the generated file
```

The next app start applies it (or run `alembic upgrade head` yourself).

## Access control

Everything happens inside a **company** (entity). There are no warehouses or factories.

| Level   | Roles                                   | Scope                                                         |
| ------- | --------------------------------------- | ------------------------------------------------------------- |
| Global  | `super_admin`, `ceo`                    | Every company in the organisation (CEO is read-only)          |
| Company | `manager`, `admin`, `finance`, `operator` | One membership per company; a person can belong to several |

Operators also get **duties** (`purchase`, `sales`, `production`) that decide what they can enter.

- The rules live in one place: `server/app/auth/permissions.py`. Routes use
  `require_system_permission(...)` or `require_company_permission(...)` (for `/companies/{company_id}/...`).
- `/auth/me` returns the resolved permissions per company. The client reads them through
  `useAccess()` and never works them out itself.
- Changing someone's password, access or active status bumps `users.token_version`, which
  invalidates their existing tokens at once.
- New users get a one-time temporary password and must change it before anything else works.
- Admin actions and sign-ins are written to `audit_logs` in the same transaction as the change.
- Set `ALLOW_SIGNUP=false` in production once the organisation's Super Admin exists.

## Entry workflow (purchases, production, sales)

```
Operator enters ─▶ pending ─Admin approves─▶ approved ─Finance verifies─▶ verified (final)
                     │                          │
                     └─Admin rejects─▶ rejected └─Finance holds─▶ on_hold ─▶ verified / rejected / edited
```

- Every live entry counts in **provisional** stock the moment it is saved; **confirmed** stock
  only includes entries Finance has verified. `GET /companies/{id}/stock` returns both.
- Entries by someone who can approve (Admin, Super Admin) start as `approved`.
- Edits send an entry back through review and are kept in its history (`entry_events`);
  verified entries can only be changed by the Super Admin. Deletes are soft.
- Writes in a company run under a per-company lock and end with a stock check, so stock can
  never go below zero. Production wastage is worked out by the server; above
  `WASTAGE_ALERT_PCT` (2%) it is flagged.
- Rules live in `server/app/services/workflow_service.py`.

## Grades (A, B, C)

Every purchase and sale has a grade. Production is always Grade A. Each grade keeps its own
stock, so the three never mix (rules in `server/app/models/grades.py`):

| Grade | Purchase | Sale | Stock |
|---|---|---|---|
| A — through the plant | tyres for production | products made here | tyres in → production → products out |
| B — re-sell | tyres bought to re-sell | the same tyres, unprocessed | tyres in → tyres out |
| C — invoice only | any item, no goods move | credit sales, adjustments | separate book stock |

- Purchases default to A. A sale of a product defaults to A; a sale of tyres defaults to B.
  Grade C is always chosen on purpose.
- Production can use only Grade A tyres. A Grade B purchase that ends up in the plant is moved to
  Grade A by an Admin edit (with a reason, kept in the history).
- No grade's stock can go below zero.
- A bill upload suggests the grade (a sales bill for tyres → B). The person confirms it.
- Totals (`/summary`) carry `by_grade` and the entry list filters by `grade`.

## Company types and production (processing)

Every company has a type, chosen when it is created (it can change only until the first entry).
It decides what the company processes and makes (`server/app/models/catalog.py`):

| Type | Example | Processes | Makes |
|---|---|---|---|
| Tyre pyrolysis | Jack's Green Tech | tyres | oil (litres), carbon powder, steel, waste water |
| Crumb rubber | Chennai Crumb Industries | tyres | rubber crumbs, steel, fibre |
| Steel recovery | Michy Metal and Alloys | scrap steel | steel |

Tyres are truck, car, tractor, two-wheeler and OTR. Every type can also record weighed waste,
which is kept in the record but never stocked or sold.

- **Units.** Quantities are in each item's unit: litres for oil, kg for everything else. Oil is
  bought, stocked and sold in litres, and its rate is per litre. Bills in L / KL are read too.
- **Returned to stock.** Material taken out but not processed is entered as returned and stays
  in stock.
- **Reverse calculation.** The operator enters what was taken, what was returned and what came
  out. The server works out:
  - processed = taken − returned (this is what leaves stock);
  - output weight = all outputs by weight, with oil at `OIL_DENSITY_KG_PER_L` (0.92);
  - missing = processed − output.
  Missing weight over `WASTAGE_ALERT_PCT` (2%) of the processed weight is flagged as waste for
  the Admin. Outputs can never weigh more than what was processed.

## Wastage control

- **Allowance.** The company Admin declares each month's acceptable wastage (0.1–2% of the
  processed weight). Months without a declaration use the 2% limit (`WASTAGE_ALERT_PCT`).
  Runs over the allowance are flagged.
- **High alert and debit note.** A run over 2% raises a live high alert for the Admin and
  Managers. It cannot be approved or verified until the Admin records a debit note. An
  approver's own run waits for review too.
- **Stock checks.** Every 1 or 3 months (set per company) the Admin counts the physical stock.
  Each difference from the book stock is recorded and corrects the stock from then on. The
  stock response says when the next count is due and whether it is overdue.

## Inventory configuration

The Super Admin sets, per company (Settings → Companies → Inventory):
- its input products and output materials (starting from the company type's defaults);
- the oil conversion factor, 1.030–1.050 kg per litre. Oil is entered in litres and weighed
  with it; saved runs keep the weight worked out at the time;
- the stock-check cycle (1 or 3 months).

## Finance escalation

Finance can escalate a data mismatch on any entry still in review. The entry keeps its status
and shows an "Escalated to operations" flag. The Admin, Managers and whoever entered it get a
live notice. The Admin resolves it with a note, or an edit clears it.

## Production efficiency

The production in-charge picks the operators on the shift (from the company's operators) and
enters the running hours. Efficiency = running hours ÷ 8 planned hours (`SHIFT_HOURS`); the
report also gives kg per hour, per shift and per operator.

## Reports and pricing

- **Reports** (`/reports`): trends for sales, purchases, production and wastage, grouped by
  day, week or month to suit the range (`/trends`). Also shift efficiency
  (`/production-report`).
- **Oil KPI** (`/oil-kpi`, CEO and Managers only): oil weight ÷ processed weight. Green at
  40% or more, red under 39%.
- **Purchase prices** (`/prices`):
  - each supplier's weighted price for an item against the average;
  - the difference, saving and ROI;
  - a price-history chart per supplier;
  - car and truck tyres side by side.
  - Grade C entries are left out.
- **Status summary** (`/entries/status-summary`): pending against approved and the other
  statuses, with the list's filters. Operators see their own entries, so a purchase in-charge
  sees how their bills are getting on.
- **Periods:** every report takes month, quarter, year (April–March) or a custom range.

## Bill upload and reading (no AI)

`POST /companies/{id}/documents?kind=purchase|sale` takes a PDF, JPG or PNG (≤ 10 MB) and
returns what was read; the person checks it, then creates the entry with `document_id`.

1. **What the file really is** is decided from its first bytes, not its name or extension.
2. **Text**: the PDF's own text layer (`pdfplumber`); for photos and scanned PDFs, on-device OCR
   (`RapidOCR`, ONNX models bundled — no internet, no per-page cost).
3. **GST e-invoice QR** (OpenCV): when present, GSTINs, invoice number, date and total come
   from the signed code.
4. **Rules** (`server/app/parsing/fields.py`) pick out the fields; quantity × rate = amount
   confirms all three. Each field returns a confidence and its source.

The file is stored in `documents` (deduplicated by SHA-256 per company) and linked to its entry.
OCR is CPU- and memory-heavy (~300–500 MB while reading); at most two run at once.
Deploy with `server/Dockerfile`, which adds the system libraries OpenCV needs.

## Live updates (WebSocket)

`/ws` pushes changes to every screen that may see them, so nobody refreshes. The client sends
its access token in the first message; operators only receive events for their own entries.
The browser refetches the affected lists, stock and totals, and shows a notice to whoever must
act next (Admin for new entries, Finance for approved ones, the operator when Finance holds or
comments). One instance works out of the box; with several, set `REALTIME_LISTEN_URL` to a
LISTEN-capable Postgres URL (Supabase: direct or session pooler, port 5432).
