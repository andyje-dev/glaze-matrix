# glaze-matrix

An interactive pairwise glaze-layering recommendation matrix for a cone 5/6 pottery studio, rendered live from Notion.

The app reads three Notion databases (Glazes, Clays, Glaze Combos) plus a Throws database, scores every base/top glaze pairing on every clay body, and draws a matrix of recommendations. As physical test tiles are marked **Finished** in Notion, the matching cell turns black, so the owner can see at a glance which recommended combinations still need to be made. The page is meant to be embedded back into a Notion page and refreshes on every load.

## How it works

- **Rows** are the base glaze, **columns** the top glaze, and the diagonal (row = column) is single-glaze tiles.
- Each cell shows one horizontal **band per clay**, rated **Recommended** (green), **Worth a test** (blue), or **Skip** (grey). The color encodes look quality only.
- Two clay-independent **corner tags** flag run risk (top-right, brown) and decorative-only (top-left, purple).
- A band turns **black** when its test tile is Finished, or **dark grey** when a thrown piece exists for that combo and clay but no finished tile does.
- Hover or tap a cell for a detail panel with a recommendation, suggested coats, per-clay notes, and photos of any finished tiles and pieces. Click to pin it.
- A header timestamp, legend, **progress bar**, and a glaze key grouped by product line round out the page.

Notion is the single source of truth for all glaze and clay classification. The scoring algorithm and the hand-curated named-pairing lists (`A_NAMED`, `B_NAMED`) live in this repo and are changed deliberately, together with the owner, when the glaze or clay set changes.

## Architecture

| File | Role |
| --- | --- |
| `api/index.js` | Vercel serverless function. Fetches the Notion databases server-side, shapes them into `{glazes, clays, finished, generatedAt}`, and returns an HTML page with that object injected as `window.__GMDATA__`. The Notion token never reaches the client. Returns a friendly error page if the token is missing or a query fails. |
| `api/img.js` | Image proxy at `/api/img`. Fetches HEIC/HEIF iPhone uploads (which won't render inline outside Safari) and transcodes them to JPEG. Web-safe formats pass through. |
| `public/app.js` | The client. Runs the scoring algorithm and draws the matrix, legend, progress bar, and detail panel from `window.__GMDATA__`. No secrets. |
| `public/style.css` | Styles. Warm off-white pottery theme. |
| `vercel.json` | Rewrites `/` to `/api/index`. Static files in `public/` serve at `/app.js` and `/style.css`. |
| `test/selftest.mjs` | Self-test for the scoring algorithm. Run with `npm run selftest`. |
| `AGENTS.md` | Full domain spec: data model, scoring algorithm, detail-panel copy, and design decisions. Read this before changing scoring or rendering. |

Responses are served with `Cache-Control: no-store` so every load is fresh. Three to four Notion queries per load is well within the rate limit.

## Configuration

The only required setting is the Notion integration token. Everything else has a sensible default.

| Env var | Purpose |
| --- | --- |
| `NOTION_TOKEN` | **Required.** Internal-integration token. Server-side only, never shipped to the client. |
| `GLAZES_DB_ID` | Override the Glazes database id. |
| `CLAYS_DB_ID` | Override the Clays database id. |
| `TILES_DB_ID` | Override the Glaze Combos (test tiles) database id. |
| `THROWS_DB_ID` | Override the Throws database id. |
| `TILES_PHOTO_PROP` | Pin a single Files property by name for finished-tile photos (otherwise image urls are auto-detected). |

## Deploy

1. Create an internal integration at [notion.so/profile/integrations](https://notion.so/profile/integrations) and copy its token.
2. In Notion, open the Glazes, Clays, Glaze Combos, and Throws databases and add the integration under **Connections** (read access suffices).
3. Deploy on Vercel and set `NOTION_TOKEN`:
   ```sh
   npx vercel
   npx vercel env add NOTION_TOKEN
   npx vercel --prod
   ```
   Or import the repo and set the variable in the dashboard.
4. Open the production URL to verify, then embed it in Notion with `/embed` on any page.

## Local development

```sh
npm install        # sharp + heic-convert (used by /api/img)
npm run selftest   # verify the scoring algorithm
npx vercel dev     # run the function and static files locally
```

Set `NOTION_TOKEN` in your environment (or a `.env.local`) so the function can reach Notion.

## Extending

- **New glaze:** the owner adds the Notion row and fills Movement, Breaks over Texture, Finish, Food Use, Color Family, Clay Class, and Layering Role. Then, together, decide its Clay Class judgment and whether it belongs in any `A_NAMED` or `B_NAMED` pairing (a code change).
- **New clay:** the owner adds the row and sets Tone and Speckled, and it renders as a new band automatically. For a Buff or Brown body, tune the darkening model together (only White and Near-black are validated so far).

See `AGENTS.md` for the complete data model and scoring spec.
