import { ipcMain } from 'electron'
import { development } from './util.js'
import http from 'http'

/**
 * YOUTUBE EMBED WORKAROUND SERVER (Temporary)
 *
 * This is a HORRIBLE HACKY FIX that should NOT be used as an example or best practice.
 *
 * THE PROBLEM:
 * - In production, Electron loads files via file:// protocol
 * - The file:// protocol does NOT send HTTP Referer headers (by design for security)
 * - YouTube recently changed their embed requirements to REQUIRE valid Referer headers
 * - Result: YouTube embeds show "Error 153" in production builds but work fine in dev
 *
 * WHY THIS "WORKS":
 * - Creates a local HTTP server that wraps YouTube embeds
 * - Serves content via http://localhost which CAN send Referer headers
 * - Keeps HTTP response open until YouTube's iframe actually loads (via fetch callback)
 * - This makes the outer iframe's onload event wait for YouTube to be ready
 *
 * WHY IT'S TERRIBLE:
 * - Running a full HTTP server just to embed YouTube videos is absurd
 * - Uses fetch() callback hack to signal when iframe loads
 * - Only needed because Electron production uses file:// protocol
 */

const pendingResponses = new Map()
export const youtubeServer = !development ? http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`)
  if (url.pathname === '/loaded') {
    const responseId = url.searchParams.get('id')
    const pendingRes = pendingResponses.get(responseId)
    if (pendingRes) {
      pendingRes.end('</body></html>')
      pendingResponses.delete(responseId)
    }
    res.end('ok')
    return
  }
  const pathParts = url.pathname.split('/').filter(Boolean)
  const videoId = pathParts[pathParts.length - 1]
  const params = url.searchParams.toString()
  const responseId = String(Date.now() + Math.random())
  res.writeHead(200, { 'Content-Type': 'text/html', 'Referrer-Policy': 'strict-origin-when-cross-origin' })
  res.write(`<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='UTF-8'>
  <meta name='referrer' content='strict-origin-when-cross-origin'>
  <style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: 0; display: block; }
  </style>
</head>
<body>
  <iframe
    src='https://www.youtube-nocookie.com/embed/${videoId}?${params}'
    allow='autoplay'
    allowFullScreen
    referrerpolicy='strict-origin-when-cross-origin'
    onload="fetch('/loaded?id=${responseId}')"
  ></iframe>`)
  pendingResponses.set(responseId, res)
  req.on('close', () => pendingResponses.delete(responseId))
}) : {}

youtubeServer?.listen?.(0, 'localhost', () => console.log(`YouTube server running on http://localhost:${youtubeServer.address().port}`))
ipcMain.handle('electron:getYouTube', () => development ? 'https://www.youtube-nocookie.com' : `http://localhost:${youtubeServer.address().port}`)