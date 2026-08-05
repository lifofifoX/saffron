<script lang="ts">
  type Props = { class?: string; style?: string; sats?: boolean }
  let { class: className = '', style, sats = false }: Props = $props()
</script>

{#if sats}
  <svg
    viewBox="0 0 100 125"
    fill="currentColor"
    class="inline-block text-os-purple {className}"
    style="width: 1em; height: 1em; {style ?? ''}"
    aria-hidden="true"
  >
    <line
      x1="50"
      y1="8"
      x2="50"
      y2="117"
      stroke="currentColor"
      stroke-width="12"
      stroke-linecap="round"
    />
    <line
      x1="20"
      y1="35"
      x2="80"
      y2="35"
      stroke="currentColor"
      stroke-width="11"
      stroke-linecap="round"
    />
    <line
      x1="15"
      y1="62"
      x2="85"
      y2="62"
      stroke="currentColor"
      stroke-width="11"
      stroke-linecap="round"
    />
    <line
      x1="20"
      y1="89"
      x2="80"
      y2="89"
      stroke="currentColor"
      stroke-width="11"
      stroke-linecap="round"
    />
  </svg>
{:else}
  <i class="fa-brands fa-bitcoin text-os-orange {className}" {style}></i>
{/if}
