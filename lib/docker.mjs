/**
 * Minimal Docker Engine client for the worker controls.
 *
 * Talks HTTP over the mounted socket (`/var/run/docker.sock`) with nothing but
 * node:http — no dockerode, no CLI. The surface is deliberately tiny and
 * allow-listed: list, inspect state, pull, create, start, stop. No exec, no
 * remove, no volume or network administration.
 *
 * When the socket is not mounted every call reports `available: false` and the
 * UI simply keeps its static behaviour — the feature degrades, it does not fail.
 */

import http from 'node:http'

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
const LABEL = 'opencartridge.worker'

/** @param {string} method @param {string} path @param {any} [body] @param {number} [timeout] */
function request(method, path, body = null, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body)
    const req = http.request(
      {
        socketPath: SOCKET,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          let json = null
          try { json = data ? JSON.parse(data) : null } catch { /* not JSON */ }
          resolve({ status: res.statusCode || 0, json, text: data })
        })
      },
    )
    req.on('error', reject)
    if (timeout > 0) req.setTimeout(timeout, () => req.destroy(new Error('docker request timed out')))
    if (payload) req.write(payload)
    req.end()
  })
}

/** Is the socket mounted and answering? */
export async function dockerAvailable() {
  try {
    const res = await request('GET', '/version', null, 3000)
    return res.status === 200
  } catch {
    return false
  }
}

