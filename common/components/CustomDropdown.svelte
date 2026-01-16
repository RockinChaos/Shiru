<script>
    import { writable } from 'simple-store-svelte'
    import { click } from '@/modules/click.js'
    import { createListener } from '@/modules/util.js'

    export let id
    export let form = null
    export let value
    export let altValue = null
    export let constrainAlt = true
    export let headers = null
    export let options
    export let arrayValue = true
    export let displaySize = 20
    export let disabled = false

    function getOptions() {
        if (Array.isArray(options) && options.every(item => typeof item === 'string' || typeof item === 'number')) return options
        else if (typeof options === 'object' && options != null) return Object.keys(options)
        throw new Error('Invalid list format')
    }

    function getOptionDisplay(option) {
        if (Array.isArray(options) && options.every(item => typeof item === 'string' || typeof item === 'number')) return String(option)
        else if (typeof options === 'object' && options != null) return options.hasOwnProperty(option) ? options[option] : null
    }

    const dropdown = writable(false)
    function createDropdownListener() {
        const { reactive, init } = createListener([`custom-menu-${id}`])
        init(true, true)
        reactive.subscribe(value => {
            if (!value) {
                dropdown.update(() => {
                    init(false, true)
                    searchTextInput = ''
                    return false
                })
            }
        })
    }

    function includes(value1, value2) {
        return arrayValue ? value1?.includes(value2) : String(value1)?.includes(String(value2))
    }

    let searchTextInput = ''
    function filterTags(event, trigger) {
        const textValue = event.target.value
        const isAlt = textValue.startsWith('!')
        const inputValue = isAlt ? textValue.slice(1) : textValue
        let bestMatch = getOptions().find(item => getOptionDisplay(item)?.toLowerCase() === inputValue.toLowerCase())
        let found = false
        if ((trigger === 'keydown' && (event.key === 'Enter' || event.code === 'Enter')) || (trigger === 'input' && bestMatch)) {
            if (!bestMatch || inputValue.endsWith('*')) bestMatch = (inputValue.endsWith('*') && inputValue.slice(0, -1)) || getOptions().find(item => getOptionDisplay(item)?.toLowerCase().startsWith(inputValue.toLowerCase())) || getOptions().find(item => getOptionDisplay(item)?.toLowerCase().endsWith(inputValue.toLowerCase()))
            let targetValue = isAlt ? altValue : value
            let oppositeValue = isAlt ? value : altValue
            if (bestMatch && (!targetValue || !includes(targetValue, bestMatch))) {
                if (isAlt) altValue = arrayValue ? [...targetValue, bestMatch] : bestMatch
                else value = arrayValue ? [...targetValue, bestMatch] : bestMatch
                if (oppositeValue && constrainAlt) {
                    if (isAlt) value = arrayValue ? [] : null
                    else altValue = arrayValue ? [] : null
                }
                else if (includes(oppositeValue, bestMatch)) {
                    if (isAlt) value = arrayValue ? oppositeValue.filter(item => item !== bestMatch) : null
                    else altValue = arrayValue ? oppositeValue.filter(item => item !== bestMatch) : null
                }
                searchTextInput = ''
                found = true
                setTimeout(() => form?.dispatchEvent(new Event('input', { bubbles: true })))
            } else if (bestMatch)  {
                const tagIndex = targetValue?.indexOf(bestMatch)
                if (tagIndex > -1) {
                    if (isAlt) altValue = arrayValue ? [...targetValue.slice(0, tagIndex), ...targetValue.slice(tagIndex + 1)] : bestMatch
                    else value = arrayValue ? [...targetValue.slice(0, tagIndex), ...targetValue.slice(tagIndex + 1)] : bestMatch
                    if (oppositeValue && constrainAlt) {
                        if (isAlt) value = arrayValue ? [] : null
                        else altValue = arrayValue ? [] : null
                    }
                    else if (includes(oppositeValue, bestMatch)) {
                        if (isAlt) value = arrayValue ? oppositeValue.filter(item => item !== bestMatch) : null
                        else altValue = arrayValue ? oppositeValue.filter(item => item !== bestMatch) : null
                    }
                    searchTextInput = ''
                    found = true
                    setTimeout(() => form?.dispatchEvent(new Event('input', { bubbles: true })))
                }
            }
        }
        if (!found && !(event.key === 'Tab' || event.code === 'Tab') && !dropdown.value) {
            dropdown.update(() => {
                createDropdownListener()
                searchTextInput = ''
                return true
            })
        }
    }

    let shown = new Set()
    $: if ($dropdown || searchTextInput || value || altValue) shown = new Set()

    const headerEntries = Object.entries(headers || {})
    const headerSections = []
    for (let i = 0; i < headerEntries.length; i++) {
        const [startValue, headerLabel] = headerEntries[i]
        const startIndex = getOptions().indexOf(startValue)
        const endIndex = i + 1 < headerEntries.length ? getOptions().indexOf(headerEntries[i + 1][0]) : getOptions().length
        if (startIndex !== -1) headerSections.push({header: headerLabel, start: startIndex, end: endIndex})
    }

    function toggleDropdown() {
        dropdown.update(state => {
            if (!state) createDropdownListener()
            searchTextInput = ''
            return !state
        })
    }
    $: displayedOptions = 0
