import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  containerState,
  createContainer,
  dockerAvailable,
  expandEnv,
  imagePresent,
  listContainers,
  pullImage,
  restartContainer,
  startContainer,
  stopContainer,
} from '@/lib/docker.mjs'

// Live state of every worker in the registry, plus the controls the Add
// Cartridge popup needs: download & run when the image is absent, start/stop
// when the container exists. Everything is derived from the Docker socket; when
// it is not mounted the route reports `docker: false` and the UI keeps its
// static behaviour.

type WorkerEntry = {
  id: string
  name?: string
  catalog: string
  apiUrl: string
  uploadUrl?: string
  workerUploadUrl?: string
  container?: {
    name: string
    image: string
    port: number
    hostPort?: number
    gpus?: boolean
    command?: string[]
    env?: Record<string, string>
    restart?: string
  }
}

type Task = {
  action: 'install' | 'pull'
  status: 'running' | 'done' | 'error'
  detail: string
  percent: number | null
  started: number
}

// Long pulls outlive a request, so progress lives in the server process.
const globalForTasks = globalThis as unknown as { __ocWorkerTasks?: Map<string, Task> }
const tasks: Map<string, Task> = globalForTasks.__ocWorkerTasks ?? new Map()
globalForTasks.__ocWorkerTasks = tasks

async function loadRegistry(): Promise<WorkerEntry[]> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'public', 'service-workers.json'), 'utf8')
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''))
    const entries = Array.isArray(data) ? data : Array.isArray(data?.workers) ? data.workers : []
    return entries.filter((entry: any) => entry && entry.id && entry.apiUrl)
  } catch {
    return []
  }
}

function specFor(entry: WorkerEntry) {
  const container = entry.container
  if (!container) return null
  return {
    id: entry.id,
    name: container.name,
    image: container.image,
    port: container.port,
    hostPort: container.hostPort ?? container.port,
    gpus: container.gpus !== false,
    command: container.command ?? [],
    env: expandEnv(container.env),
    restart: container.restart,
  }
}

/** Any 2xx within a short window means the worker is answering. */
async function reachable(apiUrl: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetch(apiUrl, { signal: controller.signal, cache: 'no-store' })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function describe(entry: WorkerEntry, containers: any[], docker: boolean, images: Map<string, boolean>) {
  const spec = specFor(entry)
  let container = spec ? containers.find((c: any) => c.name === spec.name) ?? null : null

  let state: 'running' | 'stopped' | 'ready' | 'missing' | 'unknown' = 'unknown'
  if (!docker) state = 'unknown'
  else if (container?.state === 'running') state = 'running'
  else if (container) state = 'stopped'
  else if (spec?.image) state = images.get(spec.image) ? 'ready' : 'missing'
  else state = 'unknown'

  const task = tasks.get(entry.id) ?? null
  const answering = state === 'running' ? await reachable(entry.apiUrl) : false

  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    image: spec?.image ?? null,
    container: spec?.name ?? null,
    containerId: container?.id ?? null,
    state,
    reachable: answering,
    installable: Boolean(spec),
    task: task
      ? { action: task.action, status: task.status, detail: task.detail, percent: task.percent }
      : null,
  }
}

export async function GET() {
  const registry = await loadRegistry()
  const docker = await dockerAvailable()

  let containers: any[] = []
  const images = new Map<string, boolean>()

  if (docker) {
    try {
      containers = await listContainers()
    } catch {
      containers = []
    }
    await Promise.all(
      registry.map(async (entry) => {
        const spec = specFor(entry)
        if (!spec?.image) return
        try {
          images.set(spec.image, await imagePresent(spec.image))
        } catch {
          images.set(spec.image, false)
        }
      }),
    )
  }

  const workers = await Promise.all(registry.map((entry) => describe(entry, containers, docker, images)))
  return NextResponse.json({ docker, workers })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const id = String(body?.id ?? '')
  const action = String(body?.action ?? '')

  const registry = await loadRegistry()
  const entry = registry.find((candidate) => candidate.id === id)
  if (!entry) return NextResponse.json({ error: `unknown worker ${id}` }, { status: 404 })

  const spec = specFor(entry)
  if (!spec) return NextResponse.json({ error: `${id} has no container spec` }, { status: 400 })

  if (!(await dockerAvailable())) {
    return NextResponse.json(
      { error: 'Docker socket is not mounted: run OpenCartridge with -v /var/run/docker.sock:/var/run/docker.sock' },
      { status: 503 },
    )
  }

  try {
    const existing = await containerState(spec.name)

    if (action === 'start') {
      if (!existing) return NextResponse.json({ error: 'container does not exist yet' }, { status: 409 })
      await startContainer(existing.id)
      return NextResponse.json({ ok: true })
    }

    if (action === 'stop') {
      if (!existing) return NextResponse.json({ ok: true })
      await stopContainer(existing.id)
      return NextResponse.json({ ok: true })
    }

    if (action === 'restart') {
      if (!existing) return NextResponse.json({ error: 'container does not exist yet' }, { status: 409 })
      await restartContainer(existing.id)
      return NextResponse.json({ ok: true })
    }

    if (action === 'pull' || action === 'install') {
      const current = tasks.get(id)
      if (current?.status === 'running') return NextResponse.json({ ok: true, task: current })

      const task: Task = {
        action: action === 'install' ? 'install' : 'pull',
        status: 'running',
        detail: 'starting',
        percent: 0,
        started: Date.now(),
      }
      tasks.set(id, task)

      // Detached: a 13 GB pull cannot wait on an HTTP request.
      void (async () => {
        try {
          if (!(await imagePresent(spec.image))) {
            await pullImage(spec.image, (event) => {
              task.detail = event.detail || event.status
              task.percent = event.percent
            })
          }
          if (task.action === 'install') {
            task.detail = 'creating container'
            task.percent = 100
            const created = await createContainer(spec)
            await startContainer(created.id)
            task.detail = 'started'
          } else {
            task.detail = 'downloaded'
          }
          task.status = 'done'
        } catch (error: any) {
          task.status = 'error'
          task.detail = String(error?.message ?? error)
          console.error(`[workers] ${id} ${task.action} failed:`, error)
        }
      })()

      return NextResponse.json({ ok: true, task })
    }

    return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message ?? error) }, { status: 500 })
  }
}
