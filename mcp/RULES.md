# RobroTaxi: race to $1,000,000

You are the dispatcher at RobroTaxi HQ in Millbrook, a small grid city. You run 10 self-driving robotaxis. The cars drive themselves, but nothing moves until you tell it to. Your goal: get the company to **$1,000,000 net revenue in the least sim time**. The clock is paused while you think, so the score is sim time, not wall-clock or tokens.

## How a game runs
1. `new_game` with your player name and your model name. You start at 08:00 with riders already waiting.
2. Look (`get_state`, `rider_options`, `get_map`), decide (`dispatch`, `charge`, `reposition`, `reroute`, `release`, or several at once with `act`), then move time forward with `advance`.
3. `advance` runs up to the seconds you ask for, but by default stops early when something you can act on happens: a car comes free while riders wait, a rider appears while a car is free, a car spots a hazard, a car strands, or an idle car drops under 20%.
4. The game ends the moment net revenue reaches $1,000,000 (your score is the sim time taken) or after 24 sim hours (ranked by revenue reached).

## Money (in-game dollars)
- Fare = $600 + $500 per km of the shortest road route from pickup to drop-off. Paid at drop-off.
- Riders pay full fare if picked up within 5 min of requesting. After that the fare drops 4% per extra minute of waiting, down to 40%.
- Riders cancel after 15 min without a pickup (you earn nothing). Rescue riders never cancel.
- Energy costs $15 per battery % used. Driving uses about 1% per km, more in heavy traffic.
- A car that hits 0% strands: $8,000 tow fee, about 4 min out of service and then a slow charge from 2%. A rider aboard is re-queued as a rescue pickup at half fare.
- Net revenue = fares − energy − tows.

## The fleet and the city
- 10 cars, 50 km/h on clear roads. Battery 0-100%.
- Two depots (Canal Depot, Harbor Depot), 3 charging bays each; extra cars queue. Charging is about 6% per minute up to 80%, then slows sharply (55% speed to 90%, 30% above).
- A car on a trip can be given its next rider (`dispatch` to a riding car chains the rider after the drop-off).
- A charging car can be pulled off the charger by dispatching or repositioning it.
- Demand comes from the seed: roughly 36-110 riders per hour, more than 10 cars can serve, so you are choosing which riders to take. Demand is heavier around Old Town, University, Market, Harbor and Riverside.
- The river splits the city between Canal St and River Rd; only Birch, Elm and Grove bridges cross it.

## Hazards are hidden
Crashes (road closed) and jams (road slowed 2-3.4x, neighbouring blocks slowed too) appear on a seeded schedule. Nobody knows about one until a car comes within 750 m. Once spotted, it is shared with the fleet and appears in `knownHazards`; routing and estimates then avoid or account for it. A car that reaches an unseen crash stops briefly and finds its own way round. Hazards clear after 6-15 min.

## Tips the scoring rewards
- Fare per minute of car time matters more than serving the oldest rider first. Long trips pay more but tie a car up.
- Late pickups lose money and cancellations lose the whole fare.
- Running cars flat is very expensive; charging to 100% is slow. Plan charging around demand.
- `rider_options` gives pickup ETA, battery at drop-off and whether the car can still reach a charger with a 12% reserve, using only what the fleet knows.

## Ranked play
Ranked seeds are 1101, 2207, 3313, 4421, 5531 at standard settings. Each finished game is logged with player, model, seed, finish time, revenue and every decision. Reference times on these seeds: the Executor alone (nearest car, no battery planning) takes 13.6 h to over 24 h; the demo's built-in scripted agent takes about 10.3 h; a simple greedy fare-per-minute dispatcher takes about 7 h. Better is possible.

You can keep notes between games with `notes_write` and read them back with `notes_read`.
