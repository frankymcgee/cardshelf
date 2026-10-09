<script setup lang="ts">
import { AUDIO_PREFERENCE_KEY, ARENA_EFFECT_CHOICES, ARENA_TRACKS, audioPreferences, arenaEventCue, createArenaAudio } from '../../../shared/arena-audio.mjs'
const props = defineProps<{ events?: any[]; matchId: string; result?: number | string | null; seat: number; available: boolean; selected?: string }>()
const options = reactive(audioPreferences()), started = ref(false), error = ref('')
const preview = ref('energy')
let player: ReturnType<typeof createArenaAudio> | undefined, lastEvent = -1
function remember() { try { localStorage.setItem(AUDIO_PREFERENCE_KEY, JSON.stringify(audioPreferences(options))) } catch { /* Browser storage may be disabled. */ } }
function apply() { remember(); player?.configure(options) }
function enable() { error.value = ''; if (!options.effects && !options.music) options.effects = true; apply(); started.value = true; player?.activate(); player?.cue('select') }
function mute() { started.value = false; player?.stop() }
function visibility() { player?.setVisible(!document.hidden && document.hasFocus()) }
watch(options, apply, { deep: true })
watch(() => props.available, value => player?.setAvailable(value))
watch(() => props.matchId, () => { lastEvent = -1; mute() })
watch(() => props.selected, (value, previous) => { if (value && value !== previous) player?.cue('select') })
watch(() => props.events, value => {
  const events = Array.isArray(value) ? value : []
  const cue = arenaEventCue(events, lastEvent, props.result, props.seat)
  const latest = events.at(-1)?.n
  if (Number.isSafeInteger(latest)) lastEvent = Math.max(lastEvent, latest)
  if (cue) player?.cue(cue)
}, { immediate: true })
onMounted(() => {
  try { Object.assign(options, audioPreferences(JSON.parse(localStorage.getItem(AUDIO_PREFERENCE_KEY) || '{}'))) } catch { /* Use silent defaults. */ }
  player = createArenaAudio(window, message => { error.value = message }); player.configure(options); player.setAvailable(props.available); visibility()
  window.addEventListener('focus', visibility); window.addEventListener('blur', visibility); document.addEventListener('visibilitychange', visibility)
})
onBeforeUnmount(() => { player?.dispose(); window.removeEventListener('focus', visibility); window.removeEventListener('blur', visibility); document.removeEventListener('visibilitychange', visibility) })
</script>
<template>
  <section class="arena-audio-controls" aria-label="Arena audio">
    <div class="arena-audio-heading"><strong>Sound & music</strong><button type="button" class="arena-button" :disabled="!available" :aria-pressed="started" @click="started ? mute() : enable()">{{ started ? 'Mute audio' : 'Enable audio' }}</button></div>
    <label class="arena-audio-check"><input v-model="options.effects" type="checkbox">Sound effects</label>
    <label>Effects volume<input v-model.number="options.effectsVolume" type="range" min="0" max="1" step="0.05" aria-label="Effects volume"></label>
    <label>Sound preview<select v-model="preview" aria-label="Sound preview"><option v-for="effect in ARENA_EFFECT_CHOICES" :key="effect.id" :value="effect.id">{{ effect.name }}</option></select></label>
    <button type="button" class="arena-button quiet" :disabled="!available || !started || !options.effects || !options.effectsVolume" @click="player?.cue(preview)">Preview sound</button>
    <label class="arena-audio-check"><input v-model="options.music" type="checkbox">Background music</label>
    <label>Music track<select v-model="options.track" aria-label="Music track"><option v-for="track in ARENA_TRACKS" :key="track.id" :value="track.id">{{ track.name }}</option></select></label>
    <label>Music volume<input v-model.number="options.musicVolume" type="range" min="0" max="1" step="0.05" aria-label="Music volume"></label>
    <p v-if="error" role="status" class="arena-audio-note">{{ error }} <button type="button" class="arena-link" @click="enable">Enable audio again</button></p>
    <p class="arena-audio-note">Silent until you enable audio. Pauses when this window is hidden or unfocused. Preferences are saved in this browser; no gameplay data is stored with them.</p>
    <details class="arena-audio-credits"><summary>Audio credits</summary><p>Interface samples: Kenney (CC0), distributed in the Calinou interface pack. Quiet table, Pulse table and the other cues: original synthesized CardShelf audio. No Pokémon game recordings are used.</p><a href="/audio/arena/CREDITS.txt" target="_blank" rel="noopener noreferrer">Sources and licence details</a></details>
  </section>
</template>
<style scoped>
.arena-audio-controls{border-top:1px solid var(--arena-line,#c9d6e02a);margin-top:14px;padding-top:14px;display:grid;gap:12px;min-width:0}.arena-audio-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.arena-audio-controls label{display:block;font-size:12px;color:inherit}.arena-audio-controls .arena-audio-check{display:flex;flex-direction:row;align-items:center;gap:10px}.arena-audio-controls input[type=checkbox]{width:18px;min-height:18px;flex:none;margin:0}.arena-audio-controls input[type=range]{width:100%;min-height:32px;padding:0;background:none;accent-color:#7ac9b7}.arena-audio-controls select{max-width:100%;color:inherit}.arena-audio-note,.arena-audio-credits{font-size:11px;line-height:1.65;color:inherit;opacity:.8;margin:0}.arena-audio-credits summary{min-height:32px;cursor:pointer}.arena-audio-credits a{text-decoration:underline}.arena-audio-credits p{margin-bottom:6px}
</style>
