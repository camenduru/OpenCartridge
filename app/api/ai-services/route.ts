import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// OpenCartridge runs multiple local workers, each on its own port. The global
// registry (public/service-workers.json) lists every worker: a cartridge catalog
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
    return data.map((cartridge: any) => ({
      ...cartridge,
      worker: entry.name ?? entry.id,
      apiUrl: entry.apiUrl,
      uploadUrl: entry.uploadUrl,
      workerUploadUrl: entry.workerUploadUrl,
    }))
  } catch (error) {
    console.error(`Failed to load cartridge catalog for worker "${entry.id}":`, error)
    return []
  }
}

export async function GET() {
  const registry = await loadRegistry()
  const catalogs = await Promise.all(registry.map(loadCatalog))
  const merged = catalogs.flat()

  if (merged.length === 0) {
    return NextResponse.json(
      { error: 'No cartridges available: public/service-workers.json has no workers, or their catalogs failed to load' },
      { status: 500 }
    )
  }

  return NextResponse.json(merged)
}
