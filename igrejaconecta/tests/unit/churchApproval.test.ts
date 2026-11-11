import { describe, it, expect, afterEach } from 'vitest'
import { churches, auditLogs } from '@/data/mock'
import { setChurchApprovalStatus, APPROVAL_COLUMNS } from '@/services/data/churchApprovalService'
import { demoDirectoryChurches, DIRECTORY_COLUMNS } from '@/services/data/churchService'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ApprovalStatus, Church, RoleKey } from '@/types'

const root = path.resolve(import.meta.dirname, '../..')
const ddl = readFileSync(path.join(root, 'supabase/migrations/0001_initial_schema.sql'), 'utf8')
const suite = readFileSync(path.join(root, 'supabase/tests/database/rls_isolation.sql'), 'utf8')

const original = new Map(churches.map((c) => [c.id, { approval_status: c.approval_status, updated_at: c.updated_at }]))
const originalAudit = structuredClone(auditLogs)
const admin = { id: 'u0', email: 'admin@igrejaconecta.app', role: 'superadmin' as const }

afterEach(() => {
  auditLogs.splice(0, auditLogs.length, ...structuredClone(originalAudit))
  for (const church of churches) {
    Object.assign(church, original.get(church.id))
  }
})

const statusOf = (id: string) => churches.find((c) => c.id === id)?.approval_status

const jStart = suite.indexOf('-- GRUPO J')
if (jStart < 0) throw new Error("a suíte perdeu o marco '-- GRUPO J'; as asserções anti-deriva da aprovação precisam dele")
const grupoJ = suite.slice(jStart)

/**
 * Varre o texto do grupo J e devolve cada `select <colunas> from public.churches
 * where ...` com suas colunas normalizadas e a linha do `where`. Uma regex sobre o
 * texto não serve: as projeções têm continuação de linha e o `from` de uma cai
 * dentro do alcance da outra, então o casamento pega blocos vizinhos.
 *
 * Fica só quem começa em `id`, que é como as duas projeções congeladas (a do update
 * e a do diretório) começam; os `select count(*) ...` do mesmo bloco são descartados.
 */
function suiteProjections(text: string) {
  const lines = text.split('\n')
  const found: { cols: string[]; where: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].trim().match(/^select\s+(.+)$/)
    if (!head) continue
    const body = [head[1]]
    let j = i + 1
    while (j < lines.length && !/\bfrom\b/.test(lines[j])) {
      body.push(lines[j].trim())
      j++
    }
    if (!/^from public\.churches$/.test((lines[j] ?? '').trim())) continue
    const listed = body.join(' ').split(',').map((column) => column.trim()).filter(Boolean)
    if (listed[0] !== 'id') continue
    found.push({ cols: listed.sort(), where: (lines[j + 1] ?? '').trim() })
  }
  return found
}

const grupoJProjections = suiteProjections(grupoJ)

/** A projeção do grupo J que lê de volta o update aprovado em F. */
const readBackProjection = grupoJProjections.find((p) => p.where.startsWith("where id = current_setting('app.church_f')"))
/** A projeção do grupo J que lê o diretório público. */
const directoryProjection = grupoJProjections.find((p) => p.where.startsWith("where approval_status = 'approved' and status = 'active'"))

