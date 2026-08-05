<script lang="ts">
  import { toasts } from '$lib/stores/ui'

  const typeStyles = {
    success: 'bg-os-success-muted border-os-success/50 text-os-success',
    error: 'bg-os-error-muted border-os-error/50 text-os-error',
    info: 'bg-orange-500/20 border-orange-500/50 text-orange-400',
  } as const satisfies Record<'success' | 'error' | 'info', string>

  const typeIcons = {
    success: 'fa-solid fa-circle-check',
    error: 'fa-solid fa-circle-xmark',
    info: 'fa-solid fa-circle-info',
  } as const satisfies Record<'success' | 'error' | 'info', string>
</script>

<div class="fixed bottom-6 right-6 z-[100] space-y-3">
  {#each $toasts as toast (toast.id)}
    <div
      class="flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm {typeStyles[
        toast.type
      ]} animate-slide-in"
    >
      <i class={typeIcons[toast.type]}></i>
      <span class="text-sm font-medium text-white">{toast.message}</span>
    </div>
  {/each}
</div>

<style>
  @keyframes slide-in {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  .animate-slide-in {
    animation: slide-in 0.3s ease-out;
  }
</style>
