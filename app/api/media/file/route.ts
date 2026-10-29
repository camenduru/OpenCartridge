import { NextRequest, NextResponse } from 'next/server'
import { getS3Endpoint, isAllowedBucket, getFileType } from '@/lib/s3'

// The buckets are anonymous-public, so a plain endpoint URL is enough — the
// browser fetches the object straight from the shared MinIO.
export async function GET(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get('bucket')
  const key = request.nextUrl.searchParams.get('key')

  if (!isAllowedBucket(bucket)) {
    return NextResponse.json({ error: 'Bucket not allowed: use one of tost, test' }, { status: 400 })
  }
  if (!key || key.includes('..') || key.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
  }

  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return NextResponse.json({
    key,
    name: key.split('/').pop(),
    type: getFileType(key),
    url: `${getS3Endpoint()}/${bucket}/${encodedKey}`,
    bucket,
  })
}
