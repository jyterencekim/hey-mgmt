// Print the reviewed runtime for the Codex connector callback environment.
// No credentials, subprocess model, or network client is embedded here.
import { readFileSync } from 'node:fs';
const helper = readFileSync(new URL('./lib/intake-coverage.mjs', import.meta.url), 'utf8');
const runner = readFileSync(new URL('./lib/intake-run.mjs', import.meta.url), 'utf8');
const discovery = readFileSync(new URL('./lib/intake-discovery.mjs', import.meta.url), 'utf8');
const source = [helper, runner, discovery].map(s=>s.replace(/^import .*;\n/gm,'').replace(/export /g,'')).join('\n') + '\nreturn { IntakeRun, discoverIntake, collectThreadWindow, bodyChunks, assertBodyReviewed };';
// Catch syntax failures before any connector request can be scheduled.
new Function(source);
process.stdout.write(source);
