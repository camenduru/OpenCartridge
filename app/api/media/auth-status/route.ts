import { NextResponse } from 'next/server'

// The media viewer ships without auth: OpenCartridges is a local-only app and the
// S3 credentials live server-side in lib/s3.ts.
export async function GET() {
  return NextResponse.json({ enabled: false, authenticated: true })
}
