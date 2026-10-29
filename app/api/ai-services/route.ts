import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// OpenCartridges runs multiple local workers, each on its own port. The global
// registry (public/service-workers.json) lists every worker: a service catalog
// file plus the API/upload URLs jobs are sent to. Each catalog entry ("catalog")
// is either relative to public/ or an absolute filesystem path, so catalogs can
// also be loaded straight from another project directory.
interface WorkerEntry {
  id: string
  name?: string
  catalog: string
  apiUrl: string
  uploadUrl?: string
  workerUploadUrl?: string
}

async function loadRegistry(): Promise<WorkerEntry[]> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'public', 'service-workers.json'), 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function loadCatalog(entry: WorkerEntry): Promise<any[]> {
  const catalogPath = path.isAbsolute(entry.catalog)
    ? entry.catalog
    : path.join(process.cwd(), 'public', entry.catalog)
  try {
    const raw = await fs.readFile(catalogPath, 'utf8')
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.map((service: any) => ({
      ...service,
      worker: entry.name ?? entry.id,
      apiUrl: entry.apiUrl,
      uploadUrl: entry.uploadUrl,
      workerUploadUrl: entry.workerUploadUrl,
    }))
  } catch (error) {
    console.error(`Failed to load service catalog for worker "${entry.id}":`, error)
    return []
  }
}

export async function GET() {
  const registry = await loadRegistry()
  const catalogs = await Promise.all(registry.map(loadCatalog))
  const bundled = catalogs.flat()

  // Optional extra remote catalog (OPENHIGGS_SERVICES_URL or legacy
  // TOST_AI_SERVICES_URL); bundled entries win on id conflicts.
  let remote: any[] = []
  const url = process.env.OPENHIGGS_SERVICES_URL ?? process.env.TOST_AI_SERVICES_URL
  if (url) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        if (Array.isArray(data)) remote = data
      }
    } catch (error) {
      console.error('Failed to fetch remote AI services:', error)
    }
  }

  const bundledIds = new Set(bundled.map((service: any) => service.id))
  const merged = [...remote.filter((service: any) => !bundledIds.has(service.id)), ...bundled]

  if (merged.length === 0) {
    return NextResponse.json(
      { error: 'No cartridges available: public/service-workers.json has no workers, their catalogs failed to load, and no remote catalog is configured' },
      { status: 500 }
    )
  }

  return NextResponse.json(merged)
}
