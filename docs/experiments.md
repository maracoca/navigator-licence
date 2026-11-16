# Experiment log

One entry per experiment: what was tested, the setup, what came out, and what changed because of it.
Entries before the evaluation sets existed (E1–E5) are development checks on a handful of hand-picked
inputs. They show how the design evolved; they are **not** evaluation results.

Setup unless stated otherwise: LLM `gpt-4o-mini` (temperature 0), embeddings `text-embedding-3-small`,
city Cluj-Napoca (bbox 46.73–46.80 N, 23.52–23.68 E), OSM extract from Geofabrik (Romania, 333 MB, downloaded 2026-11-14).

---

## E1 — City data build (2026-11-14)

**What:** build the walking graph and the place list for Cluj from the OSM extract (`npm run build:city -- cluj-napoca`).

**Results**
| | |
|---|---|
| Build time | 46–54 s (almost all of it reading the 333 MB file) |
| Load time at server start | ~135 ms |
| Street graph | 67,069 nodes, 74,376 edges, 1,428 km of walkable ways |
| Removed as disconnected | 83 small components (596 nodes, 536 edges); only the largest connected network is kept |
| Places kept | 23,169 (top keys: amenity 7,114 · natural 5,927 · shop 2,171 · landuse 1,183 · building 1,087 · leisure 1,002 · tourism 365 · historic 237) |
| Places dropped | 30,553 unnamed buildings, 16,787 line-only (roads, fences), 8,087 unnamed generic objects (mostly address points), 4,122 vertex-only (crossings, entrances), 1,286 not searchable, 132 multipolygon relations (not read yet) |

**Street tag coverage** (share of walkable street *length* that has the key at all):
| Key | Coverage |
|---|---|
| `lit` | 11.31 % |
| `surface` | 61.37 % |
| `wheelchair` | 0.01 % |

**Takeaway:** street preferences can only act on the streets that are tagged. For lighting, ~89 % of the network is
"unknown", for wheelchair access practically all of it. This is the motivation for reporting coverage to the user
instead of hiding it, and for the later idea of collecting missing tags from users.

---

## E2 — Vocabulary index and phrase search (2026-11-14)

**What:** embed the OSM kinds of place (iD tagging schema 7.3.0: name + search terms per preset) and Google's place types
(Table A), then search 20 phrases and look at the closest matches.

**Setup:** 1,334 OSM presets (searchable, point or area), 472 Google types; build time 12.4 s.

**Results** (top match, cosine similarity in brackets; ✓ = an acceptable kind, ✗ = not):
| Phrase | OSM top match | Google top match |
|---|---|---|
| cafe | ✓ amenity/cafe (0.70) | ✓ cafe (1.00) |
| coffee | ✓ amenity/cafe/coffee_shop (0.48), near-tie with shop/coffee, amenity/cafe | ✓ coffee_shop (0.59) |
| cofee shp *(typo)* | ✓ amenity/cafe/coffee_shop (0.47) | ✓ coffee_shop (0.53) |
| museum | ✓ tourism/museum (0.57) | ✓ museum (1.00) |
| bench | ✓ amenity/bench (0.54) | ✗ bridge (0.50) — Google has no bench type |
| park bench | ✗ leisure/picnic_table (0.65), bench 2nd (0.61) | ✗ park (0.54) |
| catholic church | ✗ building/cathedral (0.42) | ✓ church (0.49) |
| church | ~ building/church (0.61), place_of_worship/christian 2nd | ✓ church (1.00) |
| place to charge my phone | ✓ amenity/device_charging_station (0.62) | ✗ ebike_charging_station (0.58) |
| library | ✓ amenity/library (0.66) | ✓ library (1.00) |
| public toilet | ~ amenity/toilets/portable (0.67), toilets 2nd | ✓ public_bathroom (0.82) |
| viewpoint | ✓ tourism/viewpoint (0.71) | ~ observation_deck (0.50) |
| fountain | ✓ amenity/fountain (0.72) | ✓ fountain (1.00) |
| ice cream | ✓ amenity/ice_cream (0.65) | ✓ ice_cream_shop (0.82) |
| takeaway food | ✓ amenity/fast_food (0.58) | ✓ meal_takeaway (0.67) |
| cheap restaurant | ✗ a cuisine-specific restaurant (0.56) | ✗ pizza_restaurant (0.76) |
| supermarket | ✓ shop/supermarket (0.69) | ✓ supermarket (1.00) |
| pharmacy | ✓ amenity/pharmacy (0.60) | ✓ pharmacy (1.00) |
| bookshop | ✓ shop/books (0.67) | ✓ book_store (0.84) |
| bar | ✗ barrier (0.49), amenity/bar 2nd (0.47) | ✓ bar (1.00) |

