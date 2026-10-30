/**
 * Worker URL resolution.
 *
 * `public/service-workers.json` addresses every worker as
 * `http://host.docker.internal:<port>`. Docker Desktop resolves that name;
 * plain Linux Docker does not, and the container is healthy while the app sees
 * nothing — a cartridge card stuck on "Starting…" forever.
 *
 * These checks pin the contract of lib/worker-url.mjs, which is what keeps a
 * launcher that forgot `--add-host=host.docker.internal:host-gateway` working:
 * the registry URL is tried first, the other host forms follow, nothing is
 * duplicated, and a genuinely remote worker is never rewritten.
 *
 *   node --test tests/
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { workerUrlCandidates } from '../lib/worker-url.mjs'

test('the registry URL is tried first', async () => {
  const [first] = await workerUrlCandidates('http://host.docker.internal:8003')
  assert.equal(first, 'http://host.docker.internal:8003')
})

test('the alias gets a loopback twin', async () => {
  const candidates = await workerUrlCandidates('http://host.docker.internal:8003')
  assert.ok(candidates.includes('http://127.0.0.1:8003/'))
})

test('loopback gets the alias twin', async () => {
  const candidates = await workerUrlCandidates('http://127.0.0.1:8000')
  assert.ok(candidates.includes('http://host.docker.internal:8000/'))
})

test('localhost counts as loopback', async () => {
  const candidates = await workerUrlCandidates('http://localhost:8000')
  assert.ok(candidates.includes('http://host.docker.internal:8000/'))
})

test('no candidate is offered twice', async () => {
  const candidates = await workerUrlCandidates('http://host.docker.internal:8003')
  assert.equal(new Set(candidates).size, candidates.length)
})

test('port, path and query survive the rewrite', async () => {
  const candidates = await workerUrlCandidates('http://host.docker.internal:9000/tost/a%20b.png?x=1')
  const twin = candidates.find((url) => url.startsWith('http://127.0.0.1:9000/'))
  assert.ok(twin, 'expected a loopback form of the object URL')
  assert.match(twin, /\/tost\/a%20b\.png\?x=1$/)
})

test('a remote worker is never rewritten', async () => {
  assert.deepEqual(await workerUrlCandidates('http://10.0.0.9:8003'), ['http://10.0.0.9:8003'])
})

test('any extra candidate is a dotted-quad host, not a name', async () => {
  const candidates = await workerUrlCandidates('http://host.docker.internal:8003')
  const extras = candidates.filter((url) => !/host\.docker\.internal|127\.0\.0\.1/.test(url))
  for (const url of extras) {
    assert.match(new URL(url).hostname, /^\d{1,3}(\.\d{1,3}){3}$/)
  }
})

test('an unparsable URL is passed through, not thrown', async () => {
  assert.deepEqual(await workerUrlCandidates('not a url'), ['not a url'])
})
