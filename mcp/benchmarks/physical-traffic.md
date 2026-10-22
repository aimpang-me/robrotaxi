# Physical traffic balance check

All 20 final reference replays preserve the pre-change dispatcher order on every ranked seed: **greedy, scripted, executor, lazy** (best first). Completed runs rank by sim time to $1M; unfinished runs rank by net revenue at 24 hours. These are simulated game results, not real traffic measurements.

## Final replay

| Dispatcher | 1101 | 2207 | 3313 | 4421 | 5531 |
|---|---|---|---|---|---|
| executor | 19.99 h | DNF $967k | DNF $942k | 23.45 h | 17.87 h |
| scripted | 13.69 h | 14.14 h | 13.62 h | 14.14 h | 13.90 h |
| lazy | 21.97 h | DNF $806k | DNF $771k | DNF $898k | 19.37 h |
| greedy | 11.86 h | 11.31 h | 11.13 h | 11.32 h | 13.06 h |

## Before physical traffic

| Dispatcher | 1101 | 2207 | 3313 | 4421 | 5531 |
|---|---|---|---|---|---|
| executor | 19.66 h | DNF $990k | DNF $944k | 23.18 h | 17.89 h |
| scripted | 14.08 h | 13.87 h | 13.83 h | 14.28 h | 13.88 h |
| lazy | 22.10 h | DNF $820k | DNF $776k | DNF $904k | 20.26 h |
| greedy | 11.74 h | 11.39 h | 10.98 h | 11.41 h | 13.02 h |

The baseline is revision 9296f524. Its original console output rounds hours to 0.01 and unfinished revenue to $1000. An exact route-tree cache preload completed the slow scripted baseline; it did not change simulation or dispatch policy, and all five executor scores matched the uncached replay. The final routing cache is checked against uncached road trees after public load, sensed closure and clearance changes.

## Reproduce

From mcp/:

```sh
node bench.js
node check-bench.js benchmarks/physical-traffic-before.json benchmarks/route-commitment-after.json
node check-bench.js benchmarks/physical-traffic-after.json benchmarks/route-commitment-after.json
```

The saved JSON files retain the scores used by the order check. The final replay includes the committed-road estimate and interruption fixes in commit 171739e. Its generated-core SHA256 is `5186ea6071969600d84516445b4f717a55a00170d5f7faba8232bd15c555cc70`. The earlier traffic-only replay remains in physical-traffic-after.json. Worker concurrency changes wall-clock runtime only. To capture a fresh replay set ROBRO_BENCH_OUTPUT to a JSON path; ROBRO_BENCH_JOBS controls bounded independent workers.

## Scope and checks

- 240 seeded ambient vehicles and taxis share directed-lane gaps and unsignalized junction reservations. Ambient routes circulate on through streets; taxis retain access to terminal streets. This avoids destination-free bus tours through short dead ends and is not a general gridlock solver.
- 21 physical fixtures cover following, parking admission, blocked departures, occupied exits, tiny connectors, turnaround clearance, circulation, legal routes, hidden hazards, clone isolation and deterministic tick batching.
- Route commitment checks cover pickup and charger estimates, battery reserve, release, cancellation and stranded occupancy. An independent sweep checked 220 route positions and 18 dispatch estimates against assigned routes.
- Real server pacing checks preserve the full authoritative snapshot across pause and playback speeds. Viewer checks cover authoritative movement and repeated-edge interpolation. Both page simulations match; the extracted core rebuild is verified.
- MCP-only integration (scripted test stub, no LLM): 702.5 sim minutes, 598 trips, 145 cancellations, zero stranded; 2186 tool calls.
- Shoreline tests cover mainland, harbour slips, Don River, mapped pond islets, source-linked import fixes and browser map parity. All 18,204 retained building centroids have land and none is covered by water fill. Island House's full packed footprint stays dry. The map retains metre-scale footprint and shore simplification; one inherited Heaslip House corner overlaps the Devonian Pond outline by about 1.66 m.

No dispatcher policy, fare, charging rate, demand multiplier or hazard schedule was tuned to restore ordering. No dependencies were added.