**Takeaways → changes**
- Plain kinds of place are found well; very short words (*bar*) and phrases with extra words (*cheap*, *catholic*) are not.
  → The LLM rewrites each request item into plain kind-of-place phrases and keeps qualities separately (`details`).
- Close scores are common. → When the best match is not clearly ahead (`presetClearLead` = 0.05), the LLM picks among the
  top candidates only; it cannot produce a tag that is not in the list.
- Google has no category for some things (bench). → The LLM may choose "no Google type" for an item.

---

## E3 — Request understanding on 4 sentences (2026-11-14)

**What:** run the understanding step (LLM labels + phrase search + pick) on four sentences.

| Sentence | Result | Problems |
|---|---|---|
| Visit a museum, then grab a quick coffee, and sit on a bench if there's one along the way. Well-lit streets please. | museum (order 1), coffee (order 2, quick), bench (optional), lit: prefer | bench also got order 3, which the sentence does not clearly say |
| I need somewhere to charge my phone and a cheap place to eat, no stairs please, I have a stroller | cafe/library; restaurant/fast food with detail "cheap"; no_steps: require | the stroller did not also produce the wheelchair/stroller preference |
| first a catholic church, then two bookshops, and maybe an ice cream. shady streets would be nice | church + "catholic" (1), bookshop ×2 (2), ice cream optional; "shady" reported unsupported | — |
| spend an hour at the art museum then find a bar | art museum (long, 60 min fixed) then bar | — |

**Takeaway:** labels are mostly right without any word-specific rules; the review cards are where remaining mistakes get corrected.

---

## E4 — First end-to-end plans (2026-11-14)

**What:** whole pipeline (understand → places → walking times → planner → routes) on real requests.

**First run** (station → Central Park, 90 min, museum → quick coffee → optional bench, lit streets):
all three stops came from OSM, the museum chosen was a small memorial museum, total 86/90 min while the museum stay had
been shortened. Inspection showed Google had returned well-rated results (e.g. National Museum of the History of
Transylvania 4.2★, Ethnographic Museum 4.5★, cafés rated 4.6–5★) but the candidate list kept only the 8 places closest to
the route, which were mostly small OSM places.

**Changes**
- Candidate pool per item = 4 closest to the route + 4 best-rated within reach (`candidatesByRating`).
- After real routes are known, minutes reserved for street preferences but not used are given back to shortened stays.
- Rating is still only a tie-breaker (1 min per star). Whether quality should weigh more was left open on purpose.

**Second run** (departure 2026-11-16 14:00):
| Request | Plan | Total / budget | Street coverage | Time |
|---|---|---|---|---|
| museum, quick coffee, bench if along the way, lit streets (station → Central Park) | memorial museum → Portal café (5★) → bench | 90 / 90 | 21 % lit, 0 % unlit, 79 % unknown | 0.35 s |
| charge my phone + cheap place to eat, no stairs (Piața Unirii → Iulius Mall) | CUPRO coffee (5★) → Trattoria de Florian (4.7★) | 86 / none | 100 % step-free | 1.8 s |
| catholic church, then two bookshops, maybe an ice cream (Piața Mihai Viteazul → Piața Unirii) | Franciscan church → Cărturești Library → Cărturești Casa Hintz → Bianco Milano | 59 / 60 | — | 4.0 s |
| public toilet and a fountain on a paved route (station → Piața Unirii) | public toilet (4.5★) → fountain | 37 / 40 | 95 % paved, 5 % unknown | 0.8 s |

(Times include Google calls that were not yet cached.)

---

## E5 — Specific wishes: "modern art museum", "catholic church"… (2026-11-16)

**What:** check whether qualities the user asks for are respected.

**Before:** "modern art museum" → the word *modern* was dropped (Google was searched with the type name "art museum");
"a very famous museum" → *famous* was dropped. Places from OSM were never checked against qualities at all.

