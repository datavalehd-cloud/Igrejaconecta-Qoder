import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { campaigns, members } from '@/data/mock'
import * as marketingService from '@/services/data/marketingService'
import {
  CAMPAIGN_COLUMNS,
  CAMPAIGN_INSERT_COLUMNS,
  CAMPAIGN_MANAGE_DENIED,
  CAMPAIGN_NO_CHURCH,
  CAMPAIGN_NOT_FOUND,
  CAMPAIGN_PUBLISH_NOT_CONNECTED,
  createCampaign,
  fetchChurchCampaigns,
  publishCampaign,
  setCampaignStatus,
  updateCampaign,
  validateCampaignDraft,
  type CampaignActor,
  type CampaignDraft,
} from '@/services/data/marketingService'
import {
  demoChurchCampaigns,
  demoCreateCampaign,
  demoSetCampaignStatus,
  demoUpdateCampaign,
} from '../fixtures/marketingMirror'
import type { CampaignNetwork } from '@/types'

/**
 * Campanhas (0014, Fase 5). A RLS é por linha e não limita coluna, então a projeção
 * daqui é o contrato do que chega ao navegador; os espelhos demo reproduzem a
 * audiência da política (`marketing.manage` na igreja, membro **ativo**, SuperAdmin
 * transversal — casos P2/P3). Não existe delete em camada nenhuma: campanha é
 * cancelada, não apagada (P8). E o que distingue este serviço é a publicação:
 * `publishCampaign` NUNCA escreve — devolve sempre "não conectado", espelhando o
 * trigger `enforce_campaign_publish` (P7) e a regra de só mostrar estado confirmado.
 */

const backend = vi.hoisted(() => ({ supabase: null as { from: ReturnType<typeof vi.fn> } | null }))
vi.mock('@/services/supabase/client', () => backend)

let readResult: { data: unknown; error: unknown } = { data: [], error: null }
const chain = {
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  maybeSingle: vi.fn(),
  // A leitura termina em `.order()` (SuperAdmin) ou `.eq()` (membro) e é esperada
  // com `await query`; o builder real é thenable, e a cadeia simulada precisa ser.
  then: vi.fn(),
}
const from = vi.fn()
const originalCampaigns = structuredClone(campaigns)

const campaignsDdl = tableBlock('0014_marketing_campaigns.sql', 'marketing_campaigns')

function validDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    name: '  Divulgação Congresso  ',
    message: '  Texto base da campanha.  ',
    networks: ['instagram', 'whatsapp'],
    event_id: 'e1',
    ...overrides,
  }
}

