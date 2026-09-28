<script setup lang="ts">
import { appearanceDefaults, resolvedAppearance } from '../../shared/appearance.mjs'
const props = defineProps<{ open: boolean; binder: any }>()
const emit = defineEmits(['close', 'saved'])
const api = useApi(), notice = useNotice()
const draft = reactive<any>({}), snapshot = ref<any>(null), busy = ref(false), reading = ref(false), conflict = ref(false)
const wallpaper = ref<{ content_type: string; data_base64: string } | null>(null)
const previewImage = ref(''), removeWallpaper = ref(false), fileName = ref(''), fileInput = ref<HTMLInputElement>()
let sequence = 0
function initialise(binder: any) {
  sequence++; snapshot.value = binder; Object.assign(draft, resolvedAppearance(binder.appearance, binder.color))
  wallpaper.value = null; previewImage.value = ''; removeWallpaper.value = false; fileName.value = ''; conflict.value = false; reading.value = false
  if (fileInput.value) fileInput.value.value = ''
}
watch(() => props.open, open => { if (open && props.binder) initialise(props.binder); else { sequence++; wallpaper.value = null; previewImage.value = ''; reading.value = false } }, { immediate: true })
onBeforeUnmount(() => { sequence++ })
const previewBinder = computed(() => ({ ...snapshot.value, appearance: { ...draft } }))
const samples = [
  { name: 'Holo preview', key: 'holo', label: 'Holo', source: 'tcgdex' },
  { name: 'Reverse preview', key: 'reverse', label: 'Reverse Holo', source: 'tcgdex' },
  { name: 'Example ex', key: 'holo', label: 'Holo', source: 'tcgdex' }
]
async function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const request = ++sequence
  wallpaper.value = null; previewImage.value = ''; fileName.value = ''
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5_000_000) {
    notice.show('Choose a JPEG, PNG or WebP under 5 MB.', 'error'); return
  }
  reading.value = true
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Unable to read the wallpaper.'))
      reader.readAsDataURL(file)
    })
    if (request !== sequence || !props.open) return
    wallpaper.value = { content_type: file.type, data_base64: data.slice(data.indexOf(',') + 1) }
    previewImage.value = data; removeWallpaper.value = false; fileName.value = file.name; draft.mode = 'image'
  } catch (e) { if (request === sequence) notice.show(errorMessage(e), 'error') }
  finally { if (request === sequence) reading.value = false }
}
function removeImage() {
  sequence++; reading.value = false; wallpaper.value = null; previewImage.value = ''; removeWallpaper.value = true; fileName.value = ''; draft.mode = 'color'
  if (fileInput.value) fileInput.value.value = ''
}
function resetStyle() { Object.assign(draft, appearanceDefaults(props.binder.color)) }
async function reloadAppearance() {
  busy.value = true
  try { initialise(await api('/api/binders/' + props.binder.id)); emit('saved') }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
async function save() {
  busy.value = true
  try {
    await api('/api/binders/' + snapshot.value.id + '/appearance', { method: 'PATCH', body: {
      revision: snapshot.value.revision, appearance: { ...draft }, remove_wallpaper: removeWallpaper.value,
      ...(wallpaper.value ? { wallpaper: wallpaper.value } : {})
    } })
    emit('saved'); emit('close'); notice.show('Binder appearance saved.')
  } catch (e: any) { conflict.value = e?.statusCode === 409 || e?.status === 409; notice.show(errorMessage(e), 'error') }
  finally { busy.value = false }
}
</script>
<template>
  <AppModal :open="open" title="Binder appearance" wide :dismissible="!busy && !reading" @close="emit('close')">
    <form v-if="snapshot" class="appearance-editor" @submit.prevent="save">
      <fieldset class="appearance-fields" :disabled="busy || reading">
        <legend class="sr-only">Appearance settings</legend>
        <div class="form-columns">
          <label>Background<select v-model="draft.mode"><option value="color">Solid colour</option><option value="image">Wallpaper</option></select></label>
          <label>Background colour<input v-model="draft.background_color" type="color" /></label>
          <label>Pocket colour<input v-model="draft.pocket_color" type="color" /></label>
        </div>
        <label>Pocket opacity · {{ draft.pocket_opacity }}%<input v-model.number="draft.pocket_opacity" type="range" min="0" max="100" /></label>
        <template v-if="draft.mode === 'image' || snapshot.wallpaper_version || wallpaper">
          <label>Wallpaper image<input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" @change="chooseFile" /><small>JPEG, PNG or WebP · up to 5 MB / 20 megapixels. Optimised and stored on your server only when you save.</small></label>
          <p v-if="fileName" class="small muted">Selected: {{ fileName }}</p>
          <button v-if="snapshot.wallpaper_version || wallpaper" type="button" class="text-button danger-text" @click="removeImage">Remove wallpaper on save</button>
        </template>
        <template v-if="draft.mode === 'image'">
          <label>Image fit<select v-model="draft.wallpaper_fit"><option value="cover">Cover</option><option value="contain">Contain</option><option value="tile">Tile / repeat</option><option value="center">Centre</option></select></label>
          <label>Wallpaper opacity · {{ draft.wallpaper_opacity }}%<input v-model.number="draft.wallpaper_opacity" type="range" min="0" max="100" /></label>
          <label>Dim wallpaper · {{ draft.wallpaper_dim }}%<input v-model.number="draft.wallpaper_dim" type="range" min="0" max="100" /></label>
          <label>Blur · {{ draft.wallpaper_blur }} px<input v-model.number="draft.wallpaper_blur" type="range" min="0" max="12" /></label>
        </template>
        <label>Variant effects<select v-model="draft.effects_mode"><option value="off">Off — keep badges only</option><option value="subtle">Subtle — static foil</option><option value="animated">Shimmer on hover / focus</option></select></label>
        <p class="data-note">Holo shimmers over the artwork. Reverse Holo adds patterned foil around it. Holo ex/EX cards get a full-face prismatic finish. Touchscreens show static foil.</p>
        <label class="checkbox-label"><input v-model="draft.print_background" type="checkbox" />Include background in print previews by default</label>
        <p class="data-note">Read-only sharing includes this background. Upload an image you have permission to use, without personal details. ex/EX/GX/V badges do not imply a foil finish.</p>
        <p v-if="conflict" class="alert warning">This binder changed. Reload the current appearance before saving; your unsaved appearance edits will be discarded.</p>
        <div class="button-row">
          <button v-if="conflict" class="button secondary" type="button" @click="reloadAppearance">Reload appearance</button>
          <button class="button primary" :disabled="busy || reading || conflict">{{ busy ? 'Saving…' : 'Save appearance' }}</button>
          <button type="button" class="button secondary" @click="resetStyle">Reset style</button>
        </div>
      </fieldset>
      <aside class="appearance-preview">
        <h3>Live preview</h3>
        <BinderSurface :binder="previewBinder" :preview-wallpaper="previewImage" :hide-wallpaper="removeWallpaper" class="single-page">
          <div class="binder-page"><div class="binder-page-heading"><span>YOUR BINDER</span><small>Sample pockets</small></div>
            <div class="pocket-grid preview-pockets">
              <div v-for="sample in samples" :key="sample.key + sample.name" class="pocket filled">
                <CardArtwork :card="{ ...sample, image_url: '/appearance-demo.svg' }" :printing="sample" :effects-mode="draft.effects_mode" :low="false" />
              </div>
            </div>
          </div>
        </BinderSurface>
        <p class="data-note">Sample artwork, not catalogue cards. Foil effects are decorative approximations, not scans of the physical finish. Motion is disabled when your device requests reduced motion.</p>
      </aside>
    </form>
  </AppModal>
</template>
