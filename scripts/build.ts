/**
 * Builds the standalone owner recovery page: ONE html file with the bundled script inlined (no runtime dependencies).
 * Output: dist/agentflow-owner-recovery.html and dist/agentflow-owner-recovery.html.sha256. Usage: bun scripts/build.ts [outDir]
 *
 * The page shows the source commit it was built from: RECOVERY_BUILD_COMMIT (the release workflow sets it to the tagged commit) or
 * this checkout's HEAD, with "-dirty" when the build inputs differ from that commit. A dirty build must never be distributed.
 */
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { build } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ARTIFACT = 'agentflow-owner-recovery.html'

function buildId(): string {
  if (process.env.RECOVERY_BUILD_COMMIT) return process.env.RECOVERY_BUILD_COMMIT
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'scripts', 'package.json', 'bun.lock'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return dirty ? `${head}-dirty` : head
  } catch { return 'unknown' }
}

export async function buildOwnerRecovery(outDir = join(ROOT, 'dist')): Promise<{ file: string; sha256: string; bytes: number; build: string }> {
  const id = buildId()
  const r = await build({ entryPoints: [join(ROOT, 'src/page.ts')], bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minify: true, write: false, legalComments: 'none',
    define: { __RECOVERY_BUILD__: JSON.stringify(id) } })
  const js = r.outputFiles[0]!.text.replace(/<\/script/gi, '<\\/script')
  // normalize line endings so a Windows checkout and a Linux release runner produce the same bytes
  const template = readFileSync(join(ROOT, 'src/page.html'), 'utf8').replace(/\r\n/g, '\n')
  if (!template.includes('/*__RECOVERY_SCRIPT__*/')) throw new Error('template placeholder missing')
  const html = template.replace('/*__RECOVERY_SCRIPT__*/', () => js)
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, ARTIFACT)
  writeFileSync(file, html)
  const sha256 = createHash('sha256').update(html).digest('hex')
  writeFileSync(`${file}.sha256`, `${sha256}  ${ARTIFACT}\n`)
  return { file, sha256, bytes: Buffer.byteLength(html), build: id }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = await buildOwnerRecovery(process.argv[2])
  console.log(`${o.file} (${(o.bytes / 1024).toFixed(0)} KB) build ${o.build} sha256 ${o.sha256}`)
}
