# Michy Rubbers — Operations prototype (Stage 1)

A clickable front-end prototype for the client pitch. There is no backend and no API. Every screen runs on realistic mock data, and the numbers agree across every page.

## Run it

Requires Node 20+ (see `.nvmrc`).

```bash
cd client
nvm use          # Node 24
npm install
npm run dev      # http://localhost:5173
```

## Demo shortcuts

- The login page has one-click demo accounts for **CEO**, **Admin** and **Operator**.
- Add `?as=ceo`, `?as=admin` or `?as=operator` to any URL to open it directly as that role.
- The avatar menu (top right) → **View the app as** switches role at any time.

## Suggested demo script

1. **Operator** → *Record a purchase* → *Upload the purchase bill* → *Try a sample purchase bill*.
   The AI misreads the invoice total on purpose. The automatic checks catch it, and **Confirm** stays locked until it is fixed and the 4 key values are ticked.
2. Check a bill already in the queue: Home → *Waiting for you to check* → *Check now*.
3. **Record production** → Factory A → Truck tyres from Warehouse A → outputs → review → save.
4. **Record a sale** (the upload flow works the same way).
5. Switch to **CEO** → Dashboard → click a warehouse → Finance.

## Where things live

| Path | What |
|---|---|
| `src/data/seed.ts` | Master data and a seeded simulation of FY 2026-27 transactions |
| `src/data/selectors.ts` | Every stock, total and margin is calculated here from the seed |
| `src/data/extraction.ts` | Mock "AI read this bill" results and the duplicate / GSTIN checks |
| `src/components/ExtractionReview.tsx` | The bill review screen with its safety checks |
| `src/theme/` | Ant Design tokens (Michy crimson `#D82E54`, Nunito) and global CSS |
| `src/pages/` | One file per screen |

Designed for desktop (1280px and wider). Mobile apps come later.
