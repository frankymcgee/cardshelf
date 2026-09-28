<script setup lang="ts">
const { state: pwa } = usePwa()
const { loading, busy, enabled, supported, available, workerReady, permission, preferences, error, notice, conflict, load, enable, disable, save, testNotification } = usePushNotifications()
const needsInstall = computed(() => pwa.value.ios && !pwa.value.installed)
useSeoMeta({ title: 'App & notifications · CardShelf', robots: 'noindex, nofollow' })
</script>
<template>
  <div class="device-settings">
    <header class="page-heading"><div><span class="eyebrow">MORE · YOUR DEVICE</span><h1>App & notifications</h1><p>Keep your collection close. Choose the updates you want on this device.</p></div></header>
    <InstallPrompt />
    <section class="panel push-panel spaced" aria-labelledby="push-heading">
      <div class="section-heading"><div><h2 id="push-heading">Push notifications</h2><p>Updates can arrive even when CardShelf is closed.</p></div><span class="badge" :class="{ green: enabled }">{{ enabled ? 'On for this device' : 'Off for this device' }}</span></div>
      <p v-if="loading" role="status">Checking this device…</p>
      <p v-else-if="needsInstall" class="alert info">Add CardShelf to your Home Screen, open it from the new icon, and return here to turn on notifications. Requires iOS / iPadOS 16.4 or later.</p>
      <p v-else-if="!supported" class="alert info">{{ !pwa.secure ? 'Open CardShelf over HTTPS to enable notifications.' : 'This browser does not support push notifications. Try an up-to-date browser or the installed CardShelf app.' }}</p>
      <template v-else>
        <p v-if="!available && !error" class="alert info">Your server needs a public HTTPS address before notifications can be enabled. Ask your administrator to check the site address.</p>
        <p v-if="permission === 'denied'" class="alert info">Notifications are blocked for CardShelf. Allow them in your browser’s site settings or your device’s notification settings, then select Check again.</p>
        <form @submit.prevent="enabled ? save() : enable()">
          <fieldset :disabled="busy || loading || conflict || !available || !workerReady"><legend class="visually-hidden">Updates on this device</legend>
            <label class="push-choice"><span><strong>Marketplace messages</strong><small>New enquiries about your listings and replies to your conversations.</small></span><input v-model="preferences.marketplace" type="checkbox" /></label>
            <label class="push-choice"><span><strong>Membership updates</strong><small>Updates when an administrator changes your membership assignment.</small></span><input v-model="preferences.membership" type="checkbox" /></label>
          </fieldset>
          <p class="small muted push-privacy">Private message text is never included in notifications. Preferences apply to this device; email preferences are separate. Signing out turns push notifications off for this sign-in.</p>
          <div class="button-row"><button v-if="enabled" type="submit" class="button primary" :disabled="busy || conflict">Save preferences</button><button v-else-if="available && workerReady && permission !== 'denied'" type="submit" class="button primary" :disabled="busy">{{ busy ? 'Enabling…' : 'Enable notifications' }}</button><button v-if="enabled" type="button" class="button secondary" :disabled="busy" @click="testNotification">Send test notification</button><button v-if="enabled" type="button" class="text-button" :disabled="busy" @click="disable">Turn off on this device</button></div>
        </form>
      </template>
      <p v-if="error" class="alert error spaced" role="alert">{{ error }}</p><p v-if="notice" class="alert info spaced" role="status">{{ notice }}</p>
      <button v-if="!loading && !needsInstall && supported" type="button" class="text-button spaced" :disabled="busy" @click="load">{{ conflict ? 'Reload saved preferences' : 'Check again' }}</button>
    </section>
    <p class="small muted spaced">Looking for inbox updates? <NuxtLink to="/emails">Manage email preferences</NuxtLink>.</p>
  </div>
</template>
<style scoped>
.device-settings{max-width:900px}.push-panel{padding:26px}.push-panel h2{font-size:21px}.push-panel .section-heading{align-items:flex-start;gap:16px;flex-wrap:wrap}.push-panel .section-heading p{font-size:13px;color:var(--muted);margin-bottom:0}.push-panel fieldset{border:0;padding:0;margin:0;min-width:0}.push-choice{display:flex;align-items:center;gap:20px;justify-content:space-between;border-top:1px solid var(--line);padding:22px 0;cursor:pointer}.push-choice span{flex:1}.push-choice strong{display:block;font-size:15px}.push-choice small{display:block;margin-top:7px;color:var(--muted);font-size:13px;font-weight:400;line-height:1.7}.push-choice input{width:24px;height:24px;flex-shrink:0}.push-privacy{line-height:1.8;margin:0 0 22px}.push-panel button{min-height:44px}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(max-width:480px){.push-panel{padding:20px}.push-panel .button-row{align-items:stretch;flex-direction:column}.push-panel .button-row button{justify-content:center}}
</style>