beforeEach(() => {
  // O app não tem mais caminho sem Supabase: o cliente simulado está montado para
  // todos os casos, e o que exercita a loja em memória chama o fixture direto.
  backend.supabase = { from }
  vi.resetAllMocks()
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.insert.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  chain.maybeSingle.mockResolvedValue({ data: null, error: null })
  chain.then.mockImplementation((onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
    Promise.resolve(readResult).then(onFulfilled, onRejected),
  )
  readResult = { data: [], error: null }
  from.mockReturnValue(chain)
})

afterEach(() => {
  vi.restoreAllMocks()
  campaigns.splice(0, campaigns.length, ...structuredClone(originalCampaigns))
  backend.supabase = null
})

describe('projeção — o que chega ao navegador', () => {
  it('toda coluna projetada existe na tabela da migração 0014', () => {
    for (const column of CAMPAIGN_COLUMNS) {
      expect(hasColumn(campaignsDdl, column), `marketing_campaigns.${column}`).toBe(true)
    }
  })

  it('deixa created_by de fora, mas traz os carimbos (a lista ordena por created_at)', () => {
    expect(CAMPAIGN_COLUMNS).not.toContain('created_by')
    expect(CAMPAIGN_COLUMNS).toContain('created_at')
    expect(CAMPAIGN_COLUMNS).toContain('updated_at')
    const [row] = demoChurchCampaigns('ch1', { role: 'church_admin', userId: 'u1' })
    expect(Object.keys(row!).sort()).toEqual([...CAMPAIGN_COLUMNS].sort())
  })

  it('a criação envia a igreja da sessão; nunca o id nem os carimbos', () => {
    expect(CAMPAIGN_INSERT_COLUMNS).toContain('church_id')
    expect(CAMPAIGN_INSERT_COLUMNS).not.toContain('id')
    expect(CAMPAIGN_INSERT_COLUMNS).not.toContain('created_at')
    expect(CAMPAIGN_INSERT_COLUMNS).not.toContain('created_by')
    for (const column of CAMPAIGN_INSERT_COLUMNS) {
      expect(CAMPAIGN_COLUMNS).toContain(column)
    }
  })
})

describe('leitura demo — espelho de marketing_campaigns_read', () => {
  it('membro ativo lê as campanhas da própria igreja, mais recentes primeiro', () => {
    const rows = demoChurchCampaigns('ch1', { role: 'church_admin', userId: 'u1' })
    expect(rows.map((c) => c.id)).toEqual(['cp3', 'cp2', 'cp1'])
    expect(rows.every((c) => c.church_id === 'ch1')).toBe(true)
  })

  it('não vaza campanha da igreja vizinha', () => {
    const ids = demoChurchCampaigns('ch1', { role: 'church_admin', userId: 'u1' }).map((c) => c.id)
    expect(ids).not.toContain('cp4')
    expect(demoChurchCampaigns('ch2', { role: 'church_admin', userId: 'u4' }).map((c) => c.id)).toEqual(['cp4'])
  })

  it('pastor não tem marketing.manage: não lê campanha nenhuma (caso P3)', () => {
    expect(demoChurchCampaigns('ch1', { role: 'pastor', userId: 'u1' })).toEqual([])
  })

  it('visitante não lê', () => {
    expect(demoChurchCampaigns('ch1', { role: 'visitor' })).toEqual([])
  })

  it('vínculo convidado não lê (caso P3)', () => {
    // u3 é communicator em ch1 mas com status 'invited'.
    expect(members.find((m) => m.user_id === 'u3')?.status).toBe('invited')
    expect(demoChurchCampaigns('ch1', { role: 'communicator', userId: 'u3' })).toEqual([])
  })

  it('gerente e comunicador ativos leem (têm marketing.manage)', () => {
    expect(demoChurchCampaigns('ch1', { role: 'manager', userId: 'u2' }).map((c) => c.id)).toEqual(['cp3', 'cp2', 'cp1'])
    expect(demoChurchCampaigns('ch1', { role: 'communicator', userId: 'u5' }).map((c) => c.id)).toEqual(['cp3', 'cp2', 'cp1'])
  })

  it('sem userId o recorte é a igreja, como nas outras leituras', () => {
    expect(demoChurchCampaigns('ch1', { role: 'church_admin' }).map((c) => c.id)).toEqual(['cp3', 'cp2', 'cp1'])
  })

  it('SuperAdmin lê todas, inclusive de igrejas de que não é membro', () => {
    const rows = demoChurchCampaigns(undefined, { role: 'superadmin' })
    expect(rows.map((c) => c.id)).toEqual(['cp4', 'cp3', 'cp2', 'cp1'])
  })

  it('sem igreja na sessão e sem ser SuperAdmin não há o que listar', () => {
    expect(demoChurchCampaigns(undefined, { role: 'church_admin' })).toEqual([])
    expect(demoChurchCampaigns(undefined)).toEqual([])
  })
})

describe('leitura real — contrato da consulta', () => {
  it('membro pede a projeção, a ordem por created_at e o recorte pela igreja', async () => {
    await fetchChurchCampaigns('ch1', { role: 'church_admin' })
    expect(from).toHaveBeenCalledWith('marketing_campaigns')
    expect(chain.select).toHaveBeenCalledWith(CAMPAIGN_COLUMNS.join(','))
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.eq).toHaveBeenCalledWith('church_id', 'ch1')
  })

  it('SuperAdmin não recorta por igreja: nenhuma chamada .eq', async () => {
    await fetchChurchCampaigns(undefined, { role: 'superadmin' })
    expect(chain.select).toHaveBeenCalledWith(CAMPAIGN_COLUMNS.join(','))
    expect(chain.eq).not.toHaveBeenCalled()
  })

  it('sem igreja na sessão não sai consulta nenhuma', async () => {
    expect(await fetchChurchCampaigns(undefined, { role: 'church_admin' })).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('erro na leitura não recorre à lista fictícia', async () => {
    readResult = { data: null, error: { message: 'falha de rede' } }
    await expect(fetchChurchCampaigns('ch1', { role: 'church_admin' })).rejects.toThrow('falha de rede')
  })
})

describe('validateCampaignDraft', () => {
  it('recusa nome curto', () => {
    expect(validateCampaignDraft(validDraft({ name: '  ab ' }))).toBe(
      'Informe o nome da campanha (pelo menos 3 caracteres).',
    )
  })

  it('recusa rede fora do conjunto suportado', () => {
    // `youtube` é rede de PERFIL (0015) mas não de campanha (0014+0020), e
    // `tiktok` saiu das duas na 0020: as duas recusas são o contrato do app
    // batendo com o CHECK do banco.
    const invalid = ['youtube'] as unknown as CampaignNetwork[]
    expect(validateCampaignDraft(validDraft({ networks: invalid }))).toBe('Rede não suportada: youtube.')
    const retired = ['tiktok'] as unknown as CampaignNetwork[]
    expect(validateCampaignDraft(validDraft({ networks: retired }))).toBe('Rede não suportada: tiktok.')
  })

  it('aceita rascunho válido', () => {
    expect(validateCampaignDraft(validDraft())).toBeNull()
    expect(validateCampaignDraft(validDraft({ message: null, event_id: null }))).toBeNull()
  })
})

describe('escritas — portas de permissão', () => {
  it('papel sem marketing.manage não escreve, e nenhuma consulta sai', async () => {
    for (const role of ['pastor', 'visitor'] as const) {
      const actor: CampaignActor = { churchId: 'ch1', role }
      expect(await createCampaign(validDraft(), actor)).toEqual({ ok: false, error: CAMPAIGN_MANAGE_DENIED })
      expect(await updateCampaign('cp1', validDraft(), actor)).toEqual({ ok: false, error: CAMPAIGN_MANAGE_DENIED })
      expect(await setCampaignStatus('cp1', 'scheduled', actor, '2026-12-01T10:00:00.000Z'))
        .toEqual({ ok: false, error: CAMPAIGN_MANAGE_DENIED })
    }
    expect(from).not.toHaveBeenCalled()
  })

  it('SuperAdmin manda em marketing.manage, mas sem igreja ativa não cria', async () => {
    expect(await createCampaign(validDraft(), { role: 'superadmin' })).toEqual({ ok: false, error: CAMPAIGN_NO_CHURCH })
  })

  it('a porta vem antes da validação: papel errado recebe a mensagem de permissão', async () => {
    expect(await createCampaign(validDraft({ name: 'x' }), { churchId: 'ch1', role: 'pastor' }))
      .toEqual({ ok: false, error: CAMPAIGN_MANAGE_DENIED })
  })
})

describe('loja do fixture — cria, edita, agenda e cancela; nunca apaga', () => {
  it('church_admin cria campanha na própria igreja, como rascunho', () => {
    const antes = campaigns.length
    const resultado = demoCreateCampaign(validDraft(), { churchId: 'ch1', role: 'church_admin' })
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(campaigns).toHaveLength(antes + 1)
    expect(resultado.campaign.church_id).toBe('ch1')
    expect(resultado.campaign.status).toBe('draft')
    expect(resultado.campaign.name).toBe('Divulgação Congresso')
    expect(resultado.campaign.message).toBe('Texto base da campanha.')
    expect(resultado.campaign.networks).toEqual(['instagram', 'whatsapp'])
    expect(Object.keys(resultado.campaign).sort()).toEqual([...CAMPAIGN_COLUMNS].sort())
  })

  it('church_admin edita a própria campanha; church_id não vai no patch', () => {
    const resultado = demoUpdateCampaign('cp2', validDraft({ name: 'Vigília remarcada' }), {
      churchId: 'ch1',
      role: 'church_admin',
    })
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.campaign.name).toBe('Vigília remarcada')
    expect(campaigns.find((c) => c.id === 'cp2')?.name).toBe('Vigília remarcada')
    expect(campaigns.find((c) => c.id === 'cp2')?.church_id).toBe('ch1')
  })

  it('agenda e cancela mudam o status; agendar sem data é recusado', () => {
    const semData = demoSetCampaignStatus('cp2', 'scheduled', { churchId: 'ch1', role: 'church_admin' })
    expect(semData).toEqual({ ok: false, error: 'Escolha a data e a hora para agendar a campanha.' })

    const agendada = demoSetCampaignStatus('cp2', 'scheduled', { churchId: 'ch1', role: 'church_admin' }, '2026-12-20T19:00:00.000Z')
    expect(agendada.ok).toBe(true)
    if (agendada.ok) {
      expect(agendada.campaign.status).toBe('scheduled')
      expect(agendada.campaign.scheduled_for).toBe('2026-12-20T19:00:00.000Z')
    }

    const cancelada = demoSetCampaignStatus('cp2', 'cancelled', { churchId: 'ch1', role: 'church_admin' })
    expect(cancelada.ok).toBe(true)
    if (cancelada.ok) {
      expect(cancelada.campaign.status).toBe('cancelled')
      expect(cancelada.campaign.scheduled_for).toBeNull()
    }
  })

  it('SuperAdmin é transversal: edita campanha de qualquer igreja', () => {
    const resultado = demoUpdateCampaign('cp4', validDraft({ name: 'Florescer remarcado' }), { role: 'superadmin' })
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.campaign.name).toBe('Florescer remarcado')
  })

  it('church_admin de uma igreja não alcança a campanha da vizinha: mesma mensagem de não-existente', () => {
    // cp4 é da ch2; u1 administra a ch1. Sem oráculo de existência.
    expect(demoUpdateCampaign('cp4', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: CAMPAIGN_NOT_FOUND })
    expect(demoUpdateCampaign('campanha-que-nao-existe', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: CAMPAIGN_NOT_FOUND })
    expect(campaigns.find((c) => c.id === 'cp4')?.name).toBe('Florescer — convite mulheres')
  })

  it('o serviço não expõe delete em nenhuma forma', () => {
    const nomes = Object.keys(marketingService)
    expect(nomes.filter((n) => /delete|remove|destroy|excluir/i.test(n))).toEqual([])
    const fonte = readFileSync(new URL('../../src/services/data/marketingService.ts', import.meta.url), 'utf8')
    expect(fonte).not.toMatch(/\.delete\(/)
  })
})

describe('publicação — nunca escreve published sem provedor', () => {
  it('publishCampaign devolve "não conectado" para qualquer papel, sem escrever', async () => {
    for (const actor of [
      { role: 'superadmin' },
      { churchId: 'ch1', role: 'church_admin' },
      { churchId: 'ch1', role: 'communicator', userId: 'u5' },
    ] as CampaignActor[]) {
      void actor
      expect(await publishCampaign()).toEqual({ ok: false, error: CAMPAIGN_PUBLISH_NOT_CONNECTED })
    }
    // Nenhuma consulta saiu e nenhuma campanha virou published/failed.
    expect(from).not.toHaveBeenCalled()
    expect(campaigns.some((c) => c.status === 'published' || c.status === 'failed')).toBe(false)
  })

  it('o fonte do serviço não grava status published em caminho nenhum', () => {
    const fonte = readFileSync(new URL('../../src/services/data/marketingService.ts', import.meta.url), 'utf8')
    expect(fonte).not.toMatch(/status:\s*'published'/)
    expect(fonte).not.toMatch(/'published'\s*,/)
  })

  it('setCampaignStatus só aceita os graváveis: published não é um deles', () => {
    // O tipo impede em tempo de compilação; aqui garantimos que o runtime não tem atalho.
    const fonte = readFileSync(new URL('../../src/services/data/marketingService.ts', import.meta.url), 'utf8')
    expect(fonte).toMatch(/WritableCampaignStatus = 'draft' \| 'scheduled' \| 'cancelled'/)
  })
})

describe('escrita real — contrato e erros do banco', () => {
  it('a criação envia só colunas reais, com a igreja da sessão', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 'cp-real', church_id: 'ch-real', status: 'draft' }, error: null })
    await createCampaign(validDraft(), { churchId: 'ch-real', role: 'church_admin' })
    expect(chain.insert).toHaveBeenCalled()
    const enviado = chain.insert.mock.calls[0]![0] as Record<string, unknown>
    expect(enviado.church_id).toBe('ch-real')
    expect(enviado.status).toBe('draft')
    expect(Object.keys(enviado).sort()).toEqual([...CAMPAIGN_INSERT_COLUMNS].sort())
    expect(chain.select).toHaveBeenCalledWith(CAMPAIGN_COLUMNS.join(','))
  })

  it('a edição não envia church_id nem status', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 'cp1' }, error: null })
    await updateCampaign('cp1', validDraft(), { churchId: 'ch1', role: 'church_admin' })
    const patch = chain.update.mock.calls[0]![0] as Record<string, unknown>
    expect(patch).not.toHaveProperty('church_id')
    expect(patch).not.toHaveProperty('status')
    expect(Object.keys(patch).sort()).toEqual(['event_id', 'message', 'name', 'networks'])
    expect(chain.eq).toHaveBeenCalledWith('id', 'cp1')
  })

  it('agendar envia status e scheduled_for; cancelar zera a data', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { id: 'cp1', status: 'scheduled' }, error: null })
    await setCampaignStatus('cp1', 'scheduled', { churchId: 'ch1', role: 'church_admin' }, '2026-12-20T19:00:00.000Z')
    expect(chain.update.mock.calls[0]![0]).toEqual({ status: 'scheduled', scheduled_for: '2026-12-20T19:00:00.000Z' })

    await setCampaignStatus('cp1', 'cancelled', { churchId: 'ch1', role: 'church_admin' })
    expect(chain.update.mock.calls[1]![0]).toEqual({ status: 'cancelled', scheduled_for: null })
  })

  it('linha que não volta é a mesma mensagem de não-existente: sem oráculo', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await updateCampaign('cp4', validDraft(), { churchId: 'ch1', role: 'church_admin' }))
      .toEqual({ ok: false, error: CAMPAIGN_NOT_FOUND })
  })

  it.each([
    ['trigger de publicação', '42501', 'marcar campanha como publicada exige confirmacao real do provedor (backend)', CAMPAIGN_PUBLISH_NOT_CONNECTED],
    ['política de gestão', '42501', 'new row violates row-level security policy', CAMPAIGN_MANAGE_DENIED],
    ['rede/status fora do check', '23514', 'violates check constraint "marketing_campaigns_networks_check"', 'Rede ou status fora do conjunto permitido. Revise as redes selecionadas.'],
    ['igreja/evento inexistente', '23503', 'violates foreign key constraint', 'Igreja ou evento não encontrado. Atualize a lista e tente de novo.'],
    ['erro desconhecido', '57014', 'statement timeout', 'statement timeout'],
  ])('erro do banco — %s — vira mensagem legível', async (_rotulo, code, message, esperado) => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: { code, message } })
    expect(await createCampaign(validDraft(), { churchId: 'ch-real', role: 'church_admin' }))
      .toEqual({ ok: false, error: esperado })
  })
})

function tableBlock(migration: string, table: string) {
  const sql = readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')
  const start = sql.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada em ${migration}`)
  return sql.slice(start, sql.indexOf('\n);', start))
}

function hasColumn(block: string, column: string) {
  return new RegExp(`^\\s+${column}\\s+\\S`, 'm').test(block)
}
