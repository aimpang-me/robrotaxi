You are going to play RobroTaxi, a dispatch game, as the dispatcher. You run 10 robotaxis in a small city. Goal: reach $1,000,000 net revenue in the least sim time. The sim clock is paused while you think, so take the time to decide well. Score is sim hours to $1M (lower is better); the game ends at $1M or after 24 sim hours.

Server: https://robrotaxi-hq.aimpang.workers.dev/mcp (MCP, Streamable HTTP).

## Connect
If you can add a remote MCP server natively, add that URL and use its tools directly. Otherwise use the shell client in the repo:

    cd C:\Users\PC-AIMPANG\robrotaxi
    git pull
    cd mcp
    node play-cli.js tools

Every tool is then `node play-cli.js <tool> '<json args>'`. On Windows PowerShell, JSON quoting is painful, so write the arguments to a file and pass it with @, e.g. write turn.json then run `node play-cli.js act @turn.json`. The client keeps the session in .robro-session in the current folder, so always run it from the same folder. Do not delete that file mid-game.

## Play
1. `node play-cli.js get_rules` and read all of it. Then `node play-cli.js notes_read '{"player":"Alvin"}'` for lessons from earlier games.
2. `node play-cli.js new_game '{"player":"Alvin","model":"<your exact model name and version>"}'`. Leave out seed so it plays a ranked seed. Send me the "Watch live in 3D" link it prints right away.
3. Loop until the game says FINISHED or out of time:
   - Read the state (`get_state`; it is also returned after every act).
   - Decide every useful move at once and send them in one `act` call with `advance_seconds` (60 to 300 is typical; it stops early when something needs you). Give every action a short "reason".
   - Use `rider_options '{"rider":"R-123"}'` when a pickup choice is close, and `get_map` once if you want the road graph.
4. Things that matter: idle cars earn nothing, so keep every car with a battery margin busy. Fares drop after 5 min of waiting and riders cancel at 15 min, so serve the long and old fares first. Charge before cars get low (a tow costs $8,000) and spread charging across both depots. Reroute around hazards you learn about.
5. Do not stop early or ask me questions mid-game; play it to the end. If a call fails with a rate limit, wait a second and retry. If you get "No game yet" mid-game, the session expired, so tell me rather than starting over silently.
6. At the end: `get_score`, then `notes_write` with 5 to 10 lines of what worked and what didn't for next time (player "Alvin").

## Report back
Your model name, the seed, finish time in sim hours (or revenue reached if out of time), trips, cancellations, tows, how you compare to the Executor-alone line in get_score, the watch link, and your top three lessons.
