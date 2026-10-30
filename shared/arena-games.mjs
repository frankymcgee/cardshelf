/** Game identity and format limits, shared by the lobby and server dispatch. */
export const ARENA_GAMES = Object.freeze([
  Object.freeze({ code:'pokemon', name:'Pokémon', version:'pokemon-expanded-v5', format:'Automated Casual Expanded', min:60, max:60, copies:4,
    kinds:['pokemon','trainer','energy'], rules:'60 cards · at least one Basic Pokémon · four of each name, except Basic Energy.',
    coverage:'Supported Pokémon, Trainers and Energy. The workshop checks every effect.' }),
  Object.freeze({ code:'yugioh', name:'Yu-Gi-Oh!', version:'yugioh-casual-v1', format:'Automated Casual Duel', min:40, max:60, copies:3,
    kinds:['monster','spell'], rules:'40–60 Main Deck cards · three of each name · no Extra Deck or Side Deck in this format.',
    coverage:'Normal Monsters, tribute summons, sets, battle positions and selected Normal Spells. Effect Monsters, Traps and Extra Deck mechanics are not yet supported. The tournament Forbidden/Limited list is not applied.' }),
  Object.freeze({ code:'mtg', name:'Magic: The Gathering', version:'mtg-casual-v1', format:'Automated Casual 60', min:60, max:60, copies:4,
    kinds:['land','creature','instant','sorcery'], rules:'This casual format uses exactly 60 cards · four of each name, except basic lands · no sideboard.',
    coverage:'Basic lands, vanilla creatures, flying, reach, haste, vigilance, defender and selected instants/sorceries. Other abilities, nonbasic lands and multi-face cards are not yet supported. Format ban lists are not applied.' })
]);
export const arenaGame = code => ARENA_GAMES.find(game=>game.code===code) || null;
export const arenaGameForVersion = version => ARENA_GAMES.find(game=>game.version===version)?.code || (/^pokemon-(?:core|expanded)-v[1-5]$/.test(version||'')?'pokemon':null);
export const arenaVersionForGame = code => arenaGame(code)?.version;
