<script setup lang="ts">
definePageMeta({ layout: 'marketing' })
const { origin } = useMarketingSeo('Pokémon Arena — take your seat', 'Discover CardShelf Arena: a first-person Pokémon tabletop with guided training, computer practice, private matches and automatic rules for supported cards.', '/pokemon-arena')
useSeoMeta({ ogImage: origin + '/marketing/arena-table-1672.webp', ogImageWidth: 1672, ogImageHeight: 941, ogImageAlt: 'The CardShelf Arena tabletop with original training cards', twitterCard: 'summary_large_image', twitterImage: origin + '/marketing/arena-table-1672.webp' })
const modes = [
  { number: '01', label: 'LEARN AT YOUR PACE', title: 'Guided training', text: 'Start with illustrated Ember and Tide teaching decks. A coach takes you through setup, Energy, attacks, Prize cards and the decisions that shape a match.' },
  { number: '02', label: 'TRY YOUR NEXT IDEA', title: 'Computer practice', text: 'Practise with a saved deck or original training cards. Choose a matched, mirrored or saved opponent deck, with relaxed and standard computer settings.' },
  { number: '03', label: 'BRING A FRIEND', title: 'Private matches', text: 'Create a private table and share its invitation code with another eligible member. Approve their seat, ready your decks and play head to head.' }
]
const details = [
  { icon: 'cards', title: 'Your hand, within reach.', text: 'A large foreground hand keeps your next move close. Select a card, inspect its details and choose from its available moves.' },
  { icon: 'move', title: 'Make your move with confidence.', text: 'Highlighted targets guide supported plays. Drag a card or use Choose target, then review the move before confirming.' },
  { icon: 'grid', title: 'Read the whole table.', text: 'Active Pokémon, Bench, Stadium, decks, discards and Prize piles each have their place. Energy, damage and conditions stay with the cards.' },
  { icon: 'refresh', title: 'Follow the action.', text: 'Card movements, attack effects and turn cues make confirmed plays easier to follow. Open match history to see what happened.' },
  { icon: 'settings', title: 'Settle into your own pace.', text: 'Focus the table, adjust the optional audio and effects, or use reduced motion. Touch and keyboard controls work alongside mouse input.' },
  { icon: 'shield', title: 'Keep your hand private.', text: 'Your opponent sees face-down cards and public counts. Match cards stay separate from your collection—playing never transfers your collected cards.' }
]
const questions = [
  { q: 'Which cards can I play?', a: 'Arena is for Pokémon and uses a supported card pool. The deck builder checks every effect and explains unsupported cards. Reviewed Abilities, Tools, Stadiums, EX, ex and Mega Evolution cards are included where their full rules are supported. This is a casual format, not tournament legality certification.' },
  { q: 'Do I need to own the cards in my deck?', a: 'No. You can build a practice deck from supported imported catalogue cards without recording ownership. Original training decks are also available for solo modes. Playing does not change your collection quantities.' },
  { q: 'Does the game handle attacks and turns?', a: 'Yes. Turn draws, supported attacks and effects, damage, Knock Outs and Prize awards resolve automatically. You make the decisions when prompted, including choosing targets and replacement Pokémon.' },
  { q: 'Can I play on my phone?', a: 'Yes. The table adapts to a flat, readable layout on smaller screens. Scroll through your hand, tap to inspect and use the target controls or dedicated touch drag handle.' },
  { q: 'Is Arena included with a free account or beta invitation?', a: 'Arena has its own membership requirement: Collector, Collector Plus or an explicitly assigned Complimentary account. Free accounts and general tester access do not automatically include it. Arena must also be enabled by the site administrator.' }
]
</script>
<template>
  <section class="m-arena-landing">
    <div class="m-container m-arena-intro"><span class="m-eyebrow">CARDSHELF ARENA · POKÉMON</span><h1>Your deck.<br>Your next move.<br><em>Your seat at the table.</em></h1><p>Settle into a first-person tabletop made for playing. Learn the game, test a deck or invite a friend—with automatic rules for supported cards.</p><div class="m-actions"><NuxtLink to="/arena" class="m-button">Take your seat<AppIcon name="arrow" :size="18" /></NuxtLink><a href="#ways-to-play" class="m-button m-button-quiet">Find your way to play</a></div><p class="m-arena-member-note">For eligible Collector, Collector Plus and Complimentary accounts.</p></div>
    <div class="m-container"><MarketingArenaPreview eager /></div>
  </section>
  <section id="ways-to-play" class="m-container m-section"><div class="m-section-heading"><span class="m-eyebrow">THREE WAYS TO PLAY</span><h2>A first game. A fresh idea.<br>A friendly rivalry.</h2></div><div class="m-arena-modes"><article v-for="mode in modes" :key="mode.number"><span class="m-arena-mode-number">{{ mode.number }}</span><span class="m-eyebrow">{{ mode.label }}</span><h3>{{ mode.title }}</h3><p>{{ mode.text }}</p></article></div></section>
  <section class="m-arena-details"><div class="m-container"><div class="m-section-heading"><span class="m-eyebrow">A TABLE THAT FEELS LIKE A TABLE</span><h2>Warm light. Real texture.<br>A clear view of every move.</h2><p>A walnut frame, woven blue playmat and a softly lit collector room bring the new Arena to life.</p></div><div class="m-arena-detail-grid"><article v-for="detail in details" :key="detail.title"><AppIcon :name="detail.icon" :size="24" /><h3>{{ detail.title }}</h3><p>{{ detail.text }}</p></article></div></div></section>
  <div class="m-container m-arena-access-wrap"><MarketingArenaAccess /></div>
  <section class="m-container m-faq-section"><div><span class="m-eyebrow">BEFORE YOUR FIRST SHUFFLE</span><h2>A few good questions.</h2><p>Everything you need to know before taking your seat.</p><NuxtLink to="/early-access?purpose=support" class="m-text-link">Ask us a question<AppIcon name="arrow" :size="16" /></NuxtLink></div><div class="m-faq"><details v-for="question in questions" :key="question.q"><summary>{{ question.q }}<AppIcon name="plus" :size="18" /></summary><p>{{ question.a }}</p></details></div></section>
  <MarketingCta />
</template>
