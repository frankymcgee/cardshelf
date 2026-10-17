/** Labels for disclosed status effects only; the server decides all legality. */
export function arenaStatusEffect(effect) {
  if(!effect||typeof effect!=='object')return '';
  if(effect.kind==='attack_lock')return effect.attack?`Cannot use ${effect.attack}`:'Cannot attack';
  if(effect.kind==='retreat_lock')return 'Cannot retreat';
  if(effect.kind==='trainer_lock')return `${effect.trainerType} cards blocked`;
  if(effect.kind==='reduce_damage')return `Takes ${effect.amount} less attack damage`;
  if(effect.kind==='prevent_damage')return `Attack damage${effect.effects?' and effects':''} prevented${effect.attacker==='basic'?' from Basic Pokémon':''}`;
  return '';
}
