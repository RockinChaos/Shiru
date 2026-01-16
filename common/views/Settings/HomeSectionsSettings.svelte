<script>
  import { click } from '@/modules/click.js'
  import { SUPPORTS } from '@/modules/support.js'
  import { sections } from '@/modules/sections.js'
  import { ArrowDownUp, Trash2 } from 'lucide-svelte'
  import CustomDropdown from '@/components/CustomDropdown.svelte'

  $: allowedHomeSections = $sections.map(({ title, sort, format }) => [title, sort, format])
  export let homeSections

  let touchStartY = null
  let isDraggingTouch = false
  let mouseYCoordinate = null
  let controlDragging = false
  let draggingItem = null
  let draggingItemIndex = null
  let hoveredItemIndex = null
  let lastProcessedHoverIndex = null
  let distanceTopGrabbedVsPointer = null

  $: {
    if (draggingItemIndex != null && hoveredItemIndex != null && draggingItemIndex !== hoveredItemIndex && lastProcessedHoverIndex !== hoveredItemIndex) {
      swapItem(draggingItemIndex, hoveredItemIndex)
      lastProcessedHoverIndex = hoveredItemIndex
      draggingItemIndex = hoveredItemIndex
    }
  }

  function swapItem(fromIndex, toIndex) {
    toIndex = Math.min(homeSections.length - 1, Math.max(0, toIndex))
    const [item] = homeSections.splice(fromIndex, 1)
    homeSections.splice(toIndex, 0, item)
    homeSections = [...homeSections]
  }

  function updateGhostPosition() {
    setTimeout(() => {
      const element = document.querySelector(`[data-drag-index='${draggingItemIndex}']`)
      if (element) {
        const rowElement = element.closest('.d-flex')
        if (rowElement) {
          distanceTopGrabbedVsPointer = rowElement.offsetTop
        }
      }
    })
  }

  function calculateHoverIndexFromY(clientY) {
    let closestIndex = null
    let closestDistance = Infinity
    document.querySelectorAll('[data-drag-index]').forEach((el) => {
      const rect = el.getBoundingClientRect()
      const distance = Math.abs(clientY - (rect.top + rect.height / 2))
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = parseInt(el.getAttribute('data-drag-index'))
      }
    })
    return closestIndex
  }

  function handleKeyDown(event, index, item) {
    if (event.key === 'Escape' && controlDragging) {
      event.preventDefault()
      controlDragging = false
      draggingItem = null
      draggingItemIndex = null
      hoveredItemIndex = null
      lastProcessedHoverIndex = null
      return
    }

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (controlDragging && draggingItemIndex === index) {
        controlDragging = false
        draggingItem = null
        draggingItemIndex = null
        hoveredItemIndex = null
        lastProcessedHoverIndex = null
      } else {
        controlDragging = true
        mouseYCoordinate = null
        draggingItem = item
        draggingItemIndex = index
        updateGhostPosition()
      }
      return
    }

    if (controlDragging && draggingItemIndex === index) {
      if (event.key.startsWith('Arrow') || event.key === 'Tab' || event.key === 'Home' || event.key === 'End' || event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault()
        event.stopPropagation()
      }
      if (event.key === 'ArrowUp' && index > 0) {
        swapItem(index, index - 1)
        draggingItemIndex = index - 1
        updateGhostPosition()
        setTimeout(() => document.querySelector(`[data-drag-index='${draggingItemIndex}']`)?.focus())
      } else if (event.key === 'ArrowDown' && index < homeSections.length - 1) {
        swapItem(index, index + 1)
        draggingItemIndex = index + 1
        updateGhostPosition()
        setTimeout(() => document.querySelector(`[data-drag-index='${draggingItemIndex}']`)?.focus())
      }
    }
  }

  function handleTouchEnd() {
    if (!isDraggingTouch) return
    mouseYCoordinate = null
    draggingItem = null
    draggingItemIndex = null
    hoveredItemIndex = null
    lastProcessedHoverIndex = null
    isDraggingTouch = false
    touchStartY = null
  }

  function getListBounds() {
    const firstElement = document.querySelector('[data-drag-index="0"]')
    const lastElement = document.querySelector(`[data-drag-index="${homeSections.length - 1}"]`)
    if (!firstElement || !lastElement) return null
    const firstRow = firstElement.closest('.d-flex')
    const lastRow = lastElement.closest('.d-flex')
    if (!firstRow || !lastRow) return null
    return { top: firstRow.offsetTop, bottom: lastRow.offsetTop }
  }

  function clampYCoordinate(y) {
    if (distanceTopGrabbedVsPointer == null) return y
    const bounds = getListBounds()
    if (!bounds) return y
    return Math.max(bounds.top, Math.min(bounds.bottom, y + distanceTopGrabbedVsPointer)) - distanceTopGrabbedVsPointer
  }
