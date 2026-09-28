<script setup lang="ts">
const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  mail: 'M3 5h18v14H3Zm0 1 9 7 9-7',
  home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  cards: 'M7 3h13v17H7ZM3 7v15h13',
  binder: 'M5 3h15v18H5ZM5 7H2m3 5H2m3 5H2M9 3v18',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M10 15v6',
  plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6',
  search: 'M20 20 15 15M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  arrow: 'M5 12h14m-6-6 6 6-6 6', left: 'm15 5-7 7 7 7', right: 'm9 5 7 7-7 7',
  check: 'm4 12 5 5L20 6', star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  list: 'M7 5h14M7 12h14M7 19h14M3 5h.1M3 12h.1M3 19h.1',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  logout: 'M9 4H3v16h6m6-13 5 5-5 5M8 12h12',
  refresh: 'M20 9A8 8 0 0 0 6 5L3 8m0-5v5h5m-4 7a8 8 0 0 0 14 4l3-3m0 5v-5h-5',
  shield: 'm12 3 8 3v7c0 4-8 8-8 8s-8-4-8-8V6Zm-4 9 3 3 5-6',
  share: 'M8 11 16 6m-8 7 8 5M9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  print: 'M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6Z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  move: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4',
  cloud: 'M6 18a5 5 0 1 1 1-10 6 6 0 0 1 11-1 5 5 0 0 1 0 11H6',
  info: 'M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  link: 'm10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0'
}
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[props.name] || paths.cards" /></svg></template>
