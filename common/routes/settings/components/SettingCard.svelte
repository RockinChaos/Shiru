<script>
  export let title = ''
  export let description = ''
</script>
<div class='bg-dark-light rounded px-20 py-10 d-flex flex-column flex-md-row align-items-md-center justify-content-between mb-15 wm-1200 w-full {$$restProps.class}'>
  <div class='mr-md-80 mb-5 mb-md-0'>
    <div class='font-size-16 font-weight-semi-bold select-text'>
      {title}
    </div>
    <div class='text-muted pre-wrap select-text'>
      {description}
    </div>
  </div>
  <slot />
</div>