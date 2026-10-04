<script setup lang="ts">
import { appearanceDefaults, resolvedAppearance } from '../../shared/appearance.mjs'
const props = defineProps<{ open: boolean; binder: any }>()
const emit = defineEmits(['close', 'saved'])
const api = useApi(), notice = useNotice()
const draft = reactive<any>({}), snapshot = ref<any>(null), busy = ref(false), reading = ref(false), conflict = ref(false)
type Surface = 'inside' | 'cover'
const surface = ref<Surface>('inside'), coverColor = ref('#5546d8'), fileInput = ref<HTMLInputElement>()
const emptyUpload = () => ({ wallpaper: null as { content_type: string; data_base64: string } | null, preview: '', remove: false, name: '' })
const uploads = reactive({ inside: emptyUpload(), cover: emptyUpload() })
const upload = computed(() => uploads[surface.value])
const storedImage = computed(() => surface.value === 'cover' ? snapshot.value?.cover_wallpaper_version : snapshot.value?.wallpaper_version)
function setting(key: string) {
  return computed({ get: () => draft[(surface.value === 'cover' ? 'cover_' : '') + key],
    set: value => { draft[(surface.value === 'cover' ? 'cover_' : '') + key] = value } })
}
const backgroundMode = setting('mode'), imageFit = setting('wallpaper_fit'), imageOpacity = setting('wallpaper_opacity')
const imageDim = setting('wallpaper_dim'), imageBlur = setting('wallpaper_blur')
const backgroundColor = computed({ get: () => surface.value === 'cover' ? coverColor.value : draft.background_color,
  set: value => { if (surface.value === 'cover') coverColor.value = value; else draft.background_color = value } })
let sequence = 0
function initialise(binder: any) {
  sequence++; snapshot.value = binder; Object.assign(draft, resolvedAppearance(binder.appearance, binder.color))
  coverColor.value = binder.color || '#5546d8'
  uploads.inside = emptyUpload(); uploads.cover = emptyUpload(); conflict.value = false; reading.value = false
  if (fileInput.value) fileInput.value.value = ''
}
watch(() => props.open, open => { if (open && props.binder) { surface.value = 'inside'; initialise(props.binder) }
  else { sequence++; uploads.inside = emptyUpload(); uploads.cover = emptyUpload(); reading.value = false } }, { immediate: true })
