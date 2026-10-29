import { NextResponse } from 'next/server'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Self-update mechanism (learned from TostAI-Sprite-Sheet-Studio): the docker
// image clones this repository, and a running container can pull the latest
// source, rebuild and re-exec itself — no image rebuild needed for UI changes.
const REPO = 'camenduru/OpenCartridge'
const APP_DIR = process.cwd()

function currentRev(): string | null {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
  } catch {
    return null
  }
}

function latestCommit(): { sha: string; subject: string } | null {
  try {
    const out = execSync(`curl -s https://api.github.com/repos/${REPO}/commits?per_page=1`, {
      encoding: 'utf8',
      timeout: 15000,
    })
    const commit = JSON.parse(out)?.[0]
    if (!commit) return null
    return {
      sha: commit.sha,
      subject: (commit.commit?.message || '').split('\n')[0],
    }
  } catch {
    return null
  }
}

// What is installed, so the UI can say so before anything runs
export async function GET() {
  const rev = currentRev()
  const latest = rev ? latestCommit() : null
  return NextResponse.json({
    ok: true,
    repo: REPO,
    rev,
    latest: latest?.sha ?? null,
    upToDate: rev !== null && latest !== null && rev === latest.sha,
  })
}

export async function POST() {
  const rev = currentRev()
  if (!rev) {
    return NextResponse.json(
      { ok: false, error: 'Not a git checkout — updates are available in the OpenCartridge docker image' },
      { status: 400 }
    )
  }

  const latest = latestCommit()
  if (!latest) {
    return NextResponse.json({ ok: false, error: 'Could not reach github.com' }, { status: 502 })
  }
  if (latest.sha === rev) {
    return NextResponse.json({
      ok: true,
      updated: false,
      rev,
      message: `Already up to date at ${rev.slice(0, 10)}`,
    })
  }

  try {
    const run = (cmd: string) =>
      execSync(cmd, { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 })
        .toString()
        .split('\n')
        .slice(-8)
        .join('\n')

    run(`git fetch origin main`)
    run(`git reset --hard ${latest.sha}`)
    run(`pnpm install --frozen-lockfile`)
    const buildTail = run(`pnpm build`)

    fs.writeFileSync(path.join(APP_DIR, '.update_rev'), latest.sha)

    // The container's start script restarts the server when it exits,
    // so the freshly built UI comes up on the next loop iteration.
    setTimeout(() => process.exit(0), 1500)

    return NextResponse.json({
      ok: true,
      updated: true,
      rev: latest.sha,
      message: `Updated to ${latest.sha.slice(0, 10)} — server is restarting…`,
      buildTail,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message.slice(-600) : 'Update failed',
      },
      { status: 500 }
    )
  }
}
