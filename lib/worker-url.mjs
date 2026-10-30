/**
 * Where a worker actually answers, as seen from inside this container.
 *
 * `public/service-workers.json` addresses every worker as
 * `http://host.docker.internal:<port>`. Docker Desktop creates that name for
 * you; plain Linux Docker does not, and `docker run` without
 * `--add-host=host.docker.internal:host-gateway` leaves us with a name that
 * fails to resolve (`ENOTFOUND`) while the containers themselves are perfectly
 * healthy — every card sits on "Starting…" forever.
 *
 * Rather than depend on the user's command line, try the forms that can work
 * from a bridge network and use whichever answers:
 *
 *   - the URL as written in the registry (works on Docker Desktop, and on a
 *     host-network install)
 *   - the loopback/alias twin (`127.0.0.1` <-> `host.docker.internal`)
 *   - the default gateway, i.e. the host as the bridge sees it (172.17.0.1 on
 *     a stock bridge) — the published worker port is reachable there
 *
 * Only the host part of a URL is ever rewritten: the path and port a worker
 * declares are left alone, and a registry entry pointing at a real remote host
 * is returned untouched.
 */

import { promises as fs } from 'node:fs'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', 'host.docker.internal'])

/** Cached default gateway; `''` means "looked, found none". */
let gatewayCache = null

/** First default route from /proc/net/route, as a dotted quad. */
async function defaultGateway() {
  if (gatewayCache !== null) return gatewayCache
  try {
    const table = await fs.readFile('/proc/net/route', 'utf8')
    for (const line of table.split('\n').slice(1)) {
      const columns = line.trim().split(/\s+/)
      // Iface Destination Gateway … — a default route has destination 00000000.
      if (columns.length < 3 || columns[1] !== '00000000') continue
      if (!/^[0-9a-fA-F]{8}$/.test(columns[2])) continue
      // The kernel prints the address little-endian.
      const value = parseInt(columns[2], 16)
      gatewayCache = [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255].join('.')
      return gatewayCache
    }
  } catch {
    // Not Linux, or no procfs: fall through.
  }
  gatewayCache = ''
  return gatewayCache
}

/**
 * URLs worth trying for one worker, in order, de-duplicated.
 * @param {string} apiUrl registry URL, e.g. `http://host.docker.internal:8003`
 * @returns {Promise<string[]>}
 */
export async function workerUrlCandidates(apiUrl) {
  const candidates = [apiUrl]
  let parsed
  try {
    parsed = new URL(apiUrl)
  } catch {
    return candidates
  }
  if (!LOOPBACK.has(parsed.hostname)) return candidates

  const add = (hostname) => {
    try {
      const url = new URL(apiUrl)
      url.hostname = hostname
      const text = url.toString()
      if (!candidates.includes(text)) candidates.push(text)
    } catch { /* impossible: the base URL already parsed */ }
  }

  add(parsed.hostname === 'host.docker.internal' ? '127.0.0.1' : 'host.docker.internal')
  const gateway = await defaultGateway()
  if (gateway) add(gateway)
  return candidates
}
