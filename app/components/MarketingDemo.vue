<script setup lang="ts">
const theme = ref('dusk')
const cards = [
  {name:'EMBER',tone:'ember',icon:'star',finish:'Holo'}, {name:'TIDELINE',tone:'tide',icon:'cloud',finish:'Normal'},
  {name:'BLOOM',tone:'bloom',icon:'star',finish:'Reverse'}, {name:'ORBIT',tone:'orbit',icon:'cloud',finish:'Holo'},
  {name:'DAYBREAK',tone:'dawn',icon:'star',finish:'Normal'}, {name:'MOSS',tone:'moss',icon:'cloud',finish:'Reverse'},
  {name:'SOLSTICE',tone:'dawn',icon:'star',finish:'Holo'}, {name:'AFTERGLOW',tone:'orbit',icon:'cloud',finish:'Normal'}
]
</script>
<template>
  <div class="m-demo-wrap">
    <div class="m-demo" :class="'m-theme-'+theme">
      <div class="m-demo-chrome"><span class="m-window-dots"><i /><i /><i /></span><span>YOUR COLLECTION, YOUR WAY</span><AppIcon name="shield" :size="15" /></div>
      <div class="m-demo-heading"><div><small>PERSONAL BINDER</small><strong>The favourites.</strong></div><span class="m-demo-tag">9-pocket layout</span></div>
      <div class="m-demo-grid">
        <div v-for="(card, i) in cards" :key="card.name" class="m-demo-pocket"><div class="m-demo-card" :class="'m-card-'+card.tone"><span class="m-demo-card-top">{{ card.name }}<small>{{ String(i+1).padStart(2,'0') }}</small></span><div class="m-demo-art"><AppIcon :name="card.icon" :size="30" /><i /><i /></div><span class="m-demo-card-bottom">{{ card.finish }}<i /></span></div></div>
        <div class="m-demo-pocket m-demo-empty"><AppIcon name="plus" :size="24" /><span>The next great find.</span></div>
      </div>
      <div class="m-demo-bottom"><span>PAGE 01 <i /> MADE YOURS</span><span class="m-demo-theme-controls"><button v-for="value in ['dusk','sage','ink']" :key="value" type="button" :class="['m-swatch', 'm-swatch-'+value]" :aria-label="'Preview '+value+' binder theme'" :aria-pressed="theme===value" @click="theme=value" /></span></div>
    </div>
    <div class="m-demo-float"><span class="m-float-icon"><AppIcon name="check" :size="17" /></span><div><strong>A place for every printing.</strong><small>Normal. Holo. Reverse. All accounted for.</small></div></div>
    <p class="m-demo-disclaimer">Interactive style preview · original illustrative cards, not live collection data.</p>
  </div>
</template>
