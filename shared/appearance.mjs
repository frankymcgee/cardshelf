// Shared, dependency-free presentation rules. Never accept CSS or image URLs from settings.
export const EFFECT_MODES = ['off', 'subtle', 'animated'];
export const WALLPAPER_FITS = ['cover', 'contain', 'tile', 'center'];
export const isHexColour = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function appearanceDefaults(colour = '#5546d8') {
  return { mode: 'color', background_color: isHexColour(colour) ? colour : '#5546d8',
    pocket_color: '#f3f3f7', pocket_opacity: 85, wallpaper_fit: 'cover',
    wallpaper_opacity: 80, wallpaper_dim: 15, wallpaper_blur: 0,
    effects_mode: 'subtle', print_background: false,
    cover_mode: 'color', cover_wallpaper_fit: 'cover', cover_wallpaper_opacity: 100,
    cover_wallpaper_dim: 15, cover_wallpaper_blur: 0 };
}
export function resolvedAppearance(value, colour = '#5546d8') {
  const defaults = appearanceDefaults(colour), o = value && typeof value === 'object' ? value : {};
  // Defensive reading for older/imported database records; the write endpoint validates strictly.
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const v = o[key];
    if (key.endsWith('_color')) return [key, isHexColour(v) ? v : fallback];
    if (key === 'mode' || key === 'cover_mode') return [key, ['color','image'].includes(v) ? v : fallback];
    if (key.endsWith('wallpaper_fit')) return [key, WALLPAPER_FITS.includes(v) ? v : fallback];
    if (key === 'effects_mode') return [key, EFFECT_MODES.includes(v) ? v : fallback];
    if (typeof fallback === 'boolean') return [key, typeof v === 'boolean' ? v : fallback];
    return [key, Number.isInteger(v) && v >= 0 && v <= (key.endsWith('wallpaper_blur') ? 12 : 100) ? v : fallback];
  }));
}
export function colourChannels(colour) {
  const hex = isHexColour(colour) ? colour : '#f3f3f7';
  return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
}
export function contrastingText(colour) {
  const linear = colourChannels(colour).map(n => { const c=n/255; return c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4; });
  return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722 > 0.179 ? '#172032' : '#ffffff';
}
export function wallpaperUrl(binder, shareToken = '', surface = 'inside') {
  if (!['inside', 'cover'].includes(surface)) return '';
  const version = surface === 'cover' ? binder?.cover_wallpaper_version : binder?.wallpaper_version;
  const endpoint = surface === 'cover' ? 'cover-wallpaper' : 'wallpaper';
  if (!/^[a-f0-9]{64}$/.test(version ?? '')) return '';
  if (shareToken && !/^[a-f0-9]{64}$/.test(shareToken)) return '';
  if (shareToken) return `/api/shared/${shareToken}/${endpoint}?v=${version}`;
  if (!/^[a-f0-9-]{36}$/i.test(binder?.id ?? '')) return '';
  return `/api/binders/${binder.id}/${endpoint}?v=${version}`;
}
export function coverAppearance(binder) {
  const value = resolvedAppearance(binder?.appearance, binder?.color);
  return { mode: value.cover_mode, background_color: isHexColour(binder?.color) ? binder.color : '#5546d8',
    wallpaper_fit: value.cover_wallpaper_fit, wallpaper_opacity: value.cover_wallpaper_opacity,
    wallpaper_dim: value.cover_wallpaper_dim, wallpaper_blur: value.cover_wallpaper_blur };
}
