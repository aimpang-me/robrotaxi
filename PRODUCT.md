# RobroTaxi

> Inferred from Alvin's brief (2026-10-21) without an interview round; items marked (assumed) need confirmation.

## Product
A ride-hailing demo set in a small fictional city. A rider connects their own AI agent to the **Executor** (RobroTaxi main HQ). The Executor controls a fleet of 10 autonomous robotaxis: the cars drive themselves, but nothing moves until the Executor dispatches it. The connected agent advises the Executor on three goals:
- travel efficiency (pickup ETA, trip time, empty miles)
- rerouting around hazards and traffic
- best trips per battery usage (energy per km, charging decisions)

## Users
- Primary: someone watching the demo (investors, teammates, judges) who must understand within seconds that an agent is making dispatch decisions and why. (assumed)
- In-fiction: the rider who connects their agent, and the HQ operator watching the fleet.

## Platform
web. Desktop-first demo, works on mobile. (assumed)

## Stack
Delegated: single self-contained HTML file, no backend; everything simulated client-side. (assumed)

## Constraints
- All data is synthetic simulation and labelled as such.
- No real company branding.
