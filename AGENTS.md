# glaze-matrix

AGENTS.md for an agentic build session. Read this fully, then do the "First task" at the bottom.

## What this is
A small web app that reads three Notion databases (Glazes, Clays, Test Tiles) belonging to a cone 5/6 pottery studio and renders an interactive pairwise glaze-layering recommendation matrix. As physical test tiles are marked Finished in Notion, the matching cell region turns black, so the owner can see at a glance which recommended combinations remain to be made. The page gets embedded back into Notion via an embed block and refreshes on load.

Owner: Andy, a solo hobbyist. Keep all user-facing copy free of em dashes (he dislikes them).

## Tech and constraints
- Plain Node on Vercel. Zero npm dependencies; use the built-in global `fetch`. No framework required (one serverless function plus static files is enough; Next.js is acceptable but not necessary).
- The Notion integration token is secret and must be used only server-side via env var `NOTION_TOKEN`. Never ship it to the client.
- Notion is the single source of truth. All glaze and clay classification lives in Notion fields. The scoring algorithm and the hand-curated named-pairing lists live in this repo (versioned) and are changed deliberately, together with the owner, when the glaze or clay set changes.

## Architecture
- `api/index.js`: Vercel serverless function. Fetches the three databases server-side, shapes them into a compact object `{glazes, clays, finished, generatedAt}`, and returns an HTML page with that object injected as `window.__GMDATA__`, plus links to `/style.css` and `/app.js`. Returns a friendly error page if the token is missing or a query fails.
- `public/app.js`: the client. Runs the scoring algorithm and draws the matrix, legend, progress bar, and hover/tap detail panel from `window.__GMDATA__`. No secrets here.
- `public/style.css`: styles. Warm off-white pottery theme: background `#faf8f4`, text `#2a2622`, surfaces `#f0ece4`.
- `vercel.json`: rewrite `/` to `/api/index`. Static files in `public/` serve at `/app.js` and `/style.css`.
- `package.json`: name `glaze-matrix`, private, `engines.node >=18`, no dependencies.

Respond with `Cache-Control: no-store` so each load is fresh. Three queries per load is well within Notion's rate limit.

## Notion API
Use the official REST API: `POST https://api.notion.com/v1/databases/{database_id}/query` with headers `Authorization: Bearer ${NOTION_TOKEN}`, `Notion-Version: 2022-06-28`, `Content-Type: application/json`. Paginate with `start_cursor` and `has_more`, page_size 100. Parse property values from the standard shape: title and rich_text join their plain_text; select uses `.select.name`; multi_select maps to names; checkbox is a boolean; relation is an array of page ids (strip dashes when matching); number uses `.number`.

Database IDs (use as defaults; allow override via env `GLAZES_DB_ID`, `CLAYS_DB_ID`, `TILES_DB_ID`):
- Glazes: `34b7d0e43ed2804c8552debe7c49b859`
- Clays: `34b7d0e43ed2805fa511fff16d5b0af0`
- Test Tiles: `e13b547dd5ab4319a6f528c837401d29`

## Data model

### Glazes
Title format is `Brand - CODE Name`, for example `Amaco - PC-10 June Bug`. Parse the CODE with regex `/[A-Z]{1,3}-\d{1,3}/` (first match); the friendly name is everything after the code. Fields the app reads:
- Movement: Low, Medium, High, mapped to mv 1, 2, 3
- Breaks over Texture: Strong, Subtle, None
- Color Family: COBALT, COPPER, IRON, NEUTRAL, METAL, PINK
- Clay Class: Transparent-pale, Transparent-colour, Semi-translucent, Iron-rich, Opaque-saturated, Pale-opaque, mapped to codes TP, TC, ST, IR, OS, PO
- Food Use: Functional, Decorative, Over-celadon-only, mapped to fs OK, DECO, COND
- Layering Role (multi): base-friendly, topper-only, high-mover, flux, crawl, crystal, phase, celadon, metallic

Exclude any glaze with no Clay Class (these are unrelated studio glazes). There are currently 24 classified glazes.

