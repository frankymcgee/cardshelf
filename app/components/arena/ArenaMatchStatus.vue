<script setup lang="ts">
import { computed } from 'vue'
import { arenaTurnStatus, arenaPrizeCounts } from '../../../shared/arena-match-ui.mjs'
const props = defineProps<{ table: any; status: string; connected: boolean; busy: boolean; uncertain: boolean }>()
const guidance = computed(() => arenaTurnStatus(props.table, props))
const prizes = computed(() => arenaPrizeCounts(props.table))
const turnLabel = computed(() => props.table?.phase === 'setup' ? 'OPENING SETUP'
  : Number.isSafeInteger(props.table?.turn_number) && props.table.turn_number >= 1 ? 'TURN ' + props.table.turn_number : 'TABLE STATUS')
</script>
<template>
  <section class="arena-match-status" :data-tone="guidance.tone" aria-label="Match status">
    <div class="arena-match-guidance" role="status" aria-live="polite" aria-atomic="true">
      <span class="arena-kicker">{{ turnLabel }}</span><strong>{{ guidance.title }}</strong><p>{{ guidance.detail }}</p>
      <p v-if="table?.tiebreaker">Tiebreaker game · six Prizes at setup. The first Prize advantage wins; normal loss conditions still apply.</p>
    </div>
    <dl class="arena-prize-score" aria-label="Prizes remaining">
      <div v-for="row in prizes" :key="row.seat"><dt>{{ row.own ? 'Your Prizes left' : 'Opponent Prizes left' }}</dt><dd>{{ row.count ?? '—' }}</dd></div>
    </dl>
  </section>
</template>
<style scoped>
.arena-match-status{display:flex;align-items:center;justify-content:space-between;gap:20px;min-width:0;width:100%;padding:16px 20px;border:1px solid #46606b;border-left:4px solid #76929c;border-radius:16px;background:#142b37;color:#edf8fa}.arena-match-status[data-tone=own]{border-left-color:#8ee1a6}.arena-match-status[data-tone=decision]{border-left-color:#f8d583}.arena-match-status[data-tone=paused]{border-left-color:#ffba89}.arena-match-guidance{min-width:0}.arena-match-guidance strong{display:block;font-size:20px;line-height:1.4}.arena-match-guidance p{margin:6px 0 0;color:#c0d2d9;line-height:1.5;overflow-wrap:anywhere}.arena-prize-score{display:flex;flex-shrink:0;gap:16px;margin:0}.arena-prize-score>div{min-width:70px;text-align:center}.arena-prize-score dt{font-size:12px;max-width:100px;line-height:1.4;color:#c0d2d9}.arena-prize-score dd{margin:2px 0 0;font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}
@media(max-width:650px){.arena-match-status{padding:14px;flex-wrap:wrap;gap:12px}.arena-prize-score{width:100%;justify-content:space-around;border-top:1px solid #46606b;padding-top:10px}.arena-prize-score>div{display:flex;align-items:center;gap:10px}.arena-prize-score dt{max-width:85px;text-align:left}.arena-match-guidance strong{font-size:18px}}
</style>
