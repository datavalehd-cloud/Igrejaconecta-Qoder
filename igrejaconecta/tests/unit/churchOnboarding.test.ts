import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { churches, members } from '@/data/mock'
import {
  CHURCH_CREATE_INVALID_NAME,
  CHURCH_CREATE_NO_ACTOR,
  CHURCH_CREATE_SLUG_TAKEN,
  CREATED_COLUMNS,
  churchSlugCandidates,
} from '@/services/data/churchService'
import {
  demoCreateChurch,
  demoDirectoryChurches,
  demoMyChurches,
  resetChurchFixture,
} from '../fixtures/churchMirror'

/**
 * Onboarding de igreja: o cadastro que faltava para uma comunidade entrar sem SQL.
 * Metade da garantia vive no banco — `churches_insert` (0002) exige criador = quem
 * está logado e status pendente; `trg_churches_creator_admin` (0006) anexa o criador
 * como church_admin. A outra metade é especificada aqui, na loja em memória do
 * fixture, e o insert real é amarrado ao texto das duas guardas — para uma mudança
 * de lado quebrar aqui em vez de criar igreja já aprovada.
 */

const serviceSource = readFileSync(new URL('../../src/services/data/churchService.ts', import.meta.url), 'utf8')
const policiesSql = readFileSync(new URL('../../supabase/migrations/0002_rls_policies.sql', import.meta.url), 'utf8')
const creatorSql = readFileSync(new URL('../../supabase/migrations/0006_church_creator_membership.sql', import.meta.url), 'utf8')

const originalChurches = structuredClone(churches)

afterEach(() => {
  resetChurchFixture()
})

const valid = { name: 'Igreja Nova Esperança', city: ' São José dos Campos ', state: 'SP', denomination: 'Batista' }

describe('createChurch — quem pode chamar', () => {
  it('recusa sem criador e não cria nada', () => {
    const igrejasAntes = churches.length
    const membrosAntes = members.length
    expect(demoCreateChurch(valid)).toEqual({ ok: false, error: CHURCH_CREATE_NO_ACTOR })
    expect(churches).toHaveLength(igrejasAntes)
    expect(members).toHaveLength(membrosAntes)
  })

  it('recusa nome com menos de 3 caracteres, espaços já descontados', () => {
    const antes = churches.length
    for (const name of ['', '  ab  ', '!!']) {
      expect(demoCreateChurch({ name }, { id: 'u9' }), `nome "${name}"`).toEqual({ ok: false, error: CHURCH_CREATE_INVALID_NAME })
    }
    expect(churches).toHaveLength(antes)
  })
})