describe('aprovação de igreja — espelho demo da escrita (0002 + 0004)', () => {
  it('recusa quem não é SuperAdmin, com a mesma mensagem do 42501', async () => {
    for (const role of ['church_admin', 'manager', 'communicator', 'pastor', 'visitor', undefined] as const) {
      const result = await setChurchApprovalStatus('ch1', 'rejected', { ...admin, role: role as RoleKey | undefined })
      expect(result.ok, `papel ${String(role)} aprovou/rejeitou sem ser SuperAdmin`).toBe(false)
      expect(result.error).toContain('aprovação é exclusividade do SuperAdmin')
    }
    expect(statusOf('ch1')).toBe('approved')
  })

  it('aprovar põe a igreja no diretório — o caso J1 escrito em TypeScript', async () => {
    expect(demoDirectoryChurches().map((c) => c.id)).toEqual(['ch2', 'ch1'])

    const result = await setChurchApprovalStatus('ch3', 'approved', admin)
    expect(result.ok).toBe(true)
    expect(statusOf('ch3')).toBe('approved')
    expect(demoDirectoryChurches().map((c) => c.id)).toContain('ch3')
  })

  it('suspender e rejeitar tiram do diretório, e o read-back bate com a lista', async () => {
    for (const next of ['suspended', 'rejected'] as const) {
      await setChurchApprovalStatus('ch1', next, admin)
      const listed = demoDirectoryChurches().map((c) => c.id)
      expect(listed, `${next} continuou no diretório`).not.toContain('ch1')
      expect(listed).toContain('ch2')

      const returned = (await setChurchApprovalStatus('ch1', 'approved', admin)).church as Church
      expect(returned.approval_status).toBe('approved')
      expect(demoDirectoryChurches().map((c) => c.id)).toContain('ch1')
    }
  })

  it('a pendente que não está no diretório some também da lista in_review', async () => {
    // ch3 é pending no mock: aprovar é o que a traz para a leitura pública.
    expect(demoDirectoryChurches().map((c) => c.id)).not.toContain('ch3')
    await setChurchApprovalStatus('ch3', 'in_review', admin)
    expect(demoDirectoryChurches().map((c) => c.id)).not.toContain('ch3')
  })

  it('sem a linha, não há sucesso inventado', async () => {
    const result = await setChurchApprovalStatus('ch-inexistente', 'approved', admin)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('não encontrada')
  })

  it('devolve só a projeção de gestão, nunca a linha inteira', async () => {
    const result = await setChurchApprovalStatus('ch1', 'approved', admin)
    expect(Object.keys(result.church as Church).sort()).toEqual([...APPROVAL_COLUMNS].sort())
    for (const forbidden of ['email', 'zip', 'website', 'lat', 'lng', 'created_by'] as const) {
      expect(result.church, `campo ${forbidden} no retorno da aprovação`).not.toHaveProperty(forbidden)
    }
  })
})

describe('aprovação de igreja — deriva de schema e de suíte', () => {
  it('o CHECK de approval_status aceita todos os status que a tela escreve', () => {
    const tableBlock = ddl.slice(ddl.indexOf('create table if not exists public.churches'))
    const check = tableBlock.slice(0, tableBlock.indexOf('created_by')).match(/approval_status[^\n]*\n[^\n]*/)?.[0] ?? ''
    for (const value of ['pending', 'in_review', 'approved', 'rejected', 'suspended'] as ApprovalStatus[]) {
      expect(check, `approval_status perdeu '${value}' do CHECK`).toContain(`'${value}'`)
    }
  })

  it('a projeção do update está escrita por extenso no grupo J da suíte', () => {
    if (!readBackProjection) throw new Error('o read-back de J1 sumiu da suíte; a asserção anti-deriva tem de ser atualizada junto')
    expect(readBackProjection.cols).toEqual([...APPROVAL_COLUMNS].sort())
  })

  it('o grupo J também escreve a projeção do diretório, que é a outra metade', () => {
    if (!directoryProjection) throw new Error('o diretório de J1 sumiu da suíte; a asserção anti-deriva tem de ser atualizada junto')
    expect(directoryProjection.cols).toEqual([...DIRECTORY_COLUMNS].sort())
  })

  it('nenhuma coluna fora da projeção de gestão aparece no read-back do grupo J', () => {
    // É esta asserção que dá dentes para o lado que importa: `email` aparece no
    // grupo J (J4 prova que a RLS não esconde coluna), então "toda coluna do app
    // está escrita no SQL" passaria mesmo com o app vazando. Aqui é o contrário:
    // o read-back do SuperAdmin não pode pedir nada além da projeção de gestão.
    if (!readBackProjection) throw new Error('o read-back de J1 sumiu da suíte; a asserção anti-deriva tem de ser atualizada junto')
    for (const forbidden of ['email', 'zip', 'website', 'lat', 'lng', 'created_by'] as const) {
      expect(readBackProjection.cols, `a projeção de gestão passou a pedir ${forbidden}`).not.toContain(forbidden)
    }
  })
})
