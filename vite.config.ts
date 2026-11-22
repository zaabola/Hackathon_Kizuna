import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Serves the Vercel functions in api/ during `npm run dev` (/api/ask -> api/ask.ts), so one command runs everything.
const devApi = (): Plugin => ({
  name: 'dev-api',
  configureServer(server) {
    // The autopilot runs inside the dev server: a first check after start, then every 5 minutes, as long as `npm run dev` runs.
    const tick = async () => {
      try { const { runAutopilot } = await server.ssrLoadModule('/api/autopilot.ts'); await runAutopilot() } catch (e) { server.config.logger.error(`[autopilot] ${e}`) }
    }
    // Cleared when Vite restarts the server (config or .env change), so ticks never pile up.
    const timers = [setTimeout(tick, 5_000), setInterval(tick, 5 * 60_000)]
    server.httpServer?.on('close', () => timers.forEach(clearInterval))
    // Telegram: poll for families scanning their QR or asking a question (Vercel uses the webhook instead).
    timers.push(setInterval(async () => {
      try { const { pollTelegram } = await server.ssrLoadModule('/api/telegram.ts'); await pollTelegram() } catch { /* offline or no token: next poll retries */ }
    }, 3_000))
    server.middlewares.use('/api', async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const name = url.pathname.slice(1)
      if (!/^[a-z]+$/.test(name)) { res.statusCode = 404; return res.end() }
      try { // one bad request must never take the demo server down
        const mod = await server.ssrLoadModule(`/api/${name}.ts`)
        const handler = mod[req.method ?? 'GET']
        if (typeof handler !== 'function') { res.statusCode = 405; return res.end() }
        const chunks: Buffer[] = []
        let size = 0
        for await (const c of req) { if ((size += (c as Buffer).length) > 1e6) { res.statusCode = 413; return res.end() } chunks.push(c as Buffer) }
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks)
        const r: Response = await handler(new Request(`http://localhost/api/${name}${url.search}`, { method: req.method, body, headers: Object.entries(req.headers).filter((h): h is [string, string] => typeof h[1] === 'string') }))
        res.statusCode = r.status
        res.setHeader('content-type', 'application/json')
        res.end(await r.text())
      } catch (e) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
  },
})

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  // data/ holds the autopilot's files: writing them must not reload the page.
  return { plugins: [react(), devApi()], server: { watch: { ignored: ['**/data/**'] }, allowedHosts: ['.trycloudflare.com'] } }
})
