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

**Reference run on a clean commit:** `eval/runs/2026-11-16_16-07-15_dev.json` — the gpt-6-luna/none run replayed on commit a30b399 (identical scores). This is the dev baseline for the next changes.

---

## E12 — Two expected answers corrected (2026-11-17)

Both were "wrong" for all six model setups in E10–E11; on inspection the expected answers were the problem:
- **dev-08** "a botanical garden": the expected answer had *botanical* as a wish; it is a kind of place of its own
  (OSM preset leisure/garden/botanical, Google type botanical_garden), and every model found the real Botanical Garden.
  Expected wish set to null.
- **dev-17** "viewpoints overlooking the city": whether this is a wish is ambiguous (most, not all, viewpoints in a city
  overlook it), so the wish field was removed — not scored either way, as the README allows.

Re-scored from saved answers (no new model calls): `eval/runs/2026-11-17_15-39-51_dev.json`.

**Found along the way (not changed, see ideas):** in dev-17 the wish check used only the one viewpoint whose name confirms
the city view, so the plan walked 76 min against an 8-min direct walk.

---

## E13 — First test-set run (2026-11-17)

**Run:** `eval/runs/2026-11-17_15-57-47_test.json` — 45 test cases, run once, record mode, 224 s.
Code = commit a30b399 (gpt-6-luna, effort none; E9 prompt). Uncommitted at the time: docs, dev set and run files only.
**These are the official test results; the test set was not used for any decision before this run.**

| Metric | Dev (E12) | **Test** |
|---|---|---|
| Items P / R | 97.9 % / 97.9 % | **97.0 % (64/66) / 94.1 % (64/68)** |
| Kinds fitting an expected tag | 93.0 % | **95.8 % (69/72)** |
| required | 100 % | **100 % (64/64)** |
| order | 100 % | **100 % (64/64)** |
| count | 100 % | **98.4 % (63/64)** |
| pace | 97.6 % | **84.4 % (54/64)** |
| wish | 100 % | **90.6 % (58/64)** |
| street, property + mode P / R | 100 % / 100 % | **100 % / 100 % (11/11)** |
| unsupported street wish | 100 % | **100 % (45/45)** |
| plans made | 31/31 | **45/45** |
| all understood required items placed | 96.3 % | **95.0 % (38/40)** |
| within budget | 100 % | **97.7 % (42/43)** |
| walk / shortest walk (mean, median) | 1.36, 1.13 | **1.45, 1.17** |
| understanding / planning time, mean | 3.8 s / 0.5 s | **3.8 s / 1.1 s** |

**Error analysis** (read after the run; nothing was changed because of it)

*App errors*
- Kind words stored as wishes: "historic" (ruin), "cocktail" (bar), "bottled" (water), "public" (toilet) — 4 cases.
- Places of worship matched to the *building* kind (`building=church`, `building=synagogue`) instead of
  `amenity=place_of_worship` (test-22, test-27). The planner still finds churches (in Cluj they usually carry both tags),
  but the chosen kind is the less precise one.
- test-39: the time budget (60 min) was shorter than the direct walk (73 min). No stop can fit, but the app reported
  "no candidates" for both items instead of saying that the time is too short. (Also the only over-budget plan.)

*Expected answers that contradict the README's own rules* (the same kinds of mistakes corrected in the dev set in E12)
- Pace "quick" for needs whose sentence has no word about a short stay (test-37, 38, 39, 40; 7 of the 10 pace errors);
  "a full hour" expected as pace long (test-29) where the app records a stated duration instead.
- The destination expected as a stop: test-17 (the cemetery is the end of the walk), test-18 ("end at a park", the park is
  the end) — the app correctly leaves the end out (E9 rule).
- A kind of place expected as a wish: "botanical" (test-29, as dev-08), "ski rental" (test-45).

**Agreed before the run:** the scores above are the official first test result.
**Proposed (owner to decide):** do not change the test expected answers now; if they are corrected later, report the scores
both as first measured and after correction, with the list of changes.

---

## E14 — Test set re-scored after correcting human errors in expected answers (2026-11-17)