Derive boolean flags: mover = role high-mover; flux = role flux; crawl = role crawl; crystal = role crystal; metal = role metallic; topper = role topper-only; celadon = role celadon; phase = role phase; hicrystal = crystal AND mv == 3 (a fluid crystalline that sheets off as a base); translucent = cls in {TP, TC}.

### Clays
Title `New Mexico Clay - X`. Fields: Tone (White, Buff, Brown, Near-black, mapped to darkness D 0, 1, 2, 3) and Speckled (checkbox, S). Exclude clays with no Tone. The current three are WH8 Stoneware (White, S false), Ermine (White, S true), Chocolate (Near-black, S false). Order clays by D ascending, then S ascending, then name, which yields WH8, Ermine, Chocolate.

### Test Tiles (a sparse "done" overlay, never required to be complete)
Fields: Base Glaze (relation to Glazes), Top Glaze (relation to Glazes, empty for single-glaze tiles), Clay (relation to Clays), Status (To-Do, Base Glazed, Fully Glazed, Finished), Layers (text, format `Base (CODE Name): N` then newline `Top (CODE Name): N` then notes), Name (`CODE Name → CODE Name` for layered, or `CODE Name` for single). There are about 111 legacy rows from the original 13-glaze round; about 23 are currently Finished, all on WH8, and their Base/Top relations are empty. Do not modify legacy rows. Resolve a tile's base and top by trying Base/Top relations first (relation page id to glaze code), then parsing Layers (`Base (CODE`, `Top (CODE`), then parsing Name (split on the arrow). Resolve clay via the Clay relation to clay name.

## The matrix to render
Rows are the base glaze, columns the top glaze, the diagonal (row equals column) is single-glaze tiles. Sort glazes by code: split into letter prefix and number, sort by prefix ascending then number ascending (this gives the grouping C, CO, CR, PC, PG, SW). Each cell shows one horizontal band per clay, in the clay order above. Each band is rated Recommended, Worth a test, or Skip, colored green `#C0DD97`, blue `#B5D4F4`, grey `#EAE7DF`. The color encodes look quality only.

Two clay-independent corner tags on the cell: run risk is a top-right triangle `#7A4D0E`; decorative-only is a top-left triangle `#6B5FD6`. Single-tile cells get an inset ring (`box-shadow: inset 0 0 0 1.5px #6f685c`). Suppress both tags when every band in the cell is Skip. A band turns black `#17130d` when its tile is finished. Hover or tap a cell to show a detail panel (title, the run/decorative tags, a one-line recommendation with suggested coats, and one line per clay). Include a header with a "live from Notion" timestamp, a legend, a progress bar, and a small glaze key grouped by product line.

## Scoring algorithm (implement exactly)
Ratings are an ordered scale [Recommended, Worth a test, Skip]. "Step toward Skip by k" moves k positions toward Skip (clamped to the ends); negative k moves toward Recommended.

Hand-curated constant sets (judgment data that lives in this repo and is edited with the owner):
- VERYPALE = {C-21, CO-6, CO-21, PG-54, PG-55}
- LIGHTCRYSTAL = {CO-6, CO-21}
- SHOWS = {TP, TC, ST, PO} (clay classes through which body speckle reads)
- REACT (reactive colour seams), unordered pairs: {COPPER, IRON}, {COBALT, IRON}, {COBALT, COPPER}, {IRON, PINK}
- BD (clay-class base darkening delta): TP -1, TC -1, ST 0, IR +1, OS 0, PO -1
- A_NAMED, top-pick `base|top` pairs: C-21|CR-12, C-21|PC-12, C-21|PC-14, C-21|PC-56, C-21|PG-54, C-47|CR-12, C-47|PC-14, C-47|PC-56, C-47|PG-54, C-53|CR-12, C-53|PC-17, PC-10|PC-17, PC-25|PC-56, PC-31|PC-12, PC-31|PC-30, PC-31|PC-48, PC-31|PC-56, PC-31|PG-54, PC-31|PG-55, PC-32|PC-25, PC-32|PC-56, PC-40|CR-12, PC-40|PC-12, PC-40|PC-14, PC-40|PG-54, PC-40|PG-55, PC-48|PG-55, PC-59|PC-25
- B_NAMED, strong-but-runs `base|top` pairs: C-53|PC-14, PC-10|PC-14, PC-12|PC-14, PC-25|PC-17, PC-30|PC-14, PC-30|PC-17, PC-30|PG-54, PC-31|PC-14, PC-32|PC-14, PC-32|PC-17, PC-59|PC-14, SW-190|PG-54