**Change (level 1):**
1. The LLM separates the kind of place from the qualities asked for.
2. Google is searched with quality + kind ("catholic church"), still restricted to the matching Google type.
3. For items with a quality, the 20 candidates closest to the route are judged by the LLM as *fits / doesn't fit / can't tell*,
   **only from the facts we hold** (name, Google types and short description, OSM tags).
   Fitting places are used if any; otherwise "can't tell" places with a notice; if all clearly don't fit, the item is skipped (`no_match`).

**Results over three iterations** (5 requests, no time budget):
| Request | v1 | v2: stricter judging | v3: judged against the user's own words |
|---|---|---|---|
| catholic church | ✓ St. Michael's Church — evidence: Google description "historic Catholic church"; also found 3 more via OSM `denomination=roman_catholic` | ✓ same | ✓ same |
| orthodox church | ✓ (evidence: OSM `denomination=orthodox`, Google descriptions) | ✓ | ✓ Orthodox Metropolitan Cathedral |
| cafe with a terrace | not confirmed for any café → notice; 2 cafés correctly rejected by OSM `outdoor_seating=no` | same | same |
| modern art museum | ✗ Art Museum accepted as "modern" from `museum=art` + "fine art museum in a baroque building" | ✗ the kind was split as *museum* + *modern* (art lost) → "Steampunk Transylvania" and a museum opened in 2001 accepted as modern | ✗ Art Museum accepted again |
| vegan restaurant | ✗ nothing found: kept as kind "vegan restaurant", Google type `vegan_restaurant` returned 0 places | ✗ same | ✗ same |

**Method note:** in v1 the prompts contained "modern art museum" and "vegan restaurant" as examples — the same cases being
tested. They were replaced in v2 by unrelated examples (gothic cathedral, second-hand bookshop, halal butcher), and these
words are now on the "avoid" list for the evaluation sets.

**Takeaways**
- Qualities the data records (religion, outdoor seating) are handled correctly and every decision is traceable to a tag or a description.
- Qualities the data does not record (*modern*) cannot be confirmed honestly; `gpt-4o-mini` still answers "fits" from a broader category.
- Splitting kind and quality is not reliable with `gpt-4o-mini` (*vegan restaurant* kept whole; *modern art museum* split as museum + modern).

**Open options:** a stronger model for the judging step only; show the evidence on each stop; when a narrow Google type
returns nothing, also search the general type with the quality in the text.

---

## E6 — Evaluation runner (2026-11-16)

**What:** `npm run eval -- --set dev|test` runs a set end to end (understand → plan, no human edits), scores it
(see `eval/README.md`, "Results") and saves the run with git commit, models, parameters and cache mode to `eval/runs/`.

**Check of repeatability:** 3 throwaway cases, first with live API calls (28 s), then with `--replay` (1.7 s):
understanding, plans and all scores were identical (timings excluded). 33 unit tests pass (incl. 18 for the metrics).

**Observations from the throwaway cases (to be measured properly on the sets, not patched now):**
- "shady streets would be nice" → reported as unsupported, but `lit` and `paved` preferences were also added though not asked for.
- "a quick coffee" → *quick* was stored as a quality (`details`) instead of only as pace.
- "two bookshops and then something to eat" → order 1 for the bookshops but none for the food; the food stop was a coffee-to-go place with a 52-min stay.

**Fixed:**
- The notice "This request has many stops…" appeared whenever an item asked for more than one place, even with 3 stops.
  It now appears only when a request really exceeds `maxSlots` and is cut.
- Start/end lookup now skips Google results that are a whole area (city, county) and takes Google's best *place*.
  (The reported case "Gara Cluj-Napoca → the city" turned out to be the station after all: Google names the station
  "Cluj Napoca", type `train_station`.)

---

## E7 — Choosing the street preference menu from data (2026-11-16)

**Why:** the first menu (lit, paved, no stairs, wheelchair) was chosen from memory, not from how streets are actually mapped.

**What:** two reports, both re-runnable:
- worldwide: `npm run report:street-tags-world` → `docs/street-tags-world.md` (OSM taginfo, 263.9 million walkable ways, counted per way);
- per city: `npm run report:street-tags -- cluj-napoca` → `docs/street-tags-cluj-napoca.md` (share of walkable length).