</script>

{#if mouseYCoordinate || controlDragging}
  <div class='input-group mb-10 ghost w-full' style='top: {mouseYCoordinate + distanceTopGrabbedVsPointer}px;'>
    <div class='input-group-prepend'>
      <span class='input-group-text d-flex align-items-center px-5'><ArrowDownUp size='1.8rem' /></span>
    </div>
    <select class='form-control'></select>
    <select class='form-control'></select>
    <select class='form-control'></select>
    <div class='input-group-append'>
      <button type='button' class='btn btn-danger btn-square input-group-append px-5 d-flex align-items-center'><Trash2 size='1.8rem' /></button>
    </div>
  </div>
{/if}
{#each homeSections as item, index}
  {#if index === 0}
    <div class='d-flex mb-5 w-509 mw-full'>
      <div class='flex-shrink-1 w-150 font-size-16 text-center font-weight-bold' style='margin-left: 2.5rem'>Section</div>
      <div class='flex-shrink-1 w-150 font-size-16 text-center font-weight-bold'>Sort</div>
      <div class='flex-shrink-1 w-150 ml-10 font-size-16 text-center font-weight-bold'>Format</div>
      <div class='flex-shrink-1 font-size-16 text-center font-weight-bold' style='width: 3rem'>&nbsp;</div>
    </div>
  {/if}
  <div class='d-flex mb-10 w-509 mw-full not-reactive' class:tp={draggingItem === item} role='menuitem' tabindex='-1'>
    <div class='input-group-prepend grab touch-none' class:tp={draggingItem === item} draggable='true' role='button' tabindex='0' data-drag-index={index} aria-label={controlDragging && draggingItemIndex === index ? 'Dragging. Use arrow keys to move, Space or Enter to drop, Escape to cancel' : 'Press Space or Enter to start dragging'}
         on:dragstart={({ clientY, target }) => { if (!SUPPORTS.isAndroid) { mouseYCoordinate = clientY; draggingItem = item; draggingItemIndex = index; distanceTopGrabbedVsPointer = target.offsetTop - clientY } }}
         on:drag={e => { if (e.clientY !== 0 && !SUPPORTS.isAndroid) { mouseYCoordinate = clampYCoordinate(e.clientY); hoveredItemIndex = calculateHoverIndexFromY(e.clientY) } }}
         on:dragend={() => { if (!SUPPORTS.isAndroid) { mouseYCoordinate = null; draggingItem = null; hoveredItemIndex = null; lastProcessedHoverIndex = null } }}
         on:touchstart={e => { const touch = e.touches[0]; touchStartY = touch.clientY; isDraggingTouch = true; mouseYCoordinate = touch.clientY; draggingItem = item; draggingItemIndex = index; distanceTopGrabbedVsPointer = e.currentTarget.offsetTop - touch.clientY }}
         on:touchmove={e => { if (!isDraggingTouch) return; const touch = e.touches[0]; mouseYCoordinate = clampYCoordinate(touch.clientY); hoveredItemIndex = calculateHoverIndexFromY(touch.clientY) }}
         on:touchend={handleTouchEnd}
         on:touchcancel={handleTouchEnd}
         on:keydown={e => handleKeyDown(e, index, item)}>
      <span class='input-group-text d-flex align-items-center px-5'>
        <ArrowDownUp size='1.8rem' />
      </span>
    </div>
    <div class='position-relative flex-shrink-1 w-170 mw-full'>
      <select class='form-control flex-shrink-1 bg-dark fix-border text-truncate w-full' on:change={(event) => { if (event.target.value !== homeSections[index][0]) homeSections[index] = allowedHomeSections.find(([title]) => title === event.target.value) }} bind:value={homeSections[index][0]}>
        {#each allowedHomeSections as section}
          {#if !homeSections.some(([title]) => title === section[0]) || homeSections[index][0] === section[0]}
            <option>{section[0]}</option>
          {/if}
        {/each}
      </select>
    </div>
    <div class='position-relative flex-shrink-1 w-150 bg-dark mw-full'>
      {(homeSections[index][1]?.includes('N/A') && homeSections[index][1] !== 'N/A') ? (homeSections[index][1] = 'N/A') : ''} <!-- hack because shit be weird sometimes -->
      <select class='form-control bg-dark fix-border text-truncate' bind:value={homeSections[index][1]} disabled={homeSections[index][1]?.includes('N/A')}>
        <option value='N/A' selected hidden>N/A</option>
        <option value='TRENDING_DESC'>Trending</option>
        <option value='POPULARITY_DESC'>Popularity</option>
        <option value='TITLE_ROMAJI'>Title</option>
        <option value='SCORE_DESC'>Score</option>
        <option value='START_DATE_DESC'>Release Date</option>
        {#if homeSections[index][0].match(/(Continue Watching|(?:Re)?watching List|Completed List|Paused List|Planning List|Dropped List)/i)}
          {#if homeSections[index][0].match(/Completed List/i)}
            <option value='FINISHED_ON_DESC'>Completed Date</option>
          {/if}
          {#if !homeSections[index][0].match(/Planning List/i)}
            <option value='STARTED_ON_DESC'>Start Date</option>
          {/if}
          <option value='UPDATED_TIME_DESC'>Last Updated</option>
          {#if !homeSections[index][0].match(/(Completed|Planning) List/i)}
            <option value='PROGRESS_DESC'>Your Progress</option>
          {/if}
          {#if homeSections[index][0].match(/(Completed|Dropped) List/i)}
            <option value='USER_SCORE_DESC'>Your Score</option>
          {/if}
        {/if}
      </select>
    </div>
    <div class='position-relative flex-shrink-1 w-150 bg-dark'>
      <CustomDropdown id={`format-hs-${index}`} options={{ TV: 'TV Show', MOVIE: 'Movie', TV_SHORT: 'TV Short', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA' }} bind:value={homeSections[index][2]} disabled={homeSections[index][2]?.includes('N/A')}/>
    </div>
    <div class='input-group-append'>
      <button type='button' use:click={() => { homeSections.splice(index, 1); homeSections = homeSections }} class='btn btn-danger btn-square input-group-append px-5 d-flex align-items-center'><Trash2 size='1.8rem' /></button>
    </div>
  </div>
{/each}
<button type='button' class='btn btn-primary d-flex align-items-center justify-content-center' disabled={allowedHomeSections.every(([title]) => homeSections.some(([existingTitle]) => existingTitle === title))} use:click={() => { const remainingSections = allowedHomeSections.filter(([title]) => !homeSections.some(([existingTitle]) => existingTitle === title)); if (remainingSections.length > 0) homeSections = [...homeSections, remainingSections[Math.floor(Math.random() * remainingSections.length)]] }}><span>Add Section</span></button>

<style>
  .w-509 {
    width: 50.9rem;
  }
  .fix-border {
    border-radius: 0 !important;
  }
  .ghost {
    margin-bottom: 10px;
    pointer-events: none;
    z-index: 9999;
    position: absolute !important;
  }
  .tp {
    opacity: 0;
  }
</style>