interest(b, t): start at 0. Add 1 if either has a Strong break. If the two have different Color Family, add 2 if the pair is in REACT else add 1. Add 1 if either is translucent. Add 1 if exactly one is metal. Add 1 if the top has flux. Add 1 if the top has phase.

runRisk(b, t): true if mv(top) is 3, or mv(base) is 3, or the top has flux, or either has crystal, or mv(base) plus mv(top) is at least 5.

deco(b, t, single): for a single, true if fs(base) is DECO or COND. For a combo: if the top has crawl, true unless the base is celadon; else if either fs is DECO, true; else if the top is hicrystal and mv(base) is at most 1, true; else if either fs is COND, true; else false.

baseLook(b, t), the look on a white body (clay-independent), returns Recommended, Worth a test, or Skip:
- if the base is topper or hicrystal or crawl, Skip (cannot be a base)
- else if the top has crawl, Recommended if the base is celadon (the signature food-safe crawl-over-celadon look) else Worth a test
- else if both are metal, Skip (they cancel to a muddy matte)
- else if both have mv 3, Skip (they sheet off together)
- else if the top is hicrystal, Worth a test if mv(base) is at most 1 else Skip
- else if the pair is in A_NAMED or B_NAMED, Recommended
- else Recommended if interest is at least 4 else Worth a test

ddCombo(b, t), the full darkening delta at a near-black body: BD[cls(base)] plus (1 if cls(top) is IR else 0) plus (-1 if cls(top) is in {TP, PO} and cls(base) is in SHOWS else 0) plus (-1 if cls(base) is TP and cls(top) is in {TP, PO} else 0) plus (-1 if the top is hicrystal and the top is in LIGHTCRYSTAL else 0). Clamp to the range -3 to +1.

singleLvl(b), the full single demote at near-black: 0 if the base has crawl; else TP -2, TC -1, ST 0, IR 0, OS 0, PO is -2 if the base is in VERYPALE else -1.

Per-clay band rating, parameterized by clay darkness D and speckled S:
- Combo: let bl be baseLook(b, t). If bl is Skip, the band is Skip. Otherwise let ddD be round(ddCombo(b, t) times D divided by 3), and let r be bl stepped toward Skip by ddD, so a positive delta darkens and demotes while a negative delta (the iron bonus) promotes. Then if S is true and cls(base) is in SHOWS, step r one toward Recommended (the freckle bonus). That r is the band.
- Single: let slD be round(singleLvl(b) times D divided by 3), and let r be Recommended stepped toward Skip by slD. Then if S is true and cls(base) is in SHOWS, step one toward Recommended.

This reproduces the three current clays exactly: WH8 (D 0, S false) is the white baseline; Ermine (D 0, S true) is the baseline with a freckle promotion; Chocolate (D 3, S false) is full darkening. It also generalizes to any future Tone or Speckled clay. Run-risk and decorative are computed once per cell (clay-independent), and a cell whose every band is Skip shows no tags.