**Key numbers**
| Property | Tags | Worldwide (share of ways) | Cluj (share of length) |
|---|---|---|---|
| surface | `surface` | 28.5 % | 61 % |
| traffic | `highway` class (+ `maxspeed`, `lanes`) | 100 % (7 %, 6 %) | 100 % (37 %, 33 %) |
| sidewalks | `sidewalk`, `sidewalk:*`, `footway=sidewalk` | ≈3 % + sidewalks mapped as own ways (`footway` 5.8 %) | 34 % + 10 % |
| lighting | `lit` | 4.9 % | 11 % |
| smoothness | `smoothness` | 2.5 % | 19 % |
| slope | `incline` | 0.6 % | 0.9 % |
| wheelchair | `wheelchair` on ways | < 0.35 % (not in top 50) | 0.01 % |
| covered | `covered`, `tunnel` | < 1 % | < 1 % |

**Decision (with the owner):**
- Menu is now: **lit**, **paved & smooth** (surface + smoothness), **no stairs**, **little traffic** (new; from the street class), **sidewalks** (new).
- **Wheelchair removed**: the tag is almost never mapped; a real accessibility profile (kerbs, widths, slopes) is a project of its own.
- **Flat**: cannot come from tags (incline 0.6 %); possible later from open elevation data.
- Properties are now ordered rule lists (first matching rule decides), still data, following the OSM wiki; 6 unit tests.

**How much of Cluj each property can judge** (after rebuilding the city with the new keys; share of 1,428 km):
| Property | good | bad | unknown |
|---|---|---|---|
| lit | 9.8 % | 1.5 % | 88.7 % |
| paved | 49.6 % | 11.8 % | 38.6 % |
| no_steps | 99.2 % | 0.8 % | 0.0 % |
| quiet | 78.0 % | 11.5 % | 10.6 % |
| sidewalk | 63.5 % | 10.4 % | 26.2 % |

**Takeaway:** "little traffic" and "sidewalks" can be judged on most streets, lighting on very few. Earlier the app told
users "quiet streets" were unsupported although the data supports them well — an example of why the menu has to come from data.

---

## E8 — First dev-set baseline (2026-11-16)

**Run:** `eval/runs/2026-11-16_14-35-45_dev.json` — 31 dev cases, record mode, 175 s, code not yet committed
(the run lists the changed files). Street menu: lit, paved, no_steps, quiet, sidewalk.

**Understanding**
| Metric | Result |
|---|---|
| Items precision / recall | 95.8 % (46/48) / 95.8 % (46/48) |
| OSM kinds that fit an expected tag | 85.9 % (55/64) |
| required | 97.8 % (45/46) |
| order | 82.6 % (38/46) |
| count | 100 % (45/45) |
| pace | 100 % (41/41) |
| wish (present vs absent) | 88.6 % (39/44) |
| street (property + mode) P / R | 26.7 % (4/15) / 36.4 % (4/11) |
| street (property only) P / R | 73.3 % (11/15) / 100 % (11/11) |
| unsupported street wish detected | 96.8 % (30/31) |

**Planning:** 31/31 plans; all understood required items placed in 26/27; 29/29 within budget; walking vs shortest
walk mean 1.57, median 1.13; stops per plan mean 1.5 (max 3); skipped: 1 over budget (dev-18, 25-min budget),
1 no candidates (dev-30, surf shop). Understanding 4.0 s mean, planning 1.6 s mean (0.7 s median).

**Error patterns (systematic, not single cases)**
1. **"require" used too often** for street preferences: when one preference in a sentence is a must, the others become
   musts too (dev-27, dev-29, dev-30, dev-31). This is why property+mode precision is 27 % while property-only recall is 100 %.
2. **Plain lists read as a sequence**: "a bakery, a bank, and a hardware store" got order 1-2-3 (dev-06, dev-07, dev-09).
3. **The destination taken as a stop**: "before heading to the mall" (the mall is the destination) became an item,
   matched to the wrong kind (`place=square`) (dev-16).
4. **Purpose and time words stored as wishes**: "for dinner", "long, unhurried", "for a few minutes", "still open"
   (dev-10, dev-19, dev-26, dev-31).
5. **Street preferences invented for a place quality**: "a wheelchair-accessible museum" added no_steps (require), lit, paved,
   sidewalk (dev-23) — likely compensating for the removed wheelchair street property.
6. **Two needs merged into one item**: "somewhere to sit down … and top up my phone battery" became one café item, and the
   phone battery was put in the *street* unsupported list (dev-26).

