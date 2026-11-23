/**
 * Builds the standalone owner recovery page: ONE html file with the bundled script inlined (no runtime dependencies).
 * Output: dist/agentflow-owner-recovery.html and dist/agentflow-owner-recovery.html.sha256. Usage: bun scripts/build.ts [outDir]
 *
 * The page shows the source commit it was built from: RECOVERY_BUILD_COMMIT (the release workflow sets it to the tagged commit) or
 * this checkout's HEAD, with "-dirty" when the build inputs differ from that commit. A dirty build must never be distributed.
 * The file ends with the license notices it must carry: this project's MIT license and the license of every bundled package.
 */
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { build } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ARTIFACT = 'agentflow-owner-recovery.html'
const NL = '\n'
const crlfToLf = (s: string) => s.split('\r\n').join(NL)

function buildId(): string {
  if (process.env.RECOVERY_BUILD_COMMIT) return process.env.RECOVERY_BUILD_COMMIT
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'scripts', 'package.json', 'bun.lock', 'LICENSE'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return dirty ? `${head}-dirty` : head
  } catch { return 'unknown' }
}

type Metafile = { outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }> }
/** the license notices the artifact must carry: this project's own, then every third-party package esbuild actually bundled */
function licenseNotices(metafile: Metafile): { text: string; packages: string[] } {
  const inputs = Object.values(metafile.outputs)[0]!.inputs
  const dirs = new Set<string>()
  for (const [f, v] of Object.entries(inputs)) {
    const m = f.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)
    if (m && v.bytesInOutput > 0) dirs.add(m[1]!)
  }
  const pkgs = [...dirs].map((d) => {
    const pj = JSON.parse(readFileSync(join(ROOT, d, 'package.json'), 'utf8')) as { name: string; version: string; license?: string }
    const lic = readdirSync(join(ROOT, d)).filter((x) => /^licen[cs]e(\.(md|txt))?$/i.test(x)).sort()[0]
    if (!lic) throw new Error(`no LICENSE file for bundled package ${pj.name}`)
    return { id: `${pj.name}@${pj.version}`, license: pj.license ?? 'see text', text: crlfToLf(readFileSync(join(ROOT, d, lic), 'utf8')).trim() }
  }).sort((a, b) => (a.id < b.id ? -1 : 1))
  const own = crlfToLf(readFileSync(join(ROOT, 'LICENSE'), 'utf8')).trim()
  const sections = [`AgentFlow owner recovery (this page):${NL}${NL}${own}`, ...pkgs.map((p) => `${p.id} (${p.license}), bundled in this file:${NL}${NL}${p.text}`)]
  const body = sections.join(`${NL}${NL}----------------------------------------${NL}${NL}`)
  if (/--!?>/.test(body)) throw new Error('a license text would end the HTML comment early')
  return { text: `${NL}<!--${NL}LICENSE NOTICES${NL}${NL}${body}${NL}-->${NL}`, packages: pkgs.map((p) => p.id) }
}

export async function buildOwnerRecovery(outDir = join(ROOT, 'dist')): Promise<{ file: string; sha256: string; bytes: number; build: string; packages: string[] }> {
  const id = buildId()
  const r = await build({ entryPoints: [join(ROOT, 'src/page.ts')], bundle: true, platform: 'browser', format: 'iife', target: 'es2020', minify: true, write: false, legalComments: 'none', metafile: true,
    define: { __RECOVERY_BUILD__: JSON.stringify(id) } })
  const js = r.outputFiles[0]!.text.replace(/<\/script/gi, '<\\/script')
  // normalize line endings so a Windows checkout and a Linux release runner produce the same bytes
  const template = crlfToLf(readFileSync(join(ROOT, 'src/page.html'), 'utf8'))
  if (!template.includes('/*__RECOVERY_SCRIPT__*/')) throw new Error('template placeholder missing')
  const notices = licenseNotices(r.metafile as Metafile)
  const html = template.replace('/*__RECOVERY_SCRIPT__*/', () => js).trimEnd() + notices.text
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, ARTIFACT)
  writeFileSync(file, html)
  const sha256 = createHash('sha256').update(html).digest('hex')
  writeFileSync(`${file}.sha256`, `${sha256}  ${ARTIFACT}${NL}`)
  return { file, sha256, bytes: Buffer.byteLength(html), build: id, packages: notices.packages }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = await buildOwnerRecovery(process.argv[2])
  console.log(`${o.file} (${(o.bytes / 1024).toFixed(0)} KB) build ${o.build} sha256 ${o.sha256}`)
  console.log(`license notices: this page + ${o.packages.join(', ')}`)
}
