<script>
    import { isValidNumber } from '@/modules/util.js'

    export let min = 0
    export let max = 100
    export let step = 1
    export let bindTo

    let input = bindTo
    let invalid = false

    /**
     * Clamps a numeric value to a given minimum and maximum range.
     *
     * @param {number} value  - The value to clamp.
     * @returns {number} The clamped value, guaranteed to be within the [min, max] range.
     */
    function clamp(value) {
        return Math.min(Math.max(value, min), max)
    }

    /**
     * Handles the blur (focus loss) event for the number input.
     * Ensures the value is clamped to the defined [min, max] range when the user leaves the field.
     *
     * If the value cannot be parsed as a number (e.g., empty or invalid input),
     * it falls back to the minimum allowed value.
     *
     * @param {FocusEvent} event - The blur event triggered when the input loses focus.
     */
    function handleBlur(event) {
        const value = parseInt(event.target.value, 10)
        if (isValidNumber(value)) bindTo = clamp(value)
        else bindTo = min
        input = bindTo
    }

    /**
     * Checks if the input value is outside the min and max range, then sets the invalid flag accordingly.
     *
     * @param {Event} event - The input event from the number field.
     */
    function handleInput(event) {
        const value = event.target.value
        invalid = value !== '' && (+value < min || +value > max)
    }
</script>

<input
    type='number'
    inputmode='numeric'
    pattern='[0-9]*'
    min={min}
    max={max}
    step={step}
    value={input}
    on:blur={handleBlur}
    on:input={handleInput}
    class={`${$$restProps.class} ${invalid ? 'invalid' : ''}`}
/>

<style>
    .invalid {
        box-shadow: inset 0 0 0 .4rem var(--danger-color-dim) !important;
    }
</style>