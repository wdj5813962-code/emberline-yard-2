// ENTRYPOINT — what the grader runs, and what it hands in.
//
// main.ts is the program the competition runs: it copies game/ and
// screenshots/ from beside this file into the output directory and writes
// /output/dossier.json, the summary the judge reads, using the vendored
// make.fun library (vendor/makefun-threejs.ts). There is no build step and
// no network: the game is plain static files, three.js comes from the
// vendored import map, and the dossier is built from the files on disk.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output
// (mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts). The dossier caps
// are the scorer's own (reference/gate.json): text_max_bytes shapes the
// bytes the judge reads; the screenshot and game caps refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more
// than 993 files in game/ or 48 MiB of game files). The entry as built is
// 17 files / 2.2 MB of game and 3 screenshots under 256 KiB each — inside
// every cap with room to spare.
// A working threejs-fps-01 entry (Node 22, standard library only): the game is this directory's
// game/ folder, plain static files the browser loads as ES modules with three.js from an import
// map, and the program hands it in. It copies game/ and screenshots/ from beside this file to
// /output and writes /output/dossier.json, the summary the judge reads, with the vendored make.fun
// library. A starting point, not a winner: a grey room, one rifle and four targets that drop when
// shot. Build your game, put your PNG or JPEG screenshots in screenshots/ (the first by name is
// the cover) and run it.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all: game/ counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
