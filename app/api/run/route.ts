import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { serviceId, payload, localApiUrl } = await request.json()

    // Stale pages (loaded before the worker registry existed) send no URL or
    // the literal string "undefined" — answer with an actionable message
    // instead of a cryptic connection failure.
    if (!localApiUrl || typeof localApiUrl !== 'string' || !localApiUrl.startsWith('http')) {
      return NextResponse.json(
        { error: 'This cartridge has no worker URL — refresh the page to reload the cartridge registry' },
        { status: 400 }
      )
    }

    // A worker can briefly refuse connections (restart, model reload, load
    // spike) — retry a few times before giving up.
    let lastError: unknown = null
    let response: Response | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(`${localApiUrl}/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'accept': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        break
      } catch (error) {
        lastError = error
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500))
      }
    }

    if (!response) {
      console.error('Error proxying to local API after retries:', lastError)
      return NextResponse.json(
        { error: 'Failed to connect to local API server' },
        { status: 502 }
      )
    }

    const data = await response.json()

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error proxying to local API:', error)
    return NextResponse.json(
      { error: 'Failed to connect to local API server' },
      { status: 500 }
    )
  }
}
