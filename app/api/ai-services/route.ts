import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { parseCatalog } from '@/lib/cartridge-schema.mjs'

// OpenCartridge runs multiple local workers, each on its own port. The global
// registry (public/service-workers.json) lists every worker: a cartridge catalog
// file plus the API/upload URLs jobs are sent to. Each catalog entry ("catalog")
// is either relative to public/ or an absolute filesystem path, so catalogs can
// also be loaded straight from another project directory.
//
// Catalogs are read through lib/cartridge-schema.mjs, which accepts every shape
// ever shipped — a bare array (v1), {cartridges: [...]}, or
// {schema: "cartridge/2", cartridges: [...]} — fills in defaults and preserves
// fields this build does not know about. A catalog written years ago loads here.
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
    const entries = Array.isArray(data) ? data : Array.isArray(data?.workers) ? data.workers : []
    return entries.filter((entry: any) => entry && entry.id && entry.catalog && entry.apiUrl)
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
    const { cartridges, warnings } = parseCatalog(raw)
    for (const warning of warnings) {
      console.warn(`[cartridges] ${entry.id}: ${warning}`)
    }
    return cartridges.map((cartridge: any) => ({
      ...cartridge,
      // The registry id, so the UI can join a cartridge to its worker's Docker state.
      workerId: entry.id,
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
