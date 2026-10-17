/** Whole-text V5 profiles. A successful profile consumes every clause; unknown
 * remainders reject the card. Programs are data, never provider-supplied code. */
const n = value => ({a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7}[String(value).toLowerCase()] ?? Number(value));
const types='Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless';
const positive=value=>{const x=n(value);if(!Number.isInteger(x)||x<1||x>60)throw Error('Effect count exceeds the reviewed bounds.');return x;};
const damage=value=>{const x=Number(value);if(!Number.isInteger(x)||x<10||x>1000||x%10)throw Error('Invalid damage amount.');return x;};
const program=value=>({kind:'program',program:value});
export function advancedAttack(attack,original,base) {
  let rest=original,effects=[],formula=false,m;
  const printed=String(attack.damage??'').replace('×','x');
  // Base values with a printed formula must be paired with exactly one formula.
  const atom=(re,build)=>{const match=rest.match(re);if(!match)return false;effects.push(build(match));rest=rest.slice(match[0].length).trim();return true;};
  const temp=(kind,values={})=>program({kind:'temporary',effect:{kind,...values}});
  while(rest){
    const consumed=
      atom(/^Flip (?:a|1) coin\. If (?:it is |it's )?heads, (?:your opponent's Active Pokemon|the Defending Pokemon) is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\.(?: |$)/i,m=>({kind:'coin_condition',condition:m[1].toLowerCase()}))||
      atom(/^Flip (?:a|1) coin\. If (?:it is |it's )?tails, this attack does nothing\.(?: |$)/i,()=>({kind:'coin_gate'}))||
      atom(/^Flip (?:a|1) coin\. If (?:it is |it's )?heads, this attack does (\d+) more damage\.(?: |$)/i,m=>{formula=true;return {kind:'coin_bonus',amount:damage(m[1])};})||
      atom(/^Flip (\d+|two|three|four) coins?\. This attack does (\d+) damage (?:times|for) (?:the number of |each )heads\.(?: |$)/i,m=>{formula=true;return {kind:'coin_damage',coins:positive(m[1]),per:damage(m[2])};})||
      atom(/^Flip a coin until you get tails\. This attack does (\d+) (more )?damage for each heads\.(?: |$)/i,m=>{formula=true;return {kind:'coin_until_tails',amount:damage(m[1]),add:!!m[2]};})||
      atom(/^This attack does (\d+) (more )?damage for each (Prize card your opponent has taken|of your Benched Pokemon|of your opponent's Benched Pokemon|Benched Pokemon \(both yours and your opponent's\)|damage counter on this Pokemon|damage counter on your opponent's Active Pokemon|Energy attached to this Pokemon|Energy attached to your opponent's Active Pokemon|Energy attached to both Active Pokemon)\.(?: |$)/i,m=>{formula=true;return {kind:'formula',amount:damage(m[1]),add:!!m[2],metric:({'Prize card your opponent has taken':'opponent_prizes_taken','of your Benched Pokemon':'own_bench',"of your opponent's Benched Pokemon":'opponent_bench','Benched Pokemon (both yours and your opponent\'s)':'both_bench','damage counter on this Pokemon':'own_counters',"damage counter on your opponent's Active Pokemon":'opponent_counters','Energy attached to this Pokemon':'own_energy',"Energy attached to your opponent's Active Pokemon":'opponent_energy','Energy attached to both Active Pokemon':'both_energy'})[m[3]]};})||
      atom(/^This attack does (\d+) less damage for each damage counter on this Pokemon\.(?: |$)/i,m=>{formula=true;return {kind:'formula',amount:-damage(m[1]),add:true,metric:'own_counters'};})||
      atom(/^If (your opponent's Active Pokemon already has any damage counters on it|this Pokemon has any damage counters on it|your opponent's Active Pokemon is affected by a Special Condition|your opponent's Active Pokemon is a Pokemon ex or Pokemon V), this attack does (\d+) more damage\.(?: |$)/i,m=>{formula=true;return {kind:'conditional_bonus',condition:({'your opponent\'s Active Pokemon already has any damage counters on it':'opponent_damaged','this Pokemon has any damage counters on it':'own_damaged',"your opponent's Active Pokemon is affected by a Special Condition":'opponent_condition',"your opponent's Active Pokemon is a Pokemon ex or Pokemon V":'opponent_ex_v'})[m[1]],amount:damage(m[2])};})||
      atom(/^During your next turn, this Pokemon can't (attack|use attacks|use this attack)\.(?: |$)/i,m=>temp('attack_lock',{scope:'self',turns:2,...(m[1].toLowerCase()==='use this attack'?{attack:attack.name}:{})}))||
      atom(/^(?:The Defending Pokemon can't retreat during your opponent's next turn|During your opponent's next turn, the Defending Pokemon can't retreat)\.(?: |$)/i,()=>temp('retreat_lock',{scope:'defender',turns:1}))||
      atom(/^During your opponent's next turn, (?:they|your opponent) can't play any (Item|Supporter|Stadium) cards from their hand\.(?: |$)/i,m=>temp('trainer_lock',{scope:'opponent',trainerType:m[1],turns:1}))||
      atom(/^During your opponent's next turn, this Pokemon takes (\d+) less damage from attacks \(after applying Weakness and Resistance\)\.(?: |$)/i,m=>temp('reduce_damage',{scope:'self',amount:damage(m[1]),turns:1}))||
      atom(/^(Flip a coin\. If heads, during|During) your opponent's next turn, prevent all damage (from and effects of attacks done to this Pokemon|done to this Pokemon by attacks(?: from Basic Pokemon)?)\.(?: |$)/i,m=>({...temp('prevent_damage',{scope:'self',turns:1,effects:m[2].startsWith('from'),...(m[2].endsWith('Basic Pokemon')?{attacker:'basic'}:{})}),...(m[1].startsWith('Flip')?{coin:true}:{})}))||
      atom(/^This attack's damage isn't affected by (Resistance|Weakness or Resistance|any effects on your opponent's Active Pokemon|Weakness or Resistance, or by any effects on your opponent's Active Pokemon)\.(?: |$)/i,m=>({kind:'damage_flags',ignoreResistance:/Resistance/.test(m[1]),ignoreWeakness:/Weakness/.test(m[1]),ignoreDefender:/effects/.test(m[1])}))||
      atom(/^(You may )?[Ss]witch this Pokemon with (?:1|one) of your Benched Pokemon\.(?: |$)/,m=>program({kind:'switch',ask:!!m[1]}))||
      atom(/^Switch out your opponent's Active Pokemon to the Bench\. \(Your opponent chooses the new Active Pokemon\.\)(?: |$)/i,()=>program({kind:'force_switch'}))||
      atom(/^Switch in 1 of your opponent's Benched Pokemon to the Active Spot\.(?: |$)/i,()=>program({kind:'gust'}))||
      atom(/^Put (\d+) damage counters on your opponent's Active Pokemon\.(?: |$)/i,m=>program({kind:'damage',target:'opponent_active',amount:damage(positive(m[1])*10)}))||
      atom(/^Put (\d+) damage counters on your opponent's (Benched )?Pokemon in any way you like\.(?: |$)/i,m=>program({kind:'allocate_damage',count:positive(m[1]),side:'opponent',...(m[2]?{zone:'bench'}:{})}))||
      atom(/^(?:This attack also does|This attack does) (\d+) damage to (?:1|one) of your opponent's Benched Pokemon\. \(Don't apply Weakness and Resistance for Benched Pokemon\.\)(?: |$)/i,m=>program({kind:'bench_target_damage',amount:damage(m[1])}))||
      atom(/^Search your deck for (up to )?(a|an|one|two|three|\d+) Basic Pokemon and put (?:it|them) onto your Bench\. Then, shuffle your deck\.(?: |$)/i,m=>program({kind:'search',filter:'basic',count:positive(m[2]),destination:'bench'}))||
      atom(/^Search your deck for (up to )?(a|an|one|two|three|\d+) (Basic Energy cards?|Basic Pokemon|Pokemon|Supporter card), reveal (?:it|them),? and put (?:it|them) into your hand\. Then, shuffle your deck\.(?: |$)/i,m=>program({kind:'search',filter:/^Basic Energy/i.test(m[3])?'energy':m[3]==='Basic Pokemon'?'basic':m[3]==='Pokemon'?'pokemon':'supporter',count:positive(m[2])}))||
      atom(/^(You may )?[Dd]raw cards until you have (\d+) cards in your hand\.(?: |$)/,m=>program({kind:'draw_until',count:positive(m[2]),ask:!!m[1]}))||
      atom(/^(You may )?[Dd]iscard a Stadium in play\.(?: |$)/,m=>program({kind:'discard_stadium',ask:!!m[1]}))||
      atom(/^This Pokemon recovers from all Special Conditions\.(?: |$)/i,()=>program({kind:'clear_conditions'}))||
      atom(/^Discard the top (card|\d+ cards) of (your opponent's|your) deck\.(?: |$)/i,m=>m[2]==='your'?{kind:'discard_deck',count:m[1]==='card'?1:positive(m[1].split(' ')[0])}:program({kind:'mill',count:m[1]==='card'?1:positive(m[1].split(' ')[0]),side:'opponent'}))||
      atom(/^(Flip a coin\. If heads, discard|Discard) an? Energy from your opponent's Active Pokemon\.(?: |$)/i,m=>program({kind:'discard_opponent_energy',position:'active',coin:m[1].startsWith('Flip')}))||
      atom(/^Before doing damage, discard all Pokemon Tools from your opponent's Active Pokemon\.(?: |$)/i,()=>({kind:'before_damage',effect:'discard_defender_tools'}))||
      atom(/^Draw (a|one|two|three|\d+) cards?\.(?: |$)/i,m=>({kind:'draw',count:positive(m[1])}))||
      atom(/^Heal (\d+) damage from (this Pokemon|each of your Pokemon|1 of your Pokemon)\.(?: |$)/i,m=>m[2]==='this Pokemon'?{kind:'heal_self',amount:damage(m[1])}:program({kind:m[2]==='each of your Pokemon'?'heal_all':'heal',amount:damage(m[1])}))||
      atom(/^This Pokemon also does (\d+) damage to itself\.(?: |$)/i,m=>({kind:'recoil',amount:damage(m[1])}))||
      atom(/^Discard (all|a|an|one|two|three|\d+) (?:(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal) )?Energy (?:cards? )?(?:(?:attached to|from) )?this Pokemon\.(?: |$)/i,m=>({kind:'discard_energy',count:m[1]==='all'?'all':positive(m[1]),type:m[2]||null}))||
      atom(/^(?:Your opponent's Active Pokemon|The Defending Pokemon|This Pokemon) is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\.(?: |$)/i,m=>({kind:'condition',condition:m[1].toLowerCase(),...(m[0].startsWith('This')?{side:'own'}:{})}));
    if(!consumed)return null;
  }
  if(!effects.length)return null;
  if(effects.some(e=>e.kind==='formula'&&!e.metric||e.kind==='conditional_bonus'&&!e.condition))throw Error('The damage formula is not fully understood.');
  if(/[+x-]$/.test(printed)!==formula)return null;
  if(effects.filter(e=>e.kind==='discard_energy').length>1)throw Error('Multiple Energy discard clauses require a reviewed profile.');
  return {...base({...attack,damage:printed.replace(/[+x-]$/,''),effect:''}),printed:printed||'—',text:original,effects};
}
export function advancedAbility(raw,original) {
  if(raw.type!=='Ability')return null;
  const name=raw.name;let effect=original,m,shared=null;
  if((m=effect.match(/ You can't use more than 1 (.+) Ability each turn\.$/))){if(m[1]!==name)throw Error('The shared Ability name disagrees with its limit.');shared=name;effect=effect.slice(0,m.index);}
  const active=program=>({name,text:original,type:raw.type,kind:'activated',limit:'turn',...(shared?{shared}:{}),program});
  if((m=effect.match(/^Once during your turn, you may search your deck for (?:a|1) card and put it into your hand\. Then, shuffle your deck\.$/i)))return active({kind:'search',filter:'any',count:1});
  if((m=effect.match(/^Once during your turn, you may look at the top (\d+) cards of your deck and put 1 of them into your hand\. Put the other card(?:s)? on the bottom of your deck\.$/i)))return active({kind:'look_pick',look:positive(m[1]),count:1,remainder:'bottom'});
  if((m=effect.match(/^Once during your turn, if this Pokemon has any (\w+) Energy attached, you may move up to (\d+) damage counters from 1 of your Pokemon to 1 of your opponent's Pokemon\.$/i))&&types.split('|').includes(m[1]))return {...active({kind:'move_counters',count:positive(m[2])}),requires:{energy:m[1]}};
  if((m=effect.match(/^Once during your turn, if any of your Pokemon were Knocked Out during your opponent's last turn, you may draw (\d+) cards\.$/i)))return {...active({kind:'draw',count:positive(m[1])}),requires:{knockout_last_turn:true}};
  if((m=effect.match(/^Once during your turn, you may draw (\d+) cards\. If you drew any cards in this way, shuffle this Pokemon and all attached cards into your deck\.$/i)))return active({kind:'draw_shuffle_self',count:positive(m[1])});
  if((m=effect.match(/^When you play this Pokemon from your hand to evolve 1 of your Pokemon during your turn, you may search your deck for up to (\d+) Basic (\w+) Energy cards and attach them to your Pokemon in any way you like\. Then, shuffle your deck\.$/i))&&types.split('|').includes(m[2]))return {name,text:original,type:raw.type,kind:'triggered',timing:'hand_evolve',optional:true,program:{kind:'accelerate',zone:'deck',filter:'energy:'+m[2],count:positive(m[1]),optional:true}};
  if((m=effect.match(/^When you play this Pokemon from your hand onto your Bench during your turn, you may (draw (\d+) cards|draw cards until you have (\d+) cards in your hand)\.$/i)))return {name,text:original,type:raw.type,kind:'triggered',timing:'hand_bench',optional:true,program:{kind:m[2]?'draw':'draw_until',count:positive(m[2]||m[3])}};
  if((m=effect.match(/^As often as you like during your turn, you may attach a Basic (\w+) Energy card from your hand to 1 of your Pokemon\.$/i))&&types.split('|').includes(m[1]))return {...active({kind:'accelerate',zone:'hand',filter:'energy:'+m[1],count:1}),limit:'unlimited'};
  if((m=effect.match(/^As often as you like during your turn, you may attach a Basic (\w+) Energy card from your discard pile to 1 of your (\w+) Pokemon\. If you attached Energy to a Pokemon in this way, put (\d+) damage counters on that Pokemon\. You can't use this Ability on a Pokemon that would be Knocked Out\.$/i))&&types.split('|').includes(m[1])&&types.split('|').includes(m[2]))return {...active({kind:'accelerate',zone:'discard',filter:'energy:'+m[1],count:1,targetType:m[2],counters:positive(m[3]),noKnockout:true}),limit:'unlimited'};
  const passive=modifier=>({name,text:original,type:raw.type,kind:'passive',modifier});
  if(/^Prevent all damage done to your Benched Pokemon by attacks from your opponent's Pokemon\.$/i.test(effect))return passive({prevent_bench_damage:true});
  if(/^Prevent all damage done to this Pokemon by attacks from your opponent's Pokemon ex and Pokemon V\.$/i.test(effect))return passive({prevent_damage:['ex','V','VMAX','VSTAR','V-UNION']});
  if(/^Prevent all effects of attacks (?:used by|from) your opponent's Pokemon done to this Pokemon\. \(Damage is not an effect\.\)$/i.test(effect))return passive({prevent_attack_effects:true});
  if((m=effect.match(/^This Pokemon takes (\d+) less damage from attacks \(after applying Weakness and Resistance\)\.$/i)))return passive({reduce_damage:damage(m[1])});
  if(/^If this Pokemon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10\.$/i.test(effect))return passive({survive_full_hp:true});
  return null;
}
export function advancedTrainer(raw,effect) {
  const type=raw.trainerType==='Ace Spec'?'Item':raw.trainerType;
  if(!['Item','Supporter'].includes(type))return null;
  let program=null,m,requires=null;
  const original=effect;
  if(effect.startsWith("You can use this card only if any of your Pokemon were Knocked Out during your opponent's last turn. ")){requires={knockout_last_turn:true};effect=effect.slice(effect.indexOf('. ')+2);}
  if(effect.startsWith('You can use this card only if you have more Prize cards remaining than your opponent. ')){requires={behind_prizes:true};effect=effect.slice(effect.indexOf('. ')+2);}
  if(/^Choose 1 of your Basic Pokemon in play\. If you have a Stage 2 card in your hand that evolves from that Pokemon, put that card onto the Basic Pokemon to evolve it, skipping the Stage 1\. You can't use this card during your first turn or on a Basic Pokemon that was put into play this turn\.$/i.test(effect))program={kind:'rare_candy'};
  else if((m=effect.match(/^Search your deck for (up to )?(a|an|one|two|three|\d+) Basic Pokemon( with (\d+) HP or less)? and put (?:it|them) onto your Bench\. Then, shuffle your deck\.$/i)))program={kind:'search',filter:m[4]?{kind:'pokemon',stage:'Basic',maxHP:Number(m[4])}:'basic',count:positive(m[2]),destination:'bench'};
  else if(/^Search your deck for an Item card and a Pokemon Tool card, reveal them, and put them into your hand\. Then, shuffle your deck\.$/i.test(effect))program={kind:'search_groups',groups:['item','tool']};
  else if(/^Each player shuffles their hand and puts it on the bottom of their deck\. If either player put any cards on the bottom of their deck in this way, each player draws a card for each of their remaining Prize cards\.$/i.test(effect))program={kind:'reset_hands',placement:'bottom',draw:'prizes',requiresHand:true};
  else if((m=effect.match(/^Each player shuffles their hand into their deck\. Then, (?:each player draws (\d+) cards|you draw (\d+) cards, and your opponent draws (\d+) cards)\.$/i)))program={kind:'reset_hands',placement:'shuffle',draw:Number(m[1]||m[2]),opponentDraw:Number(m[1]||m[3])};
  else if((m=effect.match(/^(Flip a coin\. If heads, discard|Discard) (an Energy|a Special Energy) from (1 of your opponent's Pokemon|your opponent's Active Pokemon)\.$/i)))program={kind:'discard_opponent_energy',coin:m[1].startsWith('Flip'),special:m[2]==='a Special Energy',position:m[3].startsWith('1')?'any':'active'};
  else if(/^Put a Pokemon or a Basic Energy card from your discard pile into your hand\.$/i.test(effect))program={kind:'recover',filter:'pokemon_or_energy',count:1};
  else if((m=effect.match(/^Shuffle up to (\d+) Supporter cards from your discard pile into your deck\.$/i)))program={kind:'recover',filter:'supporter',count:positive(m[1]),optional:true,destination:'deck'};
  else if(/^Switch in 1 of your opponent's Benched Pokemon to the Active Spot\.$/i.test(effect))program={kind:'gust'};
  else if((m=effect.match(/^Look at the top (\d+) cards of your deck\. You may reveal a Supporter card you find there and put it into your hand\. Shuffle the other cards back into your deck\.$/i)))program={kind:'look_pick',look:positive(m[1]),count:1,filter:'supporter',optional:true,reveal:true,remainder:'shuffle'};
  else if(/^Search your deck for up to 2 Basic Energy cards of different types, reveal them, and put 1 of them into your hand\. Attach the other to 1 of your Pokemon\. Then, shuffle your deck\.$/i.test(effect))program={kind:'split_energy_search'};
  else if((m=effect.match(/^Put 1 of your Pokemon(?: in play)? into your hand\. \(?(Discard all cards attached to that Pokemon|Put all attached cards into your hand)\.\)?$/i)))program={kind:'return_pokemon',attachments:m[1].startsWith('Discard')?'discard':'hand'};
  else if(/^Move a Basic Energy from 1 of your Pokemon to another of your Pokemon\.$/i.test(effect))program={kind:'move_energy'};
  if(!program)return null;
  return {...program,...(requires?{requires}:{}),trainerType:type,text:original};
}
