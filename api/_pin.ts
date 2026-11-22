// One PIN guards everything that acts for the GDA: sending SMS, saving the families, driving the autopilot.
// shortcut: in-memory and per server instance (each warm Vercel instance counts alone); move to a KV store if the URL goes public.
let fails = 0, lockedUntil = 0

// null = allowed; otherwise the response to return.
export function checkPin(pin: unknown): Response | null {
  const want = process.env.SEND_PIN
  if (!want) return Response.json({ error: 'no PIN configured on the server (SEND_PIN)' }, { status: 503 })
  if (Date.now() < lockedUntil) return Response.json({ error: 'too many wrong PINs, wait a minute' }, { status: 429 })
  if (pin !== want) {
    if (++fails >= 5) { fails = 0; lockedUntil = Date.now() + 60_000 }
    return Response.json({ error: 'wrong PIN' }, { status: 401 })
  }
  fails = 0
  return null
}