**Not errors of the app:** dev-30 "surfboard shop" → `shop=water_sports`, arguably a better kind than the expected `shop=sports`.

---

## E9 — Six general prompt rules, measured on the dev set (2026-11-16)

**Baseline:** `eval/runs/2026-11-16_15-05-52_dev.json` (the E8 run replayed on clean commit 20c4c4a: identical scores).
**After:** `eval/runs/2026-11-16_15-13-58_dev.json` (record run).

**Changes** (one per error pattern of E8; written as general rules with examples that appear in neither set — checked
by searching both sets for the example words; "stick to" was found in a dev and a test sentence and removed):
1. Decide prefer/require separately for each street preference; polite wishes are "prefer".
2. A list joined by commas or "and" is not a sequence.
3. The start and end of the walk are never items. **Code change:** the start and end names are now passed to the model
   (`/api/understand` takes optional `origin`/`destination`; the app and the eval runner send them).
4. Details describe what the place is like — never purpose, duration, opening times or optionality.
5. A quality of a place is never a street preference.
6. Each separate need is its own item.

**Results**
| Metric | Before | After |
|---|---|---|
| Items P / R | 95.8 % / 95.8 % | 95.8 % / 95.8 % |
| Kinds fitting an expected tag | 85.9 % | 86.9 % |
| required | 97.8 % | 97.8 % |
| **order** | 82.6 % (38/46) | **100 % (46/46)** |
| count / pace | 100 % / 100 % | 100 % / 100 % |
| **wish** | 88.6 % (39/44) | **95.5 % (42/44)** |
| **street, property only, precision** | 73.3 % (11/15) | **100 % (11/11)** |
| street, property + mode, P / R | 26.7 % / 36.4 % | 45.5 % / 45.5 % |
| unsupported street wish | 96.8 % | 100 % |
| all understood required items placed | 96.3 % (26/27) | 92.6 % (25/27) |
| walk / shortest, mean | 1.57 | 1.36 |

**Remaining errors**
- **Street mode still over-uses "require"** for polite wishes ("please use smooth paved paths", "pls", "please stick to …")
  in dev-27, 29, 30, 31, although the rule now says so explicitly. `gpt-4o-mini` does not follow this rule reliably.
- **Wish placement is unstable:** "an Orthodox church" now kept *Orthodox* in the search phrase instead of the wish
  (dev-22), so the wish check does not run for it — it was correct in the baseline. "botanical" (dev-08) still not a wish.
- **dev-26** now correctly gives two items, but "somewhere to sit down" became a café "with seating" (expected: a bench)
  and the second item no longer fits the 55-min budget — this is why "required items placed" dropped from 26 to 25.

**Recommendation (to be confirmed by the owner):** keep the changes (large gains in order, wish, invented street preferences; no metric got worse except the
one case explained above).

---

## E10 — Same prompt, stronger models (2026-11-16)

**What:** the E9 prompt and everything else unchanged; only the LLM used by all LLM steps (reading the request, picking
kinds, judging wishes) is changed with `LLM_MODEL`. Pinned versions. All three accept temperature 0; the newer GPT-5-family
models were not compared because they do not accept that setting (would need a code change).

Runs: `gpt-4o-mini` → `2026-11-16_15-13-58_dev.json` (E9), `gpt-4o-2024-11-20` → `2026-11-16_15-34-28_dev.json`,
`gpt-4.1-2025-04-14` → `2026-11-16_15-36-15_dev.json`.

| Metric (31 dev cases) | gpt-4o-mini | gpt-4o | gpt-4.1 |
|---|---|---|---|
| Items P / R | 95.8 / 95.8 % | 97.9 / 97.9 % | **100 / 100 %** |
| Kinds fitting an expected tag | 86.9 % | 84.8 % | 85.9 % |
| required | 97.8 % | 100 % | **100 %** |
| order | 100 % | 91.5 % | **100 %** |
| count / pace | 100 / 100 % | 100 / 100 % | 100 / 100 % |
| wish | **95.5 %** | 93.3 % | 93.5 % |
| **street, property + mode, P / R** | 45.5 / 45.5 % | 58.3 / 63.6 % | **91.7 / 100 %** |
| street, property only, P / R | 100 / 100 % | 91.7 / 100 % | 91.7 / 100 % |
| unsupported street wish | 100 % | 100 % | 96.8 % |
| all understood required items placed | 92.6 % | 96.3 % | 96.4 % |
| understanding time, mean | 3.6 s | 2.8 s | 3.1 s |

