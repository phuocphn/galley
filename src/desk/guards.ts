import type { MiddlewareHandler } from 'hono'

/** The names a Desk answers to. Anything else is someone else's DNS. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

const MUTATING = ['POST', 'PUT', 'PATCH']

/**
 * Whether a `Host` header names this Desk on this machine.
 *
 * A DNS rebinding attack points an attacker's own domain at 127.0.0.1 to get
 * inside the Desk's origin, and the one thing it cannot forge is the name it
 * asked for — so the name is what gets checked.
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return true
  return LOOPBACK_HOSTS.some((name) => host === name || host === `${name}:${port}`)
}

/**
 * Keep the Desk answerable only to the machine it runs on.
 *
 * Opening a Review is a request now, not an argument to `galley` at startup, so
 * `POST /api/reviews` can be reached by anything that can talk to the port —
 * including a page open in another tab. Another local *process* asking for a
 * folder is not an escalation, since it could read that folder itself; the
 * browser is what this guards against.
 *
 * - **Host** must be a loopback name on this port.
 * - **`Sec-Fetch-Site: cross-site`** is refused on anything that changes state,
 *   which is what a form posted from another site looks like.
 * - **`content-type: application/json`** is required on the same requests. A
 *   form can only send three content types, none of them this one, so it cannot
 *   be made to look like the client.
 *
 * The port is read at request time: a Desk asked for port 0 does not know which
 * one it has until it is listening.
 */
export function loopbackOnly(port: () => number): MiddlewareHandler {
  return async (c, next) => {
    if (!isLoopbackHost(c.req.header('host'), port())) {
      return c.json({ error: 'The Desk answers on localhost only' }, 403)
    }

    if (MUTATING.includes(c.req.method)) {
      if (c.req.header('sec-fetch-site') === 'cross-site') {
        return c.json({ error: 'The Desk does not take requests from other sites' }, 403)
      }

      const contentType = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') {
        return c.json({ error: 'Send JSON' }, 415)
      }
    }

    return next()
  }
}
