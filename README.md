# Emberline Yard — a three.js tactical FPS

A round-based tactical FPS in the style Counter-Strike made famous, built on
three.js 0.187.0 as plain static files. No build step, no network: open
`game/index.html` in desktop Chrome and play single-player against bots.

## The game

You are the fourth attacker against four defenders, with three bot teammates.
A round is buy (15 s) → live (100 s) → end, and the first team to 5 rounds
wins the match. Plant the bomb at Site A or Site B and defend it until it
detonates, or eliminate the defenders.

- **Money and buys:** win $3250, lose $1900, kill $300, plant $300. Press B
  in the buy phase for the AR-7 rifle ($2500), VX-9 SMG ($1500), L-88 sniper
  ($4000) or a frag grenade ($300).
- **Gunplay:** hitscan with headshot damage, recoil and spread that punish
  firing on the move, bloom on sustained fire, crouching, acceleration and
  collision with the map.
- **Bots:** attackers push the lanes on waypoint routes; defenders hold the
  sites, rotate to a planted bomb, and shoot back with reaction time and
  burst fire. They see by range, angle and line of sight, and they turn
  toward whoever shoots them.
- **Objective:** hold E inside a site to plant (3 s), hold E beside a planted
  bomb to defuse (5 s). A planted bomb detonates after 35 s.
- **Map:** Emberline Yard — an original industrial yard with three lanes
  (A-long, Mid, B-long), two walled bomb sites, and crouch-height cover.

## Play

Serve `game/` with any static server and open it, or run `node serve.ts`
and open http://localhost:8080. Click to play.

Keys: WASD move, mouse look, click fire, R reload, Ctrl crouch, Space jump,
B buy menu, E plant/defuse (hold), G throw grenade, 1/2/3 switch weapon,
right-click zoom (sniper).

## Entry

Built for the make.fun threejs-fps-01 bounty. `main.ts` copies `game/` and
`screenshots/` to `/output` and writes `/output/dossier.json`.

[![make.fun](https://make.fun/badge/owner/wdj5813962-code/repo/emberline-yard-2?ref=vx2eyc9v)](https://make.fun/bounty/threejs-fps-01)
