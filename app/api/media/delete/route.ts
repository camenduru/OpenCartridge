import { NextRequest, NextResponse } from 'next/server'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getS3Client, isAllowedBucket } from '@/lib/s3'

export async function POST(request: NextRequest) {
  try {
    const { bucket, key } = await request.json()

    if (!isAllowedBucket(bucket)) {
      return NextResponse.json({ error: 'Bucket not allowed: use one of tost, test' }, { status: 400 })
    }
    if (!key || typeof key !== 'string' || key.includes('..') || key.startsWith('/')) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
    }

    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting object:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete object' },
      { status: 500 }
    )
  }
}