describe('createChurch — insert + trigger 0006 especificados na loja do fixture', () => {
  it('cria a igreja pendente e ativa, com os campos aparados', () => {
    const result = demoCreateChurch(valid, { id: 'u9' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.church).toMatchObject({
      name: 'Igreja Nova Esperança',
      slug: 'igreja-nova-esperanca',
      city: 'São José dos Campos',
      state: 'SP',
      status: 'active',
      approval_status: 'pending',
    })
    expect(churches.find((c) => c.id === result.church.id)).toMatchObject({
      approval_status: 'pending',
      denomination: 'Batista',
    })
  })

  it('anexa o criador como church_admin ativo da igreja criada', () => {
    const result = demoCreateChurch(valid, { id: 'u9' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(demoMyChurches('u9')).toEqual([
      {
        church_id: result.church.id,
        name: 'Igreja Nova Esperança',
        city: 'São José dos Campos',
        state: 'SP',
        approval_status: 'pending',
        role_key: 'church_admin',
      },
    ])
    expect(members.filter((m) => m.church_id === result.church.id)).toHaveLength(1)
  })

  it('a igreja pendente não entra no diretório público', () => {
    const result = demoCreateChurch(valid, { id: 'u9' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(demoDirectoryChurches().map((c) => c.id)).not.toContain(result.church.id)
  })

  it('campo opcional vazio é null, não string vazia', () => {
    const result = demoCreateChurch({ name: 'Ministério Ágape', whatsapp: '   ' }, { id: 'u9' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const criada = churches.find((c) => c.id === result.church.id)!
    expect(criada.whatsapp).toBeNull()
    expect(criada.denomination).toBeNull()
    expect(criada.city).toBeNull()
  })

  it('devolve só a projeção de criação, sem created_by', () => {
    const result = demoCreateChurch(valid, { id: 'u9' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.church).sort()).toEqual([...CREATED_COLUMNS].sort())
    expect(CREATED_COLUMNS).not.toContain('created_by')
  })
})

describe('createChurch — slug único', () => {
  it('candidatos: base sem acento mais nove sufixos de desempate', () => {
    expect(churchSlugCandidates('São João!')).toEqual([
      'sao-joao', 'sao-joao-2', 'sao-joao-3', 'sao-joao-4', 'sao-joao-5',
      'sao-joao-6', 'sao-joao-7', 'sao-joao-8', 'sao-joao-9', 'sao-joao-10',
    ])
    expect(churchSlugCandidates('!!!')).toEqual([])
  })

  it('em colisão usa o próximo sufixo, em vez de falhar', () => {
    const primeira = demoCreateChurch({ name: 'Igreja Batista Central' }, { id: 'u9' })
    expect(primeira.ok).toBe(true)
    if (!primeira.ok) return
    // 'igreja-batista-central' já existe no mock (ch1).
    expect(primeira.church.slug).toBe('igreja-batista-central-2')

    const segunda = demoCreateChurch({ name: 'Igreja Batista Central' }, { id: 'u8' })
    expect(segunda.ok).toBe(true)
    if (!segunda.ok) return
    expect(segunda.church.slug).toBe('igreja-batista-central-3')
    expect(new Set(churches.map((c) => c.slug)).size).toBe(churches.length)
  })

  it('esgotados os candidatos, diz que não deu e não cria', () => {
    const igrejasAntes = churches.length
    const membrosAntes = members.length
    for (const slug of churchSlugCandidates('Casa de Oração')) {
      churches.push({ ...originalChurches[0]!, id: `ch-${slug}`, name: `Casa de Oração ${slug}`, slug })
    }
    expect(demoCreateChurch({ name: 'Casa de Oração' }, { id: 'u9' })).toEqual({ ok: false, error: CHURCH_CREATE_SLUG_TAKEN })
    expect(churches).toHaveLength(igrejasAntes + churchSlugCandidates('Casa de Oração').length)
    expect(members).toHaveLength(membrosAntes)
  })
})

describe('anti-deriva — o insert do app é o que as guardas SQL aceitam', () => {
  it('manda o criador da sessão e status pendente', () => {
    expect(serviceSource).toContain('created_by: creator.id')
    expect(serviceSource).toContain("approval_status: 'pending'")
    expect(serviceSource).not.toContain("approval_status: 'approved'")
  })

  it('a política churches_insert continua exigindo exatamente isso', () => {
    expect(policiesSql).toContain('create policy churches_insert on public.churches')
    expect(policiesSql).toContain("with check (created_by = auth.uid() and approval_status = 'pending')")
  })

  it('o papel do criador vem do trigger, que só conhece church_admin', () => {
    expect(creatorSql).toContain('create trigger trg_churches_creator_admin')
    expect(creatorSql).toContain('after insert on public.churches')
    expect(creatorSql).toContain("where key = 'church_admin'")
    expect(creatorSql).not.toContain("where key = 'superadmin'")
  })

  it('a loja do fixture não se dá um papel que o trigger não daria', () => {
    const result = demoCreateChurch(valid, { id: 'u9' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const vinculo = members.find((m) => m.church_id === result.church.id)!
    expect(vinculo.role).toBe('church_admin')
    expect(vinculo.status).toBe('active')
    expect(vinculo.role_id).toBe('r2')
  })
})
