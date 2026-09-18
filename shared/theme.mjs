/** @typedef {'light'|'dark'|'system'} ThemeMode */
export const THEME_STORAGE_KEY = 'cardshelf.theme';
export const THEME_MODES = Object.freeze(['light', 'dark', 'system']);
/** @param {unknown} value @returns {ThemeMode} */
export function themeMode(value) {
  return value === 'light' || value === 'dark' ? value : 'system';
}
/** @param {unknown} mode @param {boolean} prefersDark @returns {'light'|'dark'} */
export function resolvedTheme(mode, prefersDark) {
  const preference = themeMode(mode);
  return preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
}