**Remaining gpt-4.1 errors:** "a wheelchair-accessible museum" still adds a street preference (no_steps, prefer —
milder than before) (dev-23); "keep off busy main roads" mapped to `quiet` **and** also listed as unsupported (dev-30);
"overlooking the city" and "water bottle refill" stored as wishes (dev-17, dev-25); "botanical" not a wish (dev-08).

**Takeaway:** the over-use of "require" was a limitation of the small model, not of the prompt: with the same prompt,
gpt-4.1 gets prefer/require right in 11 of 12 cases. gpt-4o (larger, same generation as the mini) helps only partly.
Cost per token is several times higher than gpt-4o-mini (check current OpenAI pricing); per request it stays at roughly
a cent or less, since each request sends a few thousand tokens.

---

## E11 — Current (non-deprecated) models (2026-11-16)

**Why:** OpenAI marks `gpt-4o-mini` and `gpt-4.1` as deprecated; both snapshots shut down on 2027-01-14 (replacement
named: `gpt-6-luna`). Current models are reasoning models with a reasoning-effort setting; `temperature` is accepted
only with effort `none` (checked with direct API calls: `gpt-6.1-sol` rejects temperature and has no `none`).

**Code change:** the model's reasoning effort is configurable (`LLM_REASONING_EFFORT`); temperature 0 is sent only when
allowed; the effort is part of the saved-answer key and of each run's record. Earlier runs still replay identically.

**Runs** (same prompt as E9/E10): `gpt-6-luna`/none → `2026-11-16_15-43-44_dev.json`, `gpt-6-luna`/low →
`2026-11-16_15-46-00_dev.json`, `gpt-6.1-terra`/none → `2026-11-16_15-49-07_dev.json`, `gpt-6.1-sol`/low →
`2026-11-16_15-52-02_dev.json`. Prices per 1M tokens (input/output) from OpenAI's pricing page on 2026-11-16.

| Metric (31 dev cases) | gpt-4o-mini | gpt-4.1 | **gpt-6-luna none** | gpt-6-luna low | gpt-6.1-terra none | gpt-6.1-sol low |
|---|---|---|---|---|---|---|
| Price in / out | $0.15 / $0.60 | $2 / $8 | **$0.10 / $0.50** | $0.10 / $0.50 | $1 / $5 | $2 / $10 |
| Items P / R | 95.8 / 95.8 | 100 / 100 | 97.9 / 97.9 | 97.9 / 97.9 | 97.9 / 97.9 | 95.9 / 97.9 |
| Kinds fitting | 86.9 | 85.9 | 93.0 | 89.7 | 100 | 94.4 |
| required | 97.8 | 100 | 100 | 100 | 97.9 | 93.6 |
| order | 100 | 100 | 100 | 100 | 100 | 100 |
| pace | 100 | 100 | 97.6 | 95.1 | 100 | 100 |
| wish | 95.5 | 93.5 | 95.6 | 93.3 | 95.6 | 93.3 |
| street prop + mode P / R | 45.5 / 45.5 | 91.7 / 100 | **100 / 100** | 90.9 / 90.9 | 90.9 / 90.9 | 90.9 / 90.9 |
| unsupported street wish | 100 | 96.8 | 100 | 100 | 100 | 96.8 |
| understanding time, mean | 3.6 s | 3.1 s | 3.8 s | 5.1 s | 4.8 s | 6.0 s |

**Takeaways**
- All current models fix the prefer/require problem of `gpt-4o-mini` with the same prompt.
- More reasoning (effort low, larger models) did not help on this short extraction task; it only made it slower.
- With 31 cases one case ≈ 3 points, so differences of one or two cases between current models are within noise.
- Errors shared by all six setups: "botanical" not stored as a wish (dev-08), "overlooking the city" stored as one (dev-17)
  — worth re-reading these two expected answers.
- `gpt-6-luna` has no dated snapshot yet; the saved answers keep these runs replayable regardless.

**Decision:** the app now uses `gpt-6-luna` with effort `none` (`server/.env`, documented in `server/.env.example`) —
the best street results, at or near the top elsewhere, and the cheapest model tested.
