import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import EmbeddedPostgres from 'embedded-postgres'

// Sobe um Postgres real embarcado (sem Docker), aplica shim + migrações + seed e
// roda a suíte de isolamento. O shim só existe para o ambiente local: no projeto
// Supabase real, auth.* e storage.* já vêm do provedor.

const root = path.resolve(import.meta.dirname, '..')
const dataDir = path.join(root, '.rls-data')
const port = 54329

// Um run interrompido no meio deixa workers do Postgres embarcado vivos, e eles
// seguram o bloco de memória compartilhada que o initdb do próximo run precisa
// criar ("pre-existing shared memory block is still in use"). Matamos apenas os
// processos cujo executável está dentro do nosso próprio node_modules.
function reapStaleEmbeddedPostgres() {
  if (process.platform !== 'win32') return
  const nativeBin = path
    .join(root, 'node_modules', '@embedded-postgres', 'windows-x64', 'native')
    .replaceAll('\\', '/')
    .replaceAll("'", "''")
  try {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='postgres.exe'"` +
        ` | Where-Object { $_.CommandLine -like '*${nativeBin}*' }` +
        ` | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { stdio: 'ignore' })
  } catch {
    // nada rodando (ou sem permissão): o initdb dirá se ainda houver conflito
  }
}

const SETUP = [
  'supabase/tests/local/shim_supabase.sql',
  'supabase/migrations/0001_initial_schema.sql',
  'supabase/migrations/0002_rls_policies.sql',
  'supabase/migrations/0003_storage_buckets.sql',
  'supabase/migrations/0004_rls_hardening.sql',
  'supabase/migrations/0005_superadmin_role_guard.sql',
  'supabase/migrations/0006_church_creator_membership.sql',
  'supabase/migrations/0007_church_roster_view.sql',
  'supabase/migrations/0008_church_invitations.sql',
  'supabase/migrations/0009_church_approval_audit.sql',
  'supabase/migrations/0010_audit_insert_guard.sql',
  'supabase/migrations/0011_events.sql',
  'supabase/migrations/0012_event_registrations.sql',
  'supabase/migrations/0013_branches_location.sql',
  'supabase/migrations/0014_marketing_campaigns.sql',
  'supabase/migrations/0015_ministries_and_social_accounts.sql',
  'supabase/migrations/0016_visitor_favorites_preferences.sql',
  'supabase/migrations/0017_church_networks.sql',
  'supabase/migrations/0018_support_tickets.sql',
  'supabase/migrations/0019_security_events.sql',
  'supabase/migrations/0020_drop_tiktok_from_campaigns.sql',
  'supabase/migrations/0021_ministry_membership_guard.sql',
  'supabase/seed.sql',
]
const SUITES = ['supabase/tests/database/rls_isolation.sql']

// Separador de declarações que respepta $$ ... $$, comentários e aspas simples.
function splitStatements(sql) {
  const out = []
  let buf = ''
  let i = 0
  let dollarTag = null
  let inSQuote = false
  let inLineComment = false
  let blockDepth = 0

  while (i < sql.length) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)

    if (inLineComment) {
      buf += ch
      if (ch === '\n') inLineComment = false
      i++
      continue
    }
    if (blockDepth > 0) {
      if (two === '/*') {
        blockDepth++
        buf += two
        i += 2
      } else if (two === '*/') {
        blockDepth--
        buf += two
        i += 2
      } else {
        buf += ch
        i++
      }
      continue
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag
        i += dollarTag.length
        dollarTag = null
      } else {
        buf += ch
        i++
      }
      continue
    }
    if (inSQuote) {
      buf += ch
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          buf += "'"
          i++
        } else {
          inSQuote = false
        }
      }
      i++
      continue
    }

    if (two === '--') {
      inLineComment = true
      buf += two
      i += 2
      continue
    }
    if (two === '/*') {
      blockDepth = 1
      buf += two
      i += 2
      continue
    }
    if (ch === "'") {
      inSQuote = true
      buf += ch
      i++
      continue
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i))
      if (tag) {
        dollarTag = tag[0]
        buf += dollarTag
        i += dollarTag.length
        continue
      }
    }
    if (ch === ';') {
      out.push(buf)
      buf = ''
      i++
      continue
    }
    buf += ch
    i++
  }
  out.push(buf)

  return out.filter((s) => s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim().length > 0)
}

async function runFile(client, file) {
  const statements = splitStatements(readFileSync(path.join(root, file), 'utf8'))
  for (const [index, stmt] of statements.entries()) {
    try {
      await client.query(stmt)
    } catch (err) {
      console.error(`\n  FALHOU: ${file} — declaracao ${index + 1}/${statements.length}`)
      console.error(`    ${String(err.message).trim()}`)
      console.error(`    SQL: ${stmt.replace(/\s+/g, ' ').trim().slice(0, 260)}`)
      return false
    }
  }
  console.log(`  ok  ${file} (${statements.length} declaracoes)`)
  return true
}

// Antes de apagar o diretório, mata resíduo de um run anterior: sem isso o rmSync
// deixa a pasta pela metade e o initdb reclama da memória compartilhada.
reapStaleEmbeddedPostgres()
rmSync(dataDir, { recursive: true, force: true })

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: false,
})

let client = null
let ok = true

try {
  console.log('Postgres embarcado: inicializando cluster temporario...')
  await pg.initialise()
  await pg.start()
  client = pg.getPgClient('postgres', '127.0.0.1')
  client.on('notice', (n) => console.log(`    aviso: ${String(n.message).trim()}`))
  await client.connect()

  console.log('\nAplicando schema do projeto:')
  for (const file of SETUP) {
    if (!(await runFile(client, file))) {
      ok = false
      break
    }
  }

  if (ok) {
    console.log('\nRodando suítes de isolamento:')
    for (const file of SUITES) {
      if (!(await runFile(client, file))) {
        ok = false
        break
      }
    }
  }
} catch (err) {
  ok = false
  console.error(`\nERRO de ambiente: ${String(err && err.message ? err.message : err)}`)
} finally {
  if (client) await client.end().catch(() => {})
  await pg.stop().catch(() => {})
  // O io_worker do Postgres 18 sobrevive ao stop() e segura o event loop do Node:
  // sem este passo o comando imprime o resultado e nunca volta para o terminal.
  reapStaleEmbeddedPostgres()
  // persistent:false deveria apagar o cluster, mas o worker morto no meio deixa
  // ~40MB em .rls-data; o próximo run apagaria de qualquer forma.
  rmSync(dataDir, { recursive: true, force: true })
}

console.log(ok ? '\nRLS: PASSOU' : '\nRLS: FALHOU')
// exitCode em vez de exit(): deixa o encerramento graceful do Postgres rodar e
// evita órfãos segurando memória compartilhada (initdb do próximo run falharia).
process.exitCode = ok ? 0 : 1