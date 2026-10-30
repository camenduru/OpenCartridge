import { type NextRequest, NextResponse } from "next/server"
import { workerUrlCandidates } from '@/lib/worker-url.mjs'

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get("url")

    if (!url) {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 })
    }

    // Result URLs are MinIO objects built from the endpoint the worker was
    // given (`http://host.docker.internal:9000/tost/…`), which this container
    // may not be able to resolve — see lib/worker-url.mjs. Try every host form
    // before giving up; non-local URLs pass through untouched.
    let response: Response | null = null
    let answered: Response | null = null
    let lastError: unknown = null
    for (const candidate of await workerUrlCandidates(url)) {
      try {
        const attempt = await fetch(candidate, {
          headers: {
            'User-Agent': 'OpenCartridge/1.0',
          },
        })
        if (attempt.ok) {
          response = attempt
          break
        }
        answered = attempt
        lastError = new Error(`${candidate} answered ${attempt.status}`)
      } catch (error) {
        lastError = error
      }
    }

    // Nothing answered with a body we can use. Keep the worker's own status
    // when one did answer at all (a missing object is a 404, not a proxy fault).
    if (!response) {
      if (answered) {
        return NextResponse.json({ error: "Failed to fetch image" }, { status: answered.status })
      }
      console.error("Image proxy error:", lastError)
      return NextResponse.json({ error: "Failed to proxy image" }, { status: 502 })
    }

    const contentType = response.headers.get('content-type') || 'image/png'
    const arrayBuffer = await response.arrayBuffer()

    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  } catch (error) {
    console.error("Image proxy error:", error)
    return NextResponse.json({ error: "Failed to proxy image" }, { status: 500 })
  }
}