## Detail-panel text
One-line recommendation per cell. Structural cases get a plain explanation: base-is-topper ("works best on top; buried as a base it runs or muddies"), base-is-hicrystal ("very fluid crystalline meant to stand alone; sheets off as a base"), base-is-crawl ("crawls into raised beads; use it as the top over a celadon"), top-is-crawl-over-celadon ("signature food-safe use; beads up over the celadon, food-safe only over a celadon"), top-is-crawl-over-nonceladon ("beads for texture, decorative"), both-metal, both-high-mover, top-hicrystal-over-stable ("pools crystals over the stable base, lovely but very fluid"), top-hicrystal-over-mover ("too fluid to sit over the moving base"). A_NAMED gives "Top pick: ...". B_NAMED gives "Strong but runs: ...". Otherwise list the interesting features (strong break, reactive or contrast seam, translucent veil, phase float, metallic focal). Append suggested coats: a base gets 2 coats if it is a high-mover else 3; a top gets 1 if a high-mover else 2; crawl uses the range 1 to 4. Singles describe the glaze on its own, 4 coats if crystal, 2 if high-mover, else 3, with a thickness gradient, noting decorative or over-celadon-only where relevant.

Per-clay note, keyed on the clay's darkness and speckle and the band rating: a light body (D 0) reads colour brightest and truest, and if speckled it freckles up through the glaze for character. On a darker body, if the band is Skip the pale or transparent component goes muddy (suggest brushing a white slip first); if iron is involved it deepens and enriches (richest of the set); if merely demoted it darkens and mutes a touch but is still worth a tile; otherwise the opaque layer covers the dark body and holds with deepened rims. Near-black bodies fire with a hold.

## Blackout and progress
Always build the full matrix from Glazes by Clays. Test Tiles only paints over it; never require a combination to have a tile. A given band (cell by clay) blacks out if and only if some Test Tiles row maps to that (base code, top code, clay name) and has Status equal to Finished. Single-tile cells (row equals column) match rows that have no top. Ignore any finished row whose glaze code or clay is not in the current matrix, which is what lets the tile database grow freely. Progress: count bands rated Recommended as the goal, with a UI toggle to also include Worth a test. The denominator is those target bands and the numerator is how many are blacked out. Default to Recommended only. Progress does not affect blackout.

## Design decisions (already settled, honor these)
- Three band colours only; colour means look quality. Run-risk and decorative are corner tags, not colours.
- Notion is the single source of truth; adding a glaze is just filling its fields. The algorithm and the A_NAMED and B_NAMED lists live in this repo and are changed deliberately with the owner.
- One row per physical tile in Test Tiles (base, top, clay, status, photo). The owner shares a customer-facing Combos view that is a photo gallery only; customers do not see glaze names, combos, or clay, and the same combo appearing on multiple clays is fine and wanted.
- Blackout trigger is row existence plus Status equal to Finished, so the owner can plan combinations (rows in any other status) without changing the matrix.
- Base Glaze and Top Glaze are relations to the Glazes database so new glazes are automatically selectable.
- The matrix is generated from Glazes and Clays so it is always complete; Test Tiles is a sparse overlay that grows over time.
- Glazes without a Clay Class and clays without a Tone are excluded.

## Deploy (give these steps to the owner when done)
1. Create an internal integration at notion.so/profile/integrations and copy its token.
2. In Notion, open Glazes, Clays, and Test Tiles and add the integration under Connections (read access suffices).
3. On Vercel, deploy and set the env var NOTION_TOKEN. CLI path: `npx vercel`, then `npx vercel env add NOTION_TOKEN`, then `npx vercel --prod`. Or import the repo and set the variable in the dashboard.
4. Open the production URL to verify, then embed it in Notion with `/embed` on any page.

## Extending later (do this with the owner)
- New glaze: the owner adds the row and fills Movement, Breaks over Texture, Finish, Food Use, Color Family, Clay Class, and Layering Role. Then, together, decide its Clay Class judgment and whether it belongs in any A_NAMED or B_NAMED pairing (a code change).
- New clay: the owner adds the row and sets Tone and Speckled, and it renders as a new band automatically. If it is a Buff or Brown body, tune the darkening model (the D-scaled deltas) together, since only White and Near-black are validated so far.

## First task for this session
Scaffold the repo described above (package.json, vercel.json, api/index.js, public/app.js, public/style.css), implementing the Notion fetch, the scoring algorithm, the matrix UI, the blackout, and the progress bar exactly as specified. Keep all user-facing copy free of em dashes. Verify the build runs, then give the owner the deploy steps.