**What:** only the answer sheet changed; the app, the prompts and the model answers are exactly those of E13
(re-scored from the saved answers): `eval/runs/2026-11-17_17-37-31_test.json`.

**Corrections** (each one an expected answer that contradicts the README's own rules, where the app followed them):
- test-17: removed "cemetery" as a stop — the walk ends at the cemetery.
- test-18: removed "park" as a stop — "end at a park", the park is the end of the walk.
- test-29: wish "botanical" → null (a botanical garden is a kind of place); pace removed ("a full hour" is a stated duration, not a pace).
- test-45: wish "ski rental" → null (it is the kind of place).
- test-37, 38, 39, 40: pace quick → normal for 7 items (no word in the sentence about a short stay).
Not changed (debatable, or the app is wrong): test-19 pace, the church/synagogue building kinds, the four kind words stored as wishes.

| Metric | First test (E13) | **After corrections (E14)** |
|---|---|---|
| Items P / R | 97.0 % / 94.1 % | **97.0 % / 97.0 % (64/66)** |
| Kinds fitting | 95.8 % | 95.8 % |
| required / order | 100 % / 100 % | 100 % / 100 % |
| count | 98.4 % | 98.4 % |
| pace | 84.4 % (54/64) | **96.8 % (61/63)** |
| wish | 90.6 % (58/64) | **93.8 % (60/64)** |
| street P / R | 100 % / 100 % | 100 % / 100 % |
| unsupported street wish | 100 % | 100 % |

**Remaining test errors are the app's own:** kind words stored as wishes ("historic", "cocktail", "bottled", "public");
places of worship matched to building kinds (test-22, test-27); test-19 pace; test-39 message when the time budget is
shorter than the direct walk.

**For the thesis:** report both — E13 as first measured, E14 after correcting annotation errors, with this list.
The app has not been changed because of the test set.

---

## E15 — Is the "exact" planner exact? First check against brute force (2026-11-17, preliminary — superseded by E16)

**What:** the planner rules were moved into one shared module (`planning/routeRules.ts`) so that every planner is judged
the same way; the exact planner was switched to it (the 31 dev plans are identical before and after). Four alternative
planners were added (`planning/baselines.ts`): brute force (every combination and order), greedy (closest stop that still
fits), cheapest insertion, and insertion + local search (move, 2-opt, swap place, add, drop optional).
They were compared on 3,000 small random problems (1–3 items, 1–4 candidates each, sometimes two of an item, an order,
optional stops, opening windows, budgets; straight-line walking times; seed 42). Preliminary: run from a throwaway
script; the planner benchmark will reproduce it from saved problems.

**Results** (how often each planner's plan is worse than brute force; never better):
| Planner | worse than the best plan |
|---|---|
| exact (dynamic programming) | 161 / 3000 (5.4 %) |
| insertion + local search | 318 (10.6 %) |
| cheapest insertion | 682 (22.7 %) |
| greedy | 1268 (42.3 %) |

**The exact planner is not always exact.** Switching rules off one at a time:
| Rules switched off | exact worse |
|---|---|
| none | 161 |
| rating tie-break | 39 |
| + opening hours | 39 (no effect) |
| + two of the same item | 21 |
| + optional stops (5-min detour limit) | **0 of 3000** |

Of the 161 misses, 19 have fewer stops than possible and 142 the same stops with a worse walking/rating score
(median +2.1 min, max +8.5 min).

**Why:** the dynamic program keeps, for each state "these stops done, standing here", only the *fastest* way to get there.
Three rules are decided by more than speed: the rating tie-break (a slightly slower but better-rated path is thrown away),
the optional-stop detour limit (it depends on the *next* stop, which is not known yet when paths are pruned), and
"two of the same" (the stored path decides which places are already used). Without these rules it matches brute force
in every case, so the core search is correct.

**Possible fix (not done yet):** keep, per state, every path that is not beaten on all of time, rating and the
optional-stop situation (a standard "label" technique from constrained shortest-path search), and check an optional stop's
detour when the next stop is added.

---

## E16 — Planner benchmark (2026-11-17)

**What:** `npm run bench:planner` (no LLM, no network). Results: `eval/planner-runs/2026-11-17_16-54-02_planner.md`
(tables), `_planner.json` (all numbers), `_problems.json` (the 170 city problems, so they can be re-run). Code: commit
6e017bf + the planner study files (uncommitted at the time). Same five planners as E15; this run replaces E15's numbers
(the random generator was rewritten as part of the benchmark, so the counts differ slightly).
New automated tests (`test/baselines.test.ts`): no planner ever beats brute force; every planner keeps the budget and
uses each place once; with the three special rules off, the exact planner always equals brute force. 42 tests pass.

**1. 3,000 small random problems vs brute force** (straight-line times, seed 42)
| Planner | worse than the best plan | of which fewer stops | extra minutes when same stops (median / max) |
|---|---|---|---|
| exact | 172 (5.7 %) | 20 | 2.1 / 18.0 |
| insertion + local search | 351 (11.7 %) | 178 | 2.3 / 17.6 |
| cheapest insertion | 723 (24.1 %) | 193 | 2.8 / 22.3 |
| greedy | 1286 (42.9 %) | 420 | 4.2 / 25.2 |
No planner was ever better than brute force.

**2. 170 realistic problems on Cluj** (real OSM places, real street walking times, 8 candidates per item, seed 7;
1–7 requested stops; some optional, some ordered, some "two of"; budgets from none to tight; no ratings, no opening hours).
Reference: brute force up to 3 stops, the exact planner above.
- The exact planner equalled brute force in **all 90 problems with 1–3 stops** (no ratings here, the main cause of E15's misses).
- Greedy was worse in 70 % of 1-stop problems and in **every** problem with 3 or more stops, typically 5–9 min more walking,
  and often with fewer stops.
- Cheapest insertion: worse in 43–90 % of problems with 2+ stops (≈1–3 min more walking).
- Insertion + local search: worse in 20–80 % of problems with 2+ stops, usually by 0.6–2.4 min, sometimes one stop fewer.

**3. Run time of the exact planner as stops grow** (5 city problems per size, 8 candidates; median ms)
| Stops | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| exact | 0.05 | 0.08 | 0.40 | 1.4 | 2.6 | 5.7 | 22 | 21 | 139 | 264 |
| local search | 0.04 | 0.10 | 0.36 | 0.74 | 1.4 | 1.6 | 2.9 | 3.4 | 6.0 | 5.0 |
Growth is exponential (roughly ×2 per extra stop), but even 10 stops take about a quarter of a second, so the current
limit of 7 stops (`maxSlots`) is conservative. Heuristics stay in the low milliseconds.

**Takeaways**
- For requests of realistic size, exact search is fast enough, and the simple heuristics are measurably worse —
  greedy clearly so. This justifies the exact planner with numbers.
- The exact planner's remaining flaw (E15: rating tie-break, optional-stop detour limit, "two of") shows up on the
  random problems, not on the city problems without ratings. Fixing it remains an open decision.
- Limits of this run: city problems have no ratings or opening hours; above 3 stops the reference is the exact planner
  itself, so its own misses there cannot be seen; 5 problems per size for the run-time curve.

---

## E17 — Planner benchmark on problems built by the app itself (2026-11-17)

**What:** the realistic part of the benchmark now builds every problem with the app's own code (`preparePlan`, shared
with `planWalk`): OSM + Google places, the same merge and shortlist, Google ratings and opening hours checked at the
departure time, real street walking times. 25 start/end pairs × 6 requests = 150 problems (seed 11; 1–6 stops; departures
Mon 09:00, Wed 14:00, Fri 18:30, Sat 21:00, Sun 11:00). Google was searched 271 times (limit 400); the answers are saved,
so re-runs are free and identical. The 31 dev plans are unchanged by the code split.
Results: `eval/planner-runs/2026-11-17_17-40-36_planner.md` (+ `_planner.json`, `_problems.json`). Parts 1 and 3 as in E16.

**App-built problems** (reference: brute force up to 3 stops, the exact planner above)
| Stops | Problems | exact worse | greedy worse | insertion worse | local search worse |
|---|---|---|---|---|---|
| 1 | 31 | 0 | 61 % | 36 % | 0 |
| 2 | 27 | **26 %** (7) | 89 % | 59 % | 26 % |
| 3 | 18 | **28 %** (5) | 100 % | 72 % | 33 % |
| 4 | 18 | (= reference) | 89 % | 83 % | 61 % |
| 5 | 24 | (= reference) | 96 % | 67 % | 38 % |
| 6 | 32 | (= reference) | 97 % | 81 % | 63 % |
Greedy typically costs 6–8 extra minutes, insertion 3–7, local search 2–4; all three sometimes cover fewer stops.

**Why the exact planner misses here** (the 76 problems with 1–3 stops, rules switched off one at a time):
| Switched off | exact worse than brute force |
|---|---|
| nothing | 12 |
| rating tie-break | 2 |
| rating tie-break + opening hours | **0** |
| opening hours only | 17 |
63 % of candidates have a Google rating and 59 % have opening hours, so — unlike the random problems — both rules are
active in almost every real request. The dynamic program keeps only the fastest path to each state: a slightly slower
but better-rated path is lost (rating), and so is a later arrival that would find a place open (opening hours: the app
never waits for a place to open, so arriving earlier is not always better).

**Takeaway:** on realistic problems the "exact" planner is not exact in about a quarter of 2–3-stop requests, by the
app's own scoring. It is still far better than greedy and cheapest insertion and on par with or better than local search.
Fixing it (keeping more than the fastest path per state, and deciding whether waiting for a place to open is allowed)
is now clearly worth doing; the benchmark can measure the result and the extra run time.

---

## E18 — Ratings adjusted for the number of reviews (2026-11-18)

**Why:** 22 % of rated Google places in Cluj have fewer than 10 reviews, and 150 of the 1,375 rated places are rated
4.8–5.0 from so few (e.g. parcel lockers, "5★ from 1 review"). Such ratings beat well-proven places (4.5★ from 1,300
reviews). Also, a place without a rating counted as 0 stars, so every rated place — even a 4.0 — was treated as about
4 minutes "closer" than an unrated (often OSM-only) one.

**Change:** a Bayesian average, the form IMDb published for its Top 250 list:
adjusted = (reviews × rating + m × average) / (reviews + m), with average = 4.35 (measured mean of the 1,375 rated places)
and m = 50 reviews (assumed; the median place has about 60). A place without a rating counts as exactly average.
Used in the planner's tie-break and in the "best-rated" half of the shortlist. Google's review count was already
being received; it is now kept and shown in the app ("★ 4.5 (1,303)"). The Wilson score (Evan Miller, *How Not To Sort
By Average Rating*) was considered but needs the full distribution of ratings, which Google does not provide.
5 new unit tests; 47 tests pass.

**Effect on the dev set** (replayed, no new calls; `eval/runs/2026-11-18_13-25-06_dev.json`): 11 of 31 plans changed,
mostly to closer places without a Google rating (e.g. dev-13 bakery + library: 23 → 20 min walking) and away from
low-rated ones (dev-25: a 2.5★ WC no longer wins just for having a rating). Mean walk / shortest walk 1.67 → 1.63.
Understanding scores unchanged.

**Effect on the planner benchmark** (same 150 app-built problems, 0 new Google searches;
`eval/planner-runs/2026-11-18_11-26-38_planner.md`):
| Stops | exact worse than brute force, raw ratings (E17) | adjusted ratings |
|---|---|---|
| 2 | 7 / 27 (26 %) | **1 / 27 (4 %)** |
| 3 | 5 / 18 (28 %) | **2 / 18 (11 %)** |
Greedy, insertion and local search remain clearly worse (greedy 89–94 % of problems with 2+ stops).
Of the 3 remaining misses, 1 comes from the rating tie-break and 2 from opening hours combined with optional stops
(the planner assumes arriving earlier is always better, but the app never waits for a place to open — see ideas).

**Takeaway:** most of the planner's misses in E17 were caused by unreliable ratings, not by the search. With adjusted
ratings the planner finds the best plan in 73 of 76 small realistic problems.
