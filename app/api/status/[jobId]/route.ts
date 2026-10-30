import { NextRequest, NextResponse } from 'next/server'
import http from 'node:http'
import https from 'node:https'
import { workerUrlCandidates } from '@/lib/worker-url.mjs'

// RunPod's /status blocks until the job has finished, which for image-to-video
// work can take many minutes. Next's global fetch (undici) aborts on headers
// after 300s, which turned slow jobs into "Status check failed", so proxy the
// call with node:http and no timeout instead.
function postJson(target: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(target)
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        timeout: 0,
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => resolve({ statusCode: response.statusCode || 500, body }))
      }
    )
    request.on('error', reject)
    request.end()
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const { localApiUrl } = await request.json()

    if (!localApiUrl || typeof localApiUrl !== 'string' || !localApiUrl.startsWith('http')) {
      return NextResponse.json(
        { error: 'This cartridge has no worker URL — refresh the page to reload the cartridge registry' },
        { status: 400 }
      )
    }

    // Same candidate list as /api/run: whichever host form reaches the worker.
    let lastError: unknown = null
    for (const base of await workerUrlCandidates(localApiUrl)) {
      try {
        const { statusCode, body } = await postJson(`${base}/status/${jobId}`)
        return new NextResponse(body, {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        lastError = error
      }
    }
    throw lastError ?? new Error(`no reachable URL for ${localApiUrl}`)
  } catch (error) {
    console.error('Error proxying status request to local API:', error)
    return NextResponse.json({ error: 'Failed to connect to local API server' }, { status: 500 })
  }
}