</script>

<div class='custom-dropdown w-full'>
    <input
        id='search-{id}'
        type='search'
        class='form-control text-capitalize custom-menu-{id} no-bubbles text-truncate {$$restProps.class}'
        class:fix-border={!form}
        class:bg-dark={!form}
        class:bg-dark-light={form}
        disabled={disabled}
        class:not-reactive={disabled}
        autocomplete='off'
        spellcheck='false'
        bind:value={searchTextInput}
        on:keydown={(event) => filterTags(event, 'keydown')}
        on:input={(event) => filterTags(event, 'input')}
        use:click={() => toggleDropdown()}
        data-option='search'
        placeholder={(Array.isArray(value) && value.length ? value.map((v) => getOptionDisplay(v) || v) : []).concat(Array.isArray(altValue) && altValue?.length ? altValue?.map((v) => '!' + (getOptionDisplay(v) || v)) : []).join(', ') || !arrayValue && ([value, (altValue ? '!' + altValue : '')].filter(Boolean).join(', ')) || 'Any'}
        list='sections-{id}'
    />
    {#if $dropdown}
        {@const searchInput = searchTextInput ? searchTextInput.toLowerCase() : null}
        <div class='custom-dropdown-menu position-absolute mh-300 overflow-y-auto w-full bg-dark custom-menu-{id}'>
            {#each headerSections?.length ? headerSections : [{ header: null, start: 0, end: getOptions()?.length || 1 }] as { header, start, end }}
                {@const options = getOptions().slice(start, end).filter((val) => !searchInput || includes(getOptionDisplay(val)?.toLowerCase(), searchInput.startsWith('!') ? searchInput.slice(1) : searchInput)).sort((a, b) => ((includes(value, a) ? -1 : 1) - (includes(value, b) ? -1 : 1)) || ((includes(altValue, a) ? 0 : 1) - (includes(altValue, b) ? 0 : 1))).slice(0, ((headerSections?.length ? end : displaySize) - displayedOptions))}
                {#if options.length > 0}
                    {#if header}<span class='not-reactive font-weight-bold p-5'>{header}</span>{/if}
                    {#each options as option}
                        <div role='button' tabindex='0' class='custom-dropdown-item {!headers ? `text-center` : `pl-20`} not-reactive pointer custom-menu-{id}' class:custom-dropdown-item-selected={includes(value, option)} class:custom-dropdown-item-alt-selected={includes(altValue, option)}
                             use:click={() => {
                                 if (includes(value, option)) value = arrayValue ? value.filter(item => item !== option) : null
                                 else {
                                     value = arrayValue ? [...(Array.isArray(value) ? value : value ? [value] : []), option] : option
                                     if (altValue && constrainAlt) altValue = arrayValue ? [] : null
                                     else if (includes(altValue, option)) altValue = arrayValue ? altValue.filter(item => item !== option) : null
                                 }
                                 setTimeout(() => form?.dispatchEvent(new Event('input', { bubbles: true })))
                             }}
                             on:contextmenu={(event) => {
                                 event.preventDefault()
                                 if (altValue) {
                                     if (includes(altValue, option)) altValue = arrayValue ? altValue.filter(item => item !== option) : null
                                     else {
                                         altValue = arrayValue ? [...(Array.isArray(altValue) ? altValue : altValue ? [altValue] : []), option] : option
                                         if (constrainAlt) value = arrayValue ? [] : null
                                         else if (includes(value, option)) value = arrayValue ? value.filter(item => item !== option) : null
                                     }
                                     setTimeout(() => form?.dispatchEvent(new Event('input', { bubbles: true })))
                                 }
                             }}>
                            <span class='not-reactive'>{getOptionDisplay(option)}</span>
                        </div>
                    {/each}
                    {(displayedOptions += options.length) && ''}
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style>
    .mh-300 {
        max-height: 30rem;
    }
    .fix-border {
        border-radius: 0 !important;
    }
    .custom-dropdown-menu {
        border-radius: 1rem;
        border: 0.1rem solid var(--border-color-sp);
        box-shadow: 0 0.25rem 0.75rem hsla(var(--black-color-hsl), 0.1);
        z-index: 15;
    }
    @media (hover: hover) and (pointer: fine) {
      .custom-dropdown-item:hover {
        background-color: var(--tertiary-color-very-light);
        color: var(--black-color);
      }
    }
    .custom-dropdown-item-selected {
        background-color: var(--tertiary-color);
        color: var(--black-color);
    }
    .custom-dropdown-item-alt-selected {
        background-color: var(--danger-color-very-dim);
        color: var(--highlight-color);
    }
</style>
