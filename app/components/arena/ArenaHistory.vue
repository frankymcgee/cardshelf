<script setup lang="ts">
import { ref, computed } from 'vue'
import { arenaHistoryRows } from '../../../shared/arena-match-ui.mjs'
const props = defineProps<{ events: any[]; seat: number; aliases: string[] }>()
const query = ref(''), filter = ref('all')
const rows = computed(() => arenaHistoryRows(props.events, props.seat, filter.value, query.value))
function actor(seat: number | null) { return seat === null ? 'Table' : props.aliases?.[seat] || (seat === props.seat ? 'You' : 'Opponent') }
</script>
<template>
  <section class="arena-history-view" aria-label="Recent match events">
    <p>Most recent disclosed events, newest first. This is a bounded activity log, not a complete replay or a view of hidden cards.</p>
    <div class="arena-history-filters">
      <label>Search history<input v-model="query" type="search" maxlength="80" placeholder="Search event text or revealed names" autocomplete="off"></label>
      <label>Show events<select v-model="filter"><option value="all">All players</option><option value="mine">Your actions</option><option value="opponent">Opponent actions</option><option value="table">Table events</option></select></label>
    </div>
    <p class="arena-history-count" role="status">{{ rows.length }} matching {{ rows.length === 1 ? 'event' : 'events' }} in the latest available history.</p>
    <ol v-if="rows.length" class="arena-history-events">
      <li v-for="event in rows" :key="event.n"><div class="arena-history-actor"><strong>{{ actor(event.seat) }}</strong><small>Event {{ event.n }}</small></div><p>{{ event.text }}</p>
        <details v-if="event.revealed.length"><summary>Revealed cards ({{ event.revealed.length }})</summary><ul><li v-for="(name, index) in event.revealed" :key="index">{{ name }}</li></ul></details>
      </li>
    </ol>
    <p v-else>No events match these filters.</p>
  </section>
</template>
<style scoped>
.arena-history-view{line-height:1.6;min-width:0}.arena-history-filters{display:flex;flex-wrap:wrap;gap:14px}.arena-history-filters label{display:flex;flex-direction:column;gap:6px;flex:1;min-width:min(200px,100%);font-weight:700}.arena-history-filters input,.arena-history-filters select{min-height:44px;max-width:100%;width:100%;padding:10px;border:1px solid #637f8b;border-radius:10px;background:#102632;color:#f1fafc;font:inherit}.arena-history-count{color:#becfd6;font-size:13px}.arena-history-events{padding:0;list-style:none;margin:0}.arena-history-events>li{border-top:1px solid #49616c;padding:14px 0;overflow-wrap:anywhere}.arena-history-events p{margin:6px 0}.arena-history-actor{display:flex;justify-content:space-between;gap:14px;align-items:baseline}.arena-history-actor small{flex-shrink:0;color:#becfd6}.arena-history-events summary{cursor:pointer;min-height:44px;display:flex;align-items:center;text-decoration:underline}.arena-history-events details ul{padding-left:22px}
</style>
