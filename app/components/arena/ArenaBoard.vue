<script setup lang="ts">
import ArenaCard from './ArenaCard.vue'
const props = defineProps<{ table: any; aliases: string[]; selected?: string; hit?: string; focusZone?: string; stadiumMoves?: any[]; locked?: boolean }>()
const emit = defineEmits<{ select: [unit: any]; discard: [seat: number]; action: [action: any] }>()
const self = computed(() => props.table.seat), other = computed(() => self.value === 0 ? 1 : 0)
const sides = computed(() => [other.value, self.value])
const player = (seat: number) => props.table.players[seat]
// Keep the DOM in table order as well as the visual layout. Never reverse/mutate server arrays.
const fieldZones = (seat: number) => seat === self.value ? ['active', 'bench'] : ['bench', 'active']
// Decorative backs are derived only from public counts, never from a private hand/deck/Prize array.
const visibleBacks = (count: number, limit: number) => Number.isSafeInteger(count) ? Math.min(limit, Math.max(0, count)) : 0
const turnLabel = computed(() => {
  if (props.table.phase === 'setup') return 'Opening setup'
  if (props.table.phase !== 'playing') return 'Match complete'
  if (props.table.waiting_for != null && props.table.waiting_for !== self.value) return 'Opponent is choosing…'
  if (props.table.prompt) return 'Your decision is needed'
  return props.table.turn === self.value ? 'Your turn' : `${props.aliases[props.table.turn]} is playing`
})
</script>
<template>
  <div class="arena-board arena-table" data-layout="opposite-table" :data-focus-zone="focusZone || ''">
    <template v-for="seat in sides" :key="seat">
      <section class="arena-field arena-table-side" :class="{ 'is-opponent': seat !== self, 'is-your-turn': table.turn === seat && table.phase === 'playing' }" :data-side="seat === self ? 'self' : 'opponent'" :aria-label="aliases[seat] + ' play area'">
        <div class="arena-player-strip">
          <span class="arena-avatar" aria-hidden="true">{{ aliases[seat]?.slice(0, 1).toUpperCase() }}</span>
          <strong>{{ aliases[seat] }} <small>{{ seat === self ? 'YOU' : 'OPPONENT' }}</small></strong>
          <span class="arena-hand-count">{{ player(seat).hand_count }} in hand</span>
          <span v-if="table.turn === seat && table.phase === 'playing'" class="arena-turn-chip">TURN {{ table.turn_number }}</span>
          <span v-else-if="table.phase === 'setup'" class="arena-turn-chip">{{ player(seat).ready ? 'READY' : 'PREPARING' }}</span>
        </div>
        <div v-if="seat !== self" class="arena-opponent-hand" role="img" :aria-label="aliases[seat] + ' hand: ' + player(seat).hand_count + ' face-down cards'">
          <span v-for="i in visibleBacks(player(seat).hand_count, 12)" :key="i" class="arena-opponent-back" aria-hidden="true">CS</span>
          <span v-if="player(seat).hand_count > 12" class="arena-opponent-extra" aria-hidden="true">+{{ player(seat).hand_count - 12 }}</span>
          <span v-if="!player(seat).hand_count" class="arena-table-empty-note" aria-hidden="true">No cards in hand</span>
        </div>
        <div class="arena-table-lanes">
          <div class="arena-table-battle-line">
            <section v-for="zone in fieldZones(seat)" :key="zone" class="arena-table-card-zone" :class="'arena-table-' + zone" :data-field-zone="zone" :aria-label="aliases[seat] + (zone === 'active' ? ' Active Pokémon' : ' Bench')">
              <span class="arena-table-zone-label">{{ zone === 'active' ? 'Active Pokémon' : 'Bench' }}</span>
              <div v-if="zone === 'bench'" class="arena-bench-row">
                <div v-for="i in 5" :key="i" class="arena-bench-spot">
                  <ArenaCard v-if="player(seat).bench[i - 1]" :unit="player(seat).bench[i - 1]" :selected="selected === player(seat).bench[i - 1].id" :hit="hit === player(seat).bench[i - 1].id" @select="emit('select', $event)"/>
                  <span v-else class="arena-empty-slot">BENCH {{ i }}</span>
                </div>
              </div>
              <div v-else class="arena-active-spot" data-zone="active">
                <ArenaCard v-if="player(seat).active" :unit="player(seat).active" :selected="selected === player(seat).active.id" :hit="hit === player(seat).active.id" @select="emit('select', $event)"/>
                <span v-else class="arena-empty-slot">ACTIVE POKÉMON</span>
              </div>
            </section>
          </div>
          <div class="arena-table-reserve" :aria-label="aliases[seat] + ' deck and discard'">
            <div class="arena-deck-stack" :class="{ 'is-empty': !player(seat).deck_count }" role="img" :aria-label="aliases[seat] + ' deck: ' + player(seat).deck_count + ' face-down cards'">
              <span class="arena-stack-mark" aria-hidden="true">CS</span><b aria-hidden="true">{{ player(seat).deck_count }}</b><small aria-hidden="true">DECK</small>
            </div>
            <button type="button" class="arena-discard-button arena-table-discard" :class="{ 'is-empty': !player(seat).discard.length }" :aria-label="'Inspect ' + aliases[seat] + ' discard: ' + player(seat).discard.length + ' cards'" @click="emit('discard', seat)">
              <b>{{ player(seat).discard.length }}</b><span>Discard ↗</span>
            </button>
          </div>
          <section class="arena-prize-area arena-table-prizes" data-zone="prizes" :aria-label="aliases[seat] + ' Prize cards: ' + player(seat).prize_count + ' remaining'">
            <strong>{{ player(seat).prize_count }} <small>PRIZES</small></strong>
            <div class="arena-prize-pips" aria-hidden="true"><i v-for="i in visibleBacks(player(seat).prize_count, 6)" :key="i" /></div>
            <small>{{ !player(seat).prize_count ? 'No Prize cards' : seat === self ? 'Choose when prompted' : 'Face down' }}</small>
          </section>
        </div>
      </section>
      <section v-if="seat !== self" class="arena-table-centre" aria-label="Battlefield">
        <div class="arena-table-status"><span class="arena-kicker">BATTLEFIELD</span><strong>{{ turnLabel }}</strong><small v-if="table.phase === 'playing'">Turn {{ table.turn_number }}</small></div>
        <section v-if="table.stadium !== undefined" class="arena-stadium-slot" aria-label="Shared Stadium">
          <template v-if="table.stadium?.unit && !table.stadium.unit.hidden">
            <ArenaCard :unit="table.stadium.unit" :selected="selected === table.stadium.unit.id" :label="'Inspect Stadium: ' + table.stadium.unit.card.name" @select="emit('select', $event)"/>
            <div><span class="arena-kicker">SHARED STADIUM</span><button type="button" class="arena-link" @click="emit('select', table.stadium.unit)">{{ table.stadium.unit.card.name }}</button><small>Played by {{ aliases[table.stadium.seat] }} · affects both fields as written</small><button v-for="move in stadiumMoves || []" :key="JSON.stringify(move.action)" type="button" class="arena-button" :disabled="locked" @click="emit('action', move.action)">{{ move.label }}</button></div>
          </template>
          <div v-else><span class="arena-kicker">SHARED STADIUM</span><p>No Stadium in play.</p><small>Play a supported Stadium from your hand.</small></div>
        </section>
        <div v-else class="arena-table-core-mark" aria-hidden="true">CS</div>
      </section>
    </template>
    <section class="arena-hand-area" data-zone="hand" aria-label="Your private hand">
      <div class="arena-zone-caption"><strong>Your hand</strong><span>{{ player(self).hand_count }} cards · only you can see these</span></div>
      <div class="arena-hand-fan" tabindex="0" role="region" aria-label="Your hand cards; scroll horizontally for more">
        <ArenaCard v-for="(unit, index) in player(self).hand" :key="unit.id" :unit="unit" :selected="selected === unit.id" :style="{ '--fan-index': index }" @select="emit('select', $event)"/>
        <p v-if="!player(self).hand.length" class="arena-muted">Your hand is empty.</p>
      </div>
    </section>
  </div>
</template>
<style src="~/assets/css/arena-table.css"></style>