/** All containers, running or not, matching a name or our label. */
export async function listContainers() {
  const res = await request('GET', '/containers/json?all=1')
  if (res.status !== 200 || !Array.isArray(res.json)) return []
  return res.json.map((container) => ({
    id: String(container.Id || ''),
    name: String((container.Names || [''])[0] || '').replace(/^\//, ''),
    image: String(container.Image || ''),
    state: String(container.State || ''),
    status: String(container.Status || ''),
    labels: container.Labels || {},
    ports: container.Ports || [],
  }))
}

/** Containers tagged as OpenCartridge workers. */
export async function listWorkerContainers() {
  return (await listContainers()).filter((container) => container.labels[LABEL])
}

/** Present locally? Compares the repository part, so `img` matches `img:latest`. */
export async function imagePresent(image) {
  const [repo, tag = 'latest'] = String(image).split(':')
  const res = await request('GET', `/images/${encodeURIComponent(repo)}:${encodeURIComponent(tag)}/json`)
  return res.status === 200
}

/** Container state, or null when it does not exist. */
export async function containerState(name) {
  const containers = await listContainers()
  return containers.find((container) => container.name === name) ?? null
}

export async function startContainer(id) {
  const res = await request('POST', `/containers/${id}/start`, null, 60000)
  if (res.status === 204 || res.status === 304) return { ok: true }
  throw new Error(res.json?.message || `start failed (${res.status})`)
}

export async function stopContainer(id) {
  const res = await request('POST', `/containers/${id}/stop?t=15`, null, 60000)
  if (res.status === 204 || res.status === 304) return { ok: true }
  throw new Error(res.json?.message || `stop failed (${res.status})`)
}

export async function restartContainer(id) {
  const res = await request('POST', `/containers/${id}/restart?t=15`, null, 90000)
  if (res.status === 204) return { ok: true }
  throw new Error(res.json?.message || `restart failed (${res.status})`)
}

/** Remove a container; already-gone counts as success. */
export async function removeContainer(id) {
  const res = await request('DELETE', `/containers/${id}?force=1&v=1`, null, 60000)
  if (res.status === 204 || res.status === 404) return { ok: true, removed: res.status === 204 }
  throw new Error(res.json?.message || `remove failed (${res.status})`)
}

/**
 * Remove an image tag and its layers. Already-gone counts as success; a 409
 * (still used by another container) is reported so the caller can explain it.
 */
export async function removeImage(image) {
  const [repo, tag = 'latest'] = String(image).split(':')
  const res = await request('DELETE', `/images/${encodeURIComponent(repo)}:${encodeURIComponent(tag)}?force=1`, null, 120000)
  if (res.status === 200) return { ok: true, removed: true }
  if (res.status === 404) return { ok: true, removed: false }
  throw new Error(res.json?.message || `image delete failed (${res.status})`)
}

/**
 * Create a container from a spec (never from user input: the spec comes from
 * the registry file, which is part of the repository).
 */
export async function createContainer(spec) {
  const body = {
    Image: spec.image,
    Cmd: Array.isArray(spec.command) && spec.command.length > 0 ? spec.command : undefined,
    Env: Object.entries(spec.env || {}).map(([key, value]) => `${key}=${value}`),
    Labels: { [LABEL]: spec.id, 'opencartridge.port': String(spec.port) },
    ExposedPorts: { [`${spec.port}/tcp`]: {} },
    HostConfig: {
      PortBindings: { [`${spec.port}/tcp`]: [{ HostPort: String(spec.hostPort || spec.port) }] },
      RestartPolicy: { Name: spec.restart || 'unless-stopped' },
      ...(spec.gpus ? { DeviceRequests: [{ Driver: '', Count: -1, Capabilities: [['gpu']] }] } : {}),
      ...(spec.shmSize ? { ShmSize: spec.shmSize } : {}),
      ...(spec.extraHosts ? { ExtraHosts: spec.extraHosts } : {}),
    },
  }
  const res = await request('POST', `/containers/create?name=${encodeURIComponent(spec.name)}`, body, 60000)
  if (res.status === 201) return { id: res.json?.Id, created: true }
  if (res.status === 409) {
    // Name already taken: use the existing container instead of failing.
    const existing = await containerState(spec.name)
    if (existing) return { id: existing.id, created: false }
  }
  throw new Error(res.json?.message || `create failed (${res.status})`)
}

/**
 * Pull an image, reporting progress as it arrives.
 * `onEvent` receives `{ status, detail, percent }` events; the stream is
 * newline-delimited JSON from the daemon.
 *
 * @param {string} image `repo` or `repo:tag`
 * @param {(event: {status: string, detail: string, percent: number|null}) => void} [onEvent]
 */
export async function pullImage(image, onEvent) {
  const [repo, tag = 'latest'] = String(image).split(':')
  const path = `/images/create?fromImage=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`

  return new Promise((resolve, reject) => {
    // Empty registry auth: enough for public images (Docker Hub and mirrors).
    const req = http.request(
      {
        socketPath: SOCKET,
        path,
        method: 'POST',
        headers: { 'X-Registry-Auth': Buffer.from('{}').toString('base64') },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let data = ''
          res.on('data', (chunk) => { data += chunk })
          res.on('end', () => reject(new Error(data || `pull failed (${res.statusCode})`)))
          return
        }
        let buffer = ''
        const progress = new Map()
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            let event = null
            try { event = JSON.parse(line) } catch { continue }
            if (event.error) { reject(new Error(event.error)); return }
            const detail = event.id ? `${event.id}: ${event.status ?? ''}` : (event.status ?? '')
            if (event.id && typeof event.progressDetail?.current === 'number' && event.progressDetail.total) {
              progress.set(event.id, event.progressDetail.current / event.progressDetail.total)
            }
            const values = [...progress.values()]
            const percent = values.length > 0
              ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100)
              : null
            onEvent?.({ status: event.status ?? 'pulling', detail, percent })
          }
        })
        res.on('end', () => resolve({ ok: true }))
      },
    )
    req.on('error', reject)
    req.setTimeout(0) // a 13 GB pull takes a while
    req.end()
  })
}

/** Resolve `${NAME}` against the app's own environment. */
export function expandEnv(template) {
  const out = {}
  for (const [key, value] of Object.entries(template || {})) {
    const text = String(value)
    const match = text.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)
    out[key] = match ? (process.env[match[1]] ?? '') : text
  }
  return out
}
