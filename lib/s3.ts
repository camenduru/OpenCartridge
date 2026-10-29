import { S3Client } from '@aws-sdk/client-s3'

// Shared MinIO appliance (camenduru/minio-old). Only these buckets are exposed
// to the media viewer and its API routes.
export const ALLOWED_BUCKETS = ['tost', 'test'] as const
export type AllowedBucket = (typeof ALLOWED_BUCKETS)[number]

export function isAllowedBucket(bucket: string | null | undefined): bucket is AllowedBucket {
  return !!bucket && (ALLOWED_BUCKETS as readonly string[]).includes(bucket)
}

export function getS3Endpoint(): string {
  return process.env.OPENHIGGS_S3_ENDPOINT || 'http://localhost:9000'
}

export function getFileType(key: string): string {
  const ext = key.toLowerCase().split('.').pop() || ''
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif']
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm3u8']
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus']
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'json', 'xml', 'html', 'htm', 'md']
  const model3dExts = ['glb', 'gltf', 'fbx', 'obj', 'dae', '3ds', 'ply']

  if (imageExts.includes(ext)) return 'image'
  if (videoExts.includes(ext)) return 'video'
  if (audioExts.includes(ext)) return 'audio'
  if (docExts.includes(ext)) return 'document'
  if (model3dExts.includes(ext)) return 'model3d'
  return 'other'
}

let s3Client: S3Client | null = null

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.OPENHIGGS_S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.OPENHIGGS_S3_ACCESS_KEY || 'tost',
        secretAccessKey: process.env.OPENHIGGS_S3_SECRET_KEY || 'tosttost',
      },
      endpoint: getS3Endpoint(),
      forcePathStyle: true,
    })
  }
  return s3Client
}
