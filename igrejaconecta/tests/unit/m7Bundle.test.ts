import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundlePath = join(root, 'supabase', 'deploy', 'm7_apply.sql')
const PENDING = [
  '0015_ministries_and_social_accounts.sql',
  '0016_visitor_favorites_preferences.sql',
  '0017_church_networks.sql',
  '0018_support_tickets.sql',
  '0019_security_events.sql',
  '0020_drop_tiktok_from_campaigns.sql',
  '0021_ministry_membership_guard.sql',
]

/**
 * O bundle M7 é o texto que vai para o SQL Editor do projeto real. Se ele divergir
 * das migrações, o banco no ar fica num estado que nenhum teste local mediu — e a
 * divergência é silenciosa, porque o arquivo continua sendo SQL válido.
 */
describe('o bundle aplicado no projeto real é o que as migrações produzem', () => {
  it('nenhuma migração pendente ficou de fora do bundle', () => {
    const bundle = readFileSync(bundlePath, 'utf8')
    for (const file of PENDING) {
      expect(bundle, file).toContain(`-- ===================== ${file} =====================`)
      expect(bundle, file).toContain(
        readFileSync(join(root, 'supabase', 'migrations', file), 'utf8').trim(),
      )
    }
  })

  it('o bundle no disco é o que o gerador produz agora', () => {
    const antes = readFileSync(bundlePath, 'utf8')
    execFileSync(process.execPath, ['scripts/m7-bundle.mjs'], { cwd: root, encoding: 'utf8' })
    const agora = readFileSync(bundlePath, 'utf8')
    if (agora !== antes) {
      // Devolve o arquivo à versão que está no repositório: um teste não pode
      // consertar em silêncio o artefato que ele acabou de reprovar.
      writeFileSync(bundlePath, antes)
      expect.fail('bundle desatualizado em relação às migrações — rode `npm run m7:bundle`')
    }
    expect(agora).toBe(antes)
  })

  it('a verificacao do bundle cobre o conjunto inteiro, nao um punhado de nomes', () => {
    const bundle = readFileSync(bundlePath, 'utf8')
    // Os números são os declarados pelos próprios arquivos; mudando uma migração,
    // este caso quebra até o bundle ser regerado com a contagem nova.
    expect(bundle).toMatch(/M7-OK: % tabelas, % politicas, % triggers, % funcoes conferidos'/)
    expect(bundle).toMatch(/raise notice 'M7-OK[^\n]*\n\s*\d+, \d+, \d+, \d+;/)
    const counts = /raise notice 'M7-OK[^;]*?(\d+), (\d+), (\d+), (\d+);/s.exec(bundle)?.slice(1).map(Number)
    expect(counts).toEqual([10, 28, 8, 6])
  })

  it('o bundle nao apaga nada: sem drop de tabela, sem delete, sem truncate', () => {
    const bundle = readFileSync(bundlePath, 'utf8')
    // `drop policy/trigger/constraint if exists` é o re-criar idempotente das
    // migrações. O que não pode aparecer é objeto de dados ou de tabela sumindo.
    expect(bundle).not.toMatch(/\bdrop\s+(table|schema|database|view|column)\b/i)
    expect(bundle).not.toMatch(/\btruncate\b/i)
    expect(bundle).not.toMatch(/\bdelete\s+from\b/i)
  })
})