onBeforeUnmount(() => { sequence++ })
const previewBinder = computed(() => ({ ...snapshot.value, color: coverColor.value, appearance: { ...draft } }))
const samples = [
  { name: 'Holo preview', key: 'holo', label: 'Holo', source: 'tcgdex' },
  { name: 'Reverse preview', key: 'reverse', label: 'Reverse Holo', source: 'tcgdex' },
  { name: 'Example ex', key: 'holo', label: 'Holo', source: 'tcgdex' }
]
async function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const request = ++sequence, target = surface.value
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
    uploads[target] = { wallpaper: { content_type: file.type, data_base64: data.slice(data.indexOf(',') + 1) },
      preview: data, remove: false, name: file.name }
    draft[target === 'cover' ? 'cover_mode' : 'mode'] = 'image'
  } catch (e) { if (request === sequence) notice.show(errorMessage(e), 'error') }
  finally { if (request === sequence) reading.value = false }
}
function removeImage() {
  sequence++; reading.value = false; uploads[surface.value] = { ...emptyUpload(), remove: true }; backgroundMode.value = 'color'
  if (fileInput.value) fileInput.value.value = ''
}
function resetStyle() {
  const cover = surface.value === 'cover'
  for (const [key, value] of Object.entries(appearanceDefaults(snapshot.value.color))) {
    if (key.startsWith('cover_') === cover) draft[key] = value
  }
  if (cover) coverColor.value = snapshot.value.color
}
async function reloadAppearance() {
  busy.value = true
  try { initialise(await api('/api/binders/' + props.binder.id)); emit('saved') }
  catch (e) { notice.show(errorMessage(e), 'error') } finally { busy.value = false }
}
async function save() {
  busy.value = true
  try {
    await api('/api/binders/' + snapshot.value.id + '/appearance', { method: 'PATCH', body: {
      revision: snapshot.value.revision, appearance: { ...draft }, cover_color: coverColor.value,
      remove_wallpaper: uploads.inside.remove, remove_cover_wallpaper: uploads.cover.remove,
      ...(uploads.inside.wallpaper ? { wallpaper: uploads.inside.wallpaper } : {}),
      ...(uploads.cover.wallpaper ? { cover_wallpaper: uploads.cover.wallpaper } : {})
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
        <div class="appearance-surfaces" role="group" aria-label="Binder surface">
          <button type="button" :aria-pressed="surface === 'inside'" @click="surface = 'inside'">Inside pages</button>
          <button type="button" :aria-pressed="surface === 'cover'" @click="surface = 'cover'">Outside cover</button>
        </div>
        <p class="data-note">{{ surface === 'cover' ? 'Style the outside of your binder. This cover appears on your shelf, overview and shared binder.' : 'Style the pages behind your cards and their pockets.' }} Each surface has its own colour and image.</p>
        <div class="form-columns">
          <label>{{ surface === 'cover' ? 'Cover background' : 'Background' }}<select v-model="backgroundMode"><option value="color">Solid colour</option><option value="image">Wallpaper</option></select></label>
          <label>{{ surface === 'cover' ? 'Cover colour' : 'Background colour' }}<input v-model="backgroundColor" type="color" /></label>
          <label v-if="surface === 'inside'">Pocket colour<input v-model="draft.pocket_color" type="color" /></label>
        </div>
        <label v-if="surface === 'inside'">Pocket opacity · {{ draft.pocket_opacity }}%<input v-model.number="draft.pocket_opacity" type="range" min="0" max="100" /></label>
        <template v-if="backgroundMode === 'image' || storedImage || upload.wallpaper">
          <label>{{ surface === 'cover' ? 'Cover wallpaper image' : 'Wallpaper image' }}<input :key="surface" ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" @change="chooseFile" /><small>JPEG, PNG or WebP · up to 5 MB / 20 megapixels per image. Saved when you select Save appearance.</small></label>
          <p v-if="upload.name" class="small muted">Selected: {{ upload.name }}</p>
          <button v-if="(storedImage || upload.wallpaper) && !upload.remove" type="button" class="text-button danger-text" @click="removeImage">{{ surface === 'cover' ? 'Remove cover wallpaper on save' : 'Remove wallpaper on save' }}</button>
          <p v-if="upload.remove" class="small muted">This image will be removed when you save.</p>
        </template>
        <template v-if="backgroundMode === 'image'">
          <label>Image fit<select v-model="imageFit"><option value="cover">Cover</option><option value="contain">Contain</option><option value="tile">Tile / repeat</option><option value="center">Centre</option></select></label>
          <label>Wallpaper opacity · {{ imageOpacity }}%<input v-model.number="imageOpacity" type="range" min="0" max="100" /></label>
          <label>Dim wallpaper · {{ imageDim }}%<input v-model.number="imageDim" type="range" min="0" max="100" /></label>
          <label>Blur · {{ imageBlur }} px<input v-model.number="imageBlur" type="range" min="0" max="12" /></label>
        </template>
        <template v-if="surface === 'inside'">
        <label>Variant effects<select v-model="draft.effects_mode"><option value="off">Off — keep badges only</option><option value="subtle">Subtle — static foil</option><option value="animated">Shimmer on hover / focus</option></select></label>
        <p class="data-note">Holo shimmers over the artwork. Reverse Holo adds patterned foil around it. Holo ex/EX cards get a full-face prismatic finish. Touchscreens show static foil.</p>
        <label class="checkbox-label"><input v-model="draft.print_background" type="checkbox" />Include background in print previews by default</label>
        </template>
        <p class="data-note">Read-only sharing includes your cover and inside background. Upload images you have permission to use, without personal details.</p>
        <p v-if="conflict" class="alert warning">This binder changed. Reload the current appearance before saving; your unsaved appearance edits will be discarded.</p>
        <div class="button-row">
          <button v-if="conflict" class="button secondary" type="button" @click="reloadAppearance">Reload appearance</button>
          <button class="button primary" :disabled="busy || reading || conflict">{{ busy ? 'Saving…' : 'Save appearance' }}</button>
          <button type="button" class="button secondary" @click="resetStyle">{{ surface === 'cover' ? 'Reset cover style' : 'Reset inside style' }}</button>
        </div>
      </fieldset>
      <aside class="appearance-preview">
        <h3>{{ surface === 'cover' ? 'Outside cover preview' : 'Inside pages preview' }}</h3>
        <BinderCover v-if="surface === 'cover'" :binder="previewBinder" :preview-wallpaper="uploads.cover.preview" :hide-wallpaper="uploads.cover.remove" class="appearance-cover-preview" />
        <BinderSurface v-else :binder="previewBinder" :preview-wallpaper="uploads.inside.preview" :hide-wallpaper="uploads.inside.remove" class="single-page">
          <div class="binder-page"><div class="binder-page-heading"><span>YOUR BINDER</span><small>Sample pockets</small></div>
            <div class="pocket-grid preview-pockets">
              <div v-for="sample in samples" :key="sample.key + sample.name" class="pocket filled">
                <CardArtwork :card="{ ...sample, image_url: '/appearance-demo.svg' }" :printing="sample" :effects-mode="draft.effects_mode" :low="false" />
              </div>
            </div>
          </div>
        </BinderSurface>
        <p v-if="surface === 'inside'" class="data-note">Sample artwork, not catalogue cards. Foil effects are decorative approximations, not scans of the physical finish. Motion is disabled when your device requests reduced motion.</p>
      </aside>
    </form>
  </AppModal>
</template>
