// Disabled Cast prototype

// Presentation state
  // const presentationRequest = null
  // const presentationConnection = null
  // const canCast = false

// Presentation setup
  // if ('PresentationRequest' in window) {
  //   const handleAvailability = aval => {
  //     canCast = !!aval
  //   }
  //   presentationRequest = new PresentationRequest(['build/cast.html'])
  //   presentationRequest.addEventListener('connectionavailable', e => initCast(e))
  //   navigator.presentation.defaultRequest = presentationRequest
  //   presentationRequest.getAvailability().then(aval => {
  //     aval.onchange = e => handleAvailability(e.target.value)
  //     handleAvailability(aval.value)
  //   })
  // }

// Cast toggle
  // function toggleCast () {
  //   if (video.readyState) {
  //     if (presentationConnection) {
  //       presentationConnection?.terminate()
  //     } else {
  //       presentationRequest.start()
  //     }
  //   }
  // }

// Cast keybind
    // KeyD: {
    //   fn: () => !viewAnime && toggleCast(),
    //   id: 'cast',
    //   icon: Cast,
    //   type: 'icon',
    //   desc: 'Toggle Cast [broken]'
    // },

// Cast signaling
  // function initCast (event) {
  //   // these quality settings are likely to make cast overheat, oh noes!
  //   let peer = new Peer({
  //     polite: true,
  //     quality: {
  //       audio: {
  //         stereo: 1,
  //         'sprop-stereo': 1,
  //         maxaveragebitrate: 510000,
  //         maxplaybackrate: 510000,
  //         cbr: 0,
  //         useinbandfec: 1,
  //         usedtx: 1,
  //         maxptime: 20,
  //         minptime: 10
  //       },
  //       video: {
  //         bitrate: 2000000,
  //         codecs: ['VP9', 'VP8', 'H264']
  //       }
  //     }
  //   })

  //   presentationConnection = event.connection
  //   presentationConnection.addEventListener('terminate', () => {
  //     presentationConnection = null
  //     peer = null
  //   })

  //   peer.signalingPort.onmessage = ({ data }) => {
  //     presentationConnection.send(data)
  //   }

  //   presentationConnection.addEventListener('message', ({ data }) => {
  //     peer.signalingPort.postMessage(data)
  //   })

  //   peer.dc.onopen = () => {
  //     if (peer && presentationConnection) {
  //       const tracks = []
  //       const videostream = video.captureStream()
  //       if (true) {
  //         // TODO: check if cast supports codecs
  //         const { stream, destroy } = getBurnIn(!subs?.renderer)
  //         tracks.push(stream.getVideoTracks()[0], videostream.getAudioTracks()[0])
  //         presentationConnection.addEventListener('terminate', destroy)
  //       } else {
  //         tracks.push(videostream.getVideoTracks()[0], videostream.getAudioTracks()[0])
  //       }
  //       for (const track of tracks) {
  //         peer.pc.addTrack(track, videostream)
  //       }
  //       paused = false // video pauses for some reason
  //     }
  //   }
  // }

// Cast control markup
// <!--{#if 'PresentationRequest' in window && canCast && current}-->
// <!--  <span class='icon text-white ctrl d-flex align-items-center text-white' title='Cast Video [D]' data-name='toggleCast' use:click={toggleCast}>-->
// <!--    {#if presentationConnection}-->
// <!--      <Cast size='2.5rem' fill='currentColor' strokeWidth={0} />-->
// <!--    {:else}-->
// <!--      <Cast size='2.5rem' strokeWidth={2.5} />-->
// <!--    {/if}-->
// <!--  </span>-->
// <!--{/if}-->

// Cast fullscreen style
// /*:fullscreen .ctrl[data-name='toggleCast'] {*/
// /*  display: none !important;*/
// /*}*/
