# Evaluation sets

Two files, same format:

| File        | Used for                                      | Rule                                                                                                                                                                                |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev.json`  | developing: look at failures, improve the app | anything goes                                                                                                                                                                       |
| `test.json` | measuring only                                | **do not tune the app on these sentences.** Look at the scores, not at individual failures. If you ever do fix something because of a test case, write it in `docs/experiments.md`. |

Run them with `npm run eval -- --set dev` (or `--set test`) in `server/`. Every run is saved in `eval/runs/`.

## Format

Each file is a JSON array of cases:

```jsonc
[
  {
    "id": "dev-01", // unique; "dev-.." or "test-.."
    "request": "I'd like to see a museum and then have lunch somewhere, streets without much traffic if possible",
    "origin": "Piața Unirii, Cluj-Napoca", // anything Google can find, or { "lat": 46.77, "lng": 23.59 }
    "destination": "Parcul Central, Cluj-Napoca",
    "budgetMinutes": 120, // or null for no time limit
    "departAt": "2026-11-20T11:00:00+02:00", // date and time of the walk (matters for opening hours)
    "expected": {
      "items": [
        {
          "what": "museum", // your own short name, only for reading the results
          "tags": ["tourism=museum"], // OSM tags that would be a correct kind of place; ANY one matching counts
          "required": true, // false = the sentence makes it optional
          "order": 1, // its position if the sentence gives a sequence, else null
          "count": 1, // how many places of this kind
          "pace": "normal", // "quick" | "normal" | "long" — from the words, not from the kind of place
          "wish": null, // extra quality asked for ("catholic", "with a terrace"), else null
        },
        {
          "what": "lunch",
          "tags": ["amenity=restaurant", "amenity=fast_food", "amenity=cafe"],
          "required": true,
          "order": 2,
          "count": 1,
          "pace": "normal",
          "wish": null,
        },
      ],
      "street": [{ "property": "quiet", "mode": "prefer" }], // street preferences from the menu below; [] if none
      "unsupported": [], // street wishes the app cannot do (not on the menu), e.g. ["shade"]; [] if none
    },
    "notes": "sequence + a street preference", // optional: what this case is testing
  },
]
```

Any field inside an item can be left out; a missing field is simply not checked. Use this when the sentence is genuinely ambiguous (e.g. leave out `pace` if you are not sure yourself).

### Street preference menu

Chosen from how often each property is mapped (see `docs/street-tags-world.md` and `docs/street-tags-cluj-napoca.md`).

| property | means | mode |
|---|---|---|
| `lit` | well-lit streets | `"prefer"`, or `"require"` if the person cannot do without it |
| `paved` | paved, smooth paths (no gravel, dirt or broken surface) | same |
| `no_steps` | no stairs | same |
| `quiet` | little traffic, away from main roads | same |
| `sidewalk` | streets with sidewalks (or car-free paths) | same |

Anything else about the streets (shady, flat, scenic, safe neighbourhood, wheelchair-accessible streets…) belongs in `unsupported`.

### Finding OSM tags

Look the kind of place up on the OSM wiki (search "OSM wiki" + the place, e.g. _Tag:amenity=cafe_) or in the openstreetmap.org editor: select a place of that kind and look at its tags. List every tag that would be an acceptable answer (a coffee could be `amenity=cafe` or `shop=coffee`).

## How to write the sentences

**Write the expected answer before you run the app on the sentence.** Never adjust an expected answer to what the app returned, unless your expected answer was a mistake (and then note it).

Sizes: about **30 dev** and **40–50 test** cases.

### Mix (roughly, for each set)

- **Simple** (1 place): "a pharmacy on the way" — ~15%
- **Several places**, no order — ~15%
- **Order** ("first … then …") — ~10%
- **Optional** ("if there's one", "maybe") — ~10%
- **Counts** ("two bookshops", "a few viewpoints") — ~5%
- **Pace** ("a quick …", "spend some time at …", "an hour at …") — ~10%
- **Wishes** the map can know (religion, cuisine, outdoor seating, wheelchair access) and ones it can't ("cosy", "famous", "modern") — ~10%
- **Needs instead of places** ("somewhere to sit", "I need cash", "my kid needs a toilet") — ~10%
- **Street preferences**: each menu item at least twice, some "require" — ~10%
- **Hard cases**: typos, informal writing, long rambling requests, a street wish not on the menu, something that probably doesn't exist in Cluj, a request with no places at all ("just a well-lit walk home") — ~10%

Also vary:

- **Start/end**: different neighbourhoods (centre, Mărăști, Mănăștur, Gheorgheni, Zorilor, Grigorescu…), short and long walks, start = end (a loop).
- **Time budget**: generous, tight, and none.
- **Time of day/week**: daytime, evening, Sunday, late night (opening hours matter).

### Words to avoid

These words appear as examples in the app's instructions to the model, so a test using them would test the examples, not the method. Don't build sentences around them:

_gothic cathedral, second-hand bookshop, halal butcher, with a garden, charge my phone, something sweet, an hour at the museum, no stairs at all, shady, flat, scenic_ (as street wishes), _grab, pop in, to go, spend time, explore, linger, relax_. (Very common words such as "quick" or "maybe" are fine.)

Similar meanings in other words are fine and are exactly what should be tested ("I'm pushing a buggy", "somewhere to top up my phone battery").

## Results

`npm run eval:check -- --set dev` only checks the file (format, unique ids, `key=value` tags, street properties on the menu) and calls no API. `npm run eval -- --set dev` runs every valid case: the sentence goes through understanding and the result goes straight to the planner, with no human edits. `--replay` uses only saved API answers (a missing one is an error for that case), `--only dev-03,dev-07` runs some cases. A bad case is reported (id + field) and skipped. Each run is saved in `eval/runs/` with the git commit (and whether the code had uncommitted changes), the models, all parameters and every case's output; keep these files in git, they are the evidence for the thesis. Every number is printed with its count (`5/6`, `n=4`); "n/a" means there was nothing to count.

**Understanding** (cases where understanding failed are left out and counted separately; counts are summed over all cases before dividing):

- **Item matching.** An app item matches an expected item when one of its OSM kinds has one of the expected tags (a more specific kind also counts: a "Christian place of worship" matches `amenity=place_of_worship`; a generic kind like "Shop" = `shop=*` does not match `shop=bakery`). Each item is used at most once; the pairing with the most matches is chosen, ties going to exact tags and then to sentence order. Google types are not used.
- **Item precision**: of the items the app produced, how many match an expected item. Low = the app invents or splits items.
- **Item recall**: of the expected items, how many the app found. Low = the app misses or merges items. **F1** combines the two.
- **Kinds**: of the OSM kinds the app chose for matched items, how many fit an expected tag. An item already matches on one good kind, so this shows extra, wrong kinds (e.g. "cafe" added to "something to eat" when only restaurants were expected).
- **required / count / pace**: for matched items whose expected item states the field, how often the app's value is the same. A `count` of null is read as 1 (the app's default).
- **order**: for matched items whose expected item states it: expected null needs app null; expected a number needs an app number that puts the item before/with/after every other ordered matched item the same way as expected (relative order, so 2,3 is as good as 1,2).
- **wish**: for matched items whose expected item states it: expected null needs empty app details, expected a wish needs non-empty details. It does not judge the wording; the pairs are printed so you can read them.
- **Street precision / recall**: over (property, mode) pairs, e.g. `lit/prefer`; precision = app preferences that were expected, recall = expected preferences the app found. Also given on the property alone, ignoring prefer/require.
- **Unsupported street wish**: share of cases where "the app reported an unsupported street wish" agrees with "expected `unsupported` is not empty". The wording is not compared.

**Planning** (no correct plans are written by hand; these are facts about the plans made from the app's own understanding):

- **Plan success**: share of understood cases that got a plan without error (e.g. a start that cannot be found is an error).
- **All understood required placed**: share of cases where every required expected item that the app understood got at least one stop. Items the app did not understand are not blamed on the planner. Cases with no such item are left out.
- **Within budget**: share of cases with a time budget whose walking plus stays fit in it.
- **Walk / shortest walk**: planned walking minutes divided by the plain shortest walk from start to end; how much the stops and street preferences cost in walking. Loops (start = end) are left out.
- **Stops per plan** and **skipped items** by reason (`no_candidates`, `no_match`, `unreachable`, `over_budget`, `optional_too_far`, `closed`).
- **Street coverage**: for each street property the app asked for, the mean share of the route that is good / bad / unknown on the map, over the plans that asked for it.
- **Times**: understanding and planning time per case (mean, median, max). They include API waiting only for answers that were not already saved, so compare times between runs with the same cache state.
