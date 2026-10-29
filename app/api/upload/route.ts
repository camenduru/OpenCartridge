import { type NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    // Ignore absent or literal "undefined"/"null" values from stale clients
    const getFormUrl = (name: string): string | undefined => {
      const value = formData.get(name) as string | null
      if (!value || value === "undefined" || value === "null" || !value.trim()) return undefined
      return value
    }
    const localUploadUrl = getFormUrl("localUploadUrl") ?? "http://localhost:9000"
    // Base URL used for the object link handed back to the caller. The worker
    // downloads its inputs from inside its container, where the shared MinIO
    // may live at a different address (e.g. host.docker.internal:9000) than
    // from the browser (localhost:9000).
    const workerUploadUrl = getFormUrl("workerUploadUrl")

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Upload to the local MinIO server
    const ext = file.name.split('.').pop()
    const filename = `${randomUUID()}.${ext}`
    const minioUrl = `${localUploadUrl}/tost/${filename}`

    const response = await fetch(minioUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
    })

    if (!response.ok) {
      throw new Error(`MinIO upload failed: ${response.status} ${response.statusText}`)
    }

    const urlBase = workerUploadUrl || localUploadUrl
    const url = `${urlBase}/tost/${filename}`
    return NextResponse.json({ url })
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
