<script setup lang="ts">
const props = defineProps<{ path: string; administrator: boolean; marketplace?: boolean; grid?: boolean }>()
const cleanPath = computed(() => (props.path.split('?')[0] || '/').replace(/\/$/, '') || '/')
const format = computed(() => props.grid || props.marketplace ? 'rectangle' : cleanPath.value === '/' ? 'billboard' : cleanPath.value === '/features' ? 'multiplex' : cleanPath.value === '/pricing' || cleanPath.value.startsWith('/explore/') ? 'rectangle' : 'leaderboard')
const labels = { billboard: 'Auto banner · large', leaderboard: 'Auto banner · horizontal', rectangle: 'Auto banner · rectangle', multiplex: 'Auto Multiplex · responsive grid' }
const marketing = computed(() => ['/', '/features', '/pricing'].includes(cleanPath.value))
const anchorAllowed = computed(() => !props.grid && ['/', '/features', '/app', '/cards'].includes(cleanPath.value))
const anchorClosed = ref(false), railClosed = ref(false)
watch(cleanPath, () => { anchorClosed.value = false; railClosed.value = false })
</script>
<template>
  <aside id="cardshelf-placement-preview" class="placement-preview" :class="['format-' + format, { 'grid-placement': grid, 'market-card': marketplace && !grid }]" aria-label="Google Auto ads placeholder" data-testid="ad-placeholder" :data-format="format">
    <small class="placement-caption">{{ grid ? 'ADVERTISEMENT · AUTO ADS' : 'ADVERTISEMENT · AUTO ADS PLACEHOLDER' }}</small>
    <div v-if="format === 'multiplex'" class="multiplex-grid" aria-hidden="true"><div v-for="n in 4" :key="n" class="multiplex-tile"><span>▧</span><i /><i /></div></div>
    <div v-else class="preview-space"><span aria-hidden="true">▧</span><strong>{{ labels[format] }}</strong><p>Advertising helps support free accounts.</p></div>
    <strong v-if="format === 'multiplex'" class="format-label">{{ labels[format] }}</strong>
    <small v-if="!grid" class="preview-dimensions"><template v-if="format === 'billboard'"><span class="desktop-size">970 × 250</span><span class="mobile-size">320 × 100</span></template><template v-else-if="format === 'leaderboard'"><span class="desktop-size">728 × 90</span><span class="mobile-size">320 × 100</span></template><template v-else-if="format === 'rectangle'">300 × 250</template><template v-else>4 columns → 2 columns</template> · illustrative, responsive</small>
    <small v-if="grid" class="preview-note">Advertising space · not a card listing</small>
    <small v-if="administrator && !grid" class="preview-note">Google determines the live position, size and fill. This is a local layout preview.</small>
  </aside>
  <aside v-if="anchorAllowed && !anchorClosed" class="placement-anchor" :class="{ 'workspace-anchor': !marketing }" aria-label="Auto anchor placeholder" data-testid="placement-anchor">
    <div><small>ADVERTISEMENT · AUTO ANCHOR PREVIEW</small><strong>Responsive edge placement</strong><span>Illustrative size · 728 × 90 / 320 × 50</span></div>
    <button type="button" aria-label="Dismiss anchor preview" @click="anchorClosed = true">×</button>
  </aside>
  <aside v-if="marketing && cleanPath !== '/pricing' && !railClosed" class="placement-rail" aria-label="Auto side rail placeholder" data-testid="placement-rail">
    <button type="button" aria-label="Dismiss side rail preview" @click="railClosed = true">×</button><small>ADVERTISEMENT · AUTO SIDE RAIL PREVIEW</small><span aria-hidden="true">▧</span><strong>Desktop side rail</strong><small>160 × 600<br>Illustrative size</small>
  </aside>
</template>
<style scoped>
.placement-preview,.placement-anchor,.placement-rail{box-sizing:border-box;border:1px dashed var(--line,#dcdfe7);border-radius:14px;background:var(--surface-soft,#f3f4f7);color:var(--muted,#6c7280);text-align:center}
.placement-preview{padding:16px;margin:32px auto;max-width:100%;min-width:0;width:100%;container-type:inline-size}
.placement-caption,.preview-note,.preview-dimensions{display:block;font-size:11px;line-height:1.5}.placement-caption{letter-spacing:.05em;font-weight:700;margin-bottom:10px}.preview-note{margin-top:8px}.preview-dimensions{margin-top:10px}
.preview-space{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:90px}.preview-space>span{font-size:26px}.preview-space p{font-size:12px;margin:0}.format-billboard{max-width:1004px}.format-billboard .preview-space{min-height:250px}.format-leaderboard{max-width:762px}.format-rectangle{max-width:334px}.format-rectangle .preview-space{min-height:250px}.format-rectangle.market-card{margin:0;align-self:start;max-width:100%}
.format-multiplex{max-width:1004px}.multiplex-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.multiplex-tile{padding:12px;border:1px solid var(--line,#dcdfe7);border-radius:8px}.multiplex-tile span{display:grid;place-items:center;aspect-ratio:1.5;font-size:32px;background:var(--paper,#fff);border-radius:6px}.multiplex-tile i{display:block;height:7px;background:var(--line,#dcdfe7);margin-top:10px;border-radius:5px}.multiplex-tile i:last-child{width:65%}.format-label{display:block;margin-top:14px;font-size:13px}
.mobile-size{display:none}.placement-anchor{position:fixed;z-index:25;bottom:max(12px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);width:min(728px,calc(100vw - 32px));min-height:90px;padding:12px 44px 12px 16px;box-shadow:0 8px 30px #0002}.placement-anchor div{display:grid;gap:4px}.placement-anchor small,.placement-anchor span{font-size:10px}.placement-anchor strong{font-size:13px}.placement-anchor button,.placement-rail button{position:absolute;right:4px;top:4px;width:36px;height:36px;border:0;border-radius:8px;background:var(--paper,#fff);color:inherit;font-size:25px;cursor:pointer}.placement-rail{display:none}
@media(min-width:1800px) and (min-height:800px){.placement-rail{display:flex;position:fixed;right:16px;top:110px;width:160px;height:600px;z-index:25;padding:48px 12px 16px;flex-direction:column;align-items:center;justify-content:center;gap:25px}.placement-rail small{font-size:10px;line-height:1.6}.placement-rail>span{font-size:36px}.placement-rail strong{font-size:14px}}
@media(min-width:768px){.workspace-anchor{left:calc(50% + 116px);width:min(728px,calc(100vw - 280px))}}
@media(max-width:767px){.placement-preview{padding:12px;margin:24px auto}.format-billboard .preview-space,.format-leaderboard .preview-space{min-height:100px}.desktop-size{display:none}.mobile-size{display:inline}.multiplex-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.placement-anchor{min-height:70px;width:calc(100vw - 24px)}.workspace-anchor{bottom:calc(90px + env(safe-area-inset-bottom))}.placement-anchor span{display:none}}
.grid-placement{margin:0!important;max-width:100%;height:100%;align-self:stretch;display:flex;flex-direction:column;justify-content:center;overflow-wrap:anywhere}.grid-placement .preview-space{min-height:0;flex:1;aspect-ratio:5/7}.grid-placement .preview-space strong{font-size:13px}.grid-placement .preview-note{font-size:10px}
@media print{.placement-preview,.placement-anchor,.placement-rail{display:none!important}}
</style>
