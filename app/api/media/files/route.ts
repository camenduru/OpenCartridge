import { NextRequest, NextResponse } from 'next/server'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getS3Client, isAllowedBucket, getFileType } from '@/lib/s3'

export async function GET(request: NextRequest) {
  const bucket = request.nextUrl.searchParams.get('bucket')
  if (!isAllowedBucket(bucket)) {
    return NextResponse.json({ error: 'Bucket not allowed: use one of tost, test' }, { status: 400 })
  }
  const prefix = request.nextUrl.searchParams.get('prefix') || ''

  try {
    const response = await getS3Client().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
    )

    const files = (response.Contents || [])
      .map(item => ({
        key: item.Key,
        name: (item.Key || '').split('/').pop(),
        size: item.Size,
        lastModified: item.LastModified ?? new Date(0),
        type: getFileType(item.Key || ''),
      }))
      .filter(f => f.name)
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())

    return NextResponse.json({ files, bucket })
  } catch (error) {
    console.error('Error listing files:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list files' },
      { status: 500 }
    )
  }
}
