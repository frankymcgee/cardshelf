#!/usr/bin/env node
/** Isolated development probe. Executes a trusted local upstream checkout;
 * never mounts it into CardShelf's production match dispatcher. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {compileArenaCard} from '../lib/arena/cards.mjs';
import {applyArenaAction, arenaView, assertArena} from '../lib/arena/engine.mjs';
import {readyFixture} from '../tests/helpers/arena-fixtures.mjs';

export function probeCardShelfContinuation() {
  const rows = JSON.parse(fs.readFileSync(new URL('../tests/helpers/arena-real-cards-v5.json', import.meta.url)));
  const compiled = compileArenaCard(rows.find(row => row.id === 'en:sv06-129'));
  if (!compiled.supported) throw Error(compiled.reason);
  let state = readyFixture();
  state.players[0].active.card = compiled.card;
  const top = state.players[0].deck.slice(0, 2).map(card => ({id: card.id, card: card.card.id}));
  state = applyArenaAction(state, 0, {type: 'ability', card: state.players[0].active.id, index: 0});
  const savedPrompt = arenaView(state, 0).prompt;
  const privatePrompt = arenaView(state, 1).prompt === null;
  state = JSON.parse(JSON.stringify(state));
  const samePrompt = JSON.stringify(savedPrompt) === JSON.stringify(arenaView(state, 0).prompt);
  state = applyArenaAction(state, 0, {type: 'choose', choices: [top[0].id]});
  assertArena(state);
  return {scenario: 'Recon Directive after JSON reload', same_prompt_after_reload: samePrompt,
    choice_hidden_from_opponent: privatePrompt,
    selected_card_in_hand: state.players[0].hand.some(card => card.card.id === top[0].card),
    remainder_on_deck_bottom: state.players[0].deck.at(-1).card.id === top[1].card,
    continuation_complete: state.pending === null};
}

export async function probeEngine(root, candidate) {
  root = fs.realpathSync(root);
  const twinleaf = candidate === 'twinleaf';
  if (!twinleaf && candidate !== 'ryuu') throw Error('Choose ryuu or twinleaf.');
  const base = twinleaf ? 'ptcg-server/src/game' : 'packages/common/src';
  const file = suffix => path.join(root, base, suffix);
  const exports = {
    Store: file('store/store.ts'), ConfirmPrompt: file('store/prompts/confirm-prompt.ts'),
    ResolvePromptAction: file('store/actions/resolve-prompt-action.ts'),
    StateSerializer: file('serializer/state-serializer.ts'),
  };
  const modern = twinleaf ? {
    Charizardex: path.join(root, 'ptcg-server/src/sets/10-scarlet-and-violet/set-obsidian-flames/charizard-ex.ts'),
    Dragapultex: path.join(root, 'ptcg-server/src/sets/10-scarlet-and-violet/set-twilight-masquerade/dragapult-ex.ts'),
    Player: file('store/state/player.ts'), AttackEffect: file('store/effects/game-effects.ts'),
    CardList: file('store/state/card-list.ts'),
    PokemonCardList: file('store/state/pokemon-card-list.ts'),
    PlayerType: file('store/actions/play-card-action.ts'), SlotType: file('store/actions/play-card-action.ts'),
  } : {};
  const source = Object.entries({...exports, ...modern}).map(([name, target]) =>
    `export {${name}} from ${JSON.stringify(target)};`).join('\n');
  const bundle = await build({stdin: {contents: source, resolveDir: root, loader: 'ts'},
    bundle: true, platform: 'node', format: 'cjs', target: 'node24', write: false,
    packages: 'external', logLevel: 'silent', treeShaking: true});
  const module = {exports: {}};
  const execute = vm.runInThisContext(`(function(module,exports,require,__filename,__dirname){\n${bundle.outputFiles[0].text}\n})`,
    {filename: 'arena-engine-compatibility.cjs'});
  const upstreamRequire = createRequire(path.join(root, 'package.json'));
  const probeRequire = createRequire(import.meta.url);
  const requireDependency = name => {
    if (name === '@progress/pako-esm') return probeRequire(name);
    return upstreamRequire(name);
  };
  execute(module, module.exports, requireDependency,
    path.join(root, 'arena-engine-compatibility.cjs'), root);
  const api = module.exports;
  const handler = {onStateChange() {}};
  const live = new api.Store(handler), restored = new api.Store(handler);
  // Probe the upstream prompt reducer directly to isolate continuation storage
  // from battle setup, authorization and unrelated end-of-action state checks.
  live.prompt(live.state, new api.ConfirmPrompt(0, 'compatibility-probe'), answer => {
    live.state.compatibility_answer = answer;
  });
  const serializer = new api.StateSerializer();
  const saved = serializer.serialize(live.state);
  restored.state = serializer.deserialize(saved);
  const id = live.state.prompts[0].id;
  live.reducePrompt(live.state, new api.ResolvePromptAction(id, true));
  let reloadError = null;
  try { restored.reducePrompt(restored.state, new api.ResolvePromptAction(id, true)); }
  catch (error) { reloadError = String(error.message); }
  const result = {
    candidate, revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    probe_scope: 'Actual upstream Store prompt/reducer and native StateSerializer; isolated from battle setup. This is not a full game or security certification.',
    live_prompt_continues: live.state.compatibility_answer === true,
    native_state_restores_prompt: restored.state.prompts.length === 1,
    restored_prompt_continues: restored.state.compatibility_answer === true,
    restored_prompt_error: reloadError,
    modern_scenarios: [],
    cardshelf_control: probeCardShelfContinuation(),
  };
  if (twinleaf) {
    const player = new api.Player(), opponent = new api.Player();
    player.id = 1; opponent.id = 2;
    const zard = new api.Charizardex(), dragapult = new api.Dragapultex();
    player.active.cards.push(zard);
    opponent.active.cards.push(dragapult);
    opponent.prizes = Array.from({length: 4}, () => {
      const list = new api.CardList(); list.cards.push(new api.Dragapultex()); return list;
    });
    const store = new api.Store(handler);
    store.state.players = [player, opponent];
    const effect = new api.AttackEffect(player, opponent, zard.attacks[0]);
    zard.reduceEffect(store, store.state, effect);
    result.modern_scenarios.push({scenario: 'Burning Darkness with two opposing Prizes taken, before Weakness',
      expected_damage: 240, actual_damage: effect.damage, pass: effect.damage === 240});
    player.active.cards = [dragapult];
    const bench = new api.PokemonCardList(); bench.cards.push(new api.Charizardex());
    opponent.bench.push(bench);
    const dive = new api.AttackEffect(player, opponent, dragapult.attacks[1]);
    dragapult.reduceEffect(store, store.state, dive);
    const prompt = store.state.prompts.at(-1);
    const valid = [{target: {player: api.PlayerType.TOP_PLAYER, slot: api.SlotType.BENCH, index: 0}, damage: 60}];
    const invalid = [{target: {player: api.PlayerType.TOP_PLAYER, slot: api.SlotType.ACTIVE, index: 0}, damage: 60}];
    const acceptsBench = prompt.validate(valid, store.state);
    const rejectsActive = !prompt.validate(invalid, store.state);
    store.reducePrompt(store.state, new api.ResolvePromptAction(prompt.id, valid));
    result.modern_scenarios.push({scenario: 'Phantom Dive six counters to a Benched Tera Pokemon',
      expected_counters_damage: 60, actual_counters_damage: bench.damage,
      accepts_bench: acceptsBench, rejects_active: rejectsActive,
      pass: acceptsBench && rejectsActive && bench.damage === 60,
      note: 'Actual card reducer, prompt validation and counter effect; complete attack timing and client privacy are outside this isolated probe.'});
  } else {
    result.modern_scenarios.push({scenario: 'Charizard ex / Dragapult ex target profiles',
      note: 'No matching modern target files in the inspected upstream sets; not a substitute for the current pool.'});
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [candidate, root, output, ...extra] = process.argv.slice(2);
    if (!root || extra.length) throw Error('Usage: node scripts/probe-arena-engine.mjs ryuu|twinleaf checkout [report.json]');
    const result = await probeEngine(root, candidate);
    const json = JSON.stringify(result, null, 2) + '\n';
    if (output) fs.writeFileSync(output, json);
    console.log(json);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
