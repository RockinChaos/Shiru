<script>
  export let images = []
  export let hidden = false
  export let color = null
  export let title = ''

  let index = 0
  let resolvedImages = []
  let failed = false
  $: if (images) { index = 0; resolvedImages = []; failed = false }
  $: filteredImages = images.filter(Boolean)
  $: loadNextImage(index, filteredImages)
  async function loadNextImage(index, filteredImages) {
    let image = filteredImages[index]
    try {
      if (typeof image === 'function') image = image()
      if (image && typeof image.then === 'function') image = await image
      if (Array.isArray(image)) {
        filteredImages.splice(index, 1, ...image.filter(Boolean))
        image = filteredImages[index]
      }
    } catch { image = `${index}_404.jpg` }
    resolvedImages[index] = image
  }
  function handleError() {
    if (index < filteredImages.filter(Boolean).length - 1) index += 1
    else failed = true
  }
  function validate(event) {
    const image = event.target
    if (/ytimg\.com|youtube\.com|youtube-nocookie\.com|youtu\.be/i.test(image.currentSrc || image.src) && image.naturalWidth === 120 && image.naturalHeight === 90) handleError()
  }
</script>
<img class={$$restProps.class ? $$restProps.class.split(' ').filter(_class => (_class !== 'cover-rotated' && _class !== 'cr-380' && _class !== 'cr-400') || !resolvedImages[index]?.includes('404')).join(' ') : ''} style={(color ? `--color: ${color};` : '')} class:d-none={hidden || failed} src={!hidden && !failed ? (resolvedImages[index] || `${index}_404.jpg`) : `${index}_404.jpg`} alt='preview' title={title} draggable='false' loading='lazy' referrerpolicy='no-referrer' on:error={handleError} on:load={validate} />