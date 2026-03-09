<script>
  import { SUPPORTS } from '@/modules/support.js'
  export let deliveryText
</script>

<div class='px-20 px-md-40 overflow-y-auto'>
  <div class='skeloader rounded w-500 h-20 mt-10 bg-ske'/>
  <hr class='my-20'/>
  <div class='whats-new-ske'>
    <div class='skeloader rounded w-150 h-25 bg-ske'/>
    <div class='ml-10 mt-20'>
      <div class='skeloader rounded w-300 h-20 bg-ske'/>
      <div class='ml-20 mt-15'>
        <div class='skeloader rounded w-800 h-20 bg-ske'/>
      </div>
      <div class='skeloader rounded w-200 h-20 mt-15 bg-ske'/>
      <div class='ml-20 mt-15'>
        <div class='skeloader rounded w-500 h-20 bg-ske'/>
        <div class='skeloader rounded w-550 h-20 mt-15 bg-ske'/>
      </div>
      <div class='skeloader rounded w-250 h-20 mt-15 bg-ske'/>
      <div class='ml-20 mt-15'>
        <div class='skeloader rounded w-600 h-20 bg-ske'/>
      </div>
      <div class='skeloader rounded w-300 h-20 mt-15 bg-ske'/>
      <div class='ml-20 mt-15'>
        <div class='skeloader rounded w-500 h-20 bg-ske'/>
      </div>
      <div class='skeloader rounded w-200 h-20 mt-15 bg-ske'/>
      <div class='ml-20 mt-15'>
        <div class='skeloader rounded w-400 h-20 bg-ske'/>
      </div>
      <div class='skeloader rounded w-500 h-20 mt-15 bg-ske'/>
      <div class='skeloader rounded w-300 h-20 mt-15 bg-ske'/>
      <div class='skeloader rounded w-400 h-20 mt-15 bg-ske'/>
      <div class='skeloader rounded w-250 h-20 mt-15 bg-ske' class:mb-20={!SUPPORTS.isAndroid}/>
      <div class='mt-30 mb-20 font-italic' class:d-none={!SUPPORTS.isAndroid}>{deliveryText}</div>
    </div>
  </div>
</div>