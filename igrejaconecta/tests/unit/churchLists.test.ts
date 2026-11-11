import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { churches } from '@/data/mock'
import {
  DIRECTORY_COLUMNS,
  MANAGED_COLUMNS,
  MAP_COLUMNS,
  demoDirectoryChurches,
  demoManagedChurches,
  demoMapChurches,
  demoMyChurches,
} from '@/services/data/churchService'
import type { Church } from '@/types'

/**
 * As listas de igrejas têm duas metades: a RLS (grupo I da suíte SQL) e o código
 * que monta a consulta. Estes testes conferem a segunda — os espelhos demo, que são
 * o que roda em /igrejas, /mapa, /buscar, /admin/igrejas e no painel — e amarram a
 * projeção aos nomes reais do schema, para uma coluna renomeada quebrar aqui em vez
 * de quebrar a tela no ar.
 */

const churchesDdl = tableBlock('churches')
const churchMembersDdl = tableBlock('church_members')
const rolesDdl = tableBlock('roles')

describe('diretório público — espelho do caso I1/I2', () => {
  it('só tem igreja aprovada E ativa', () => {
    const rows = demoDirectoryChurches()
    expect(rows.map((c) => c.id)).toEqual(['ch2', 'ch1'])
    expect(rows.every((c) => c.approval_status === 'approved' && c.status === 'active')).toBe(true)
  })

  it('esconde a pendente ativa (ch3) e a em-análise inativa (ch4)', () => {
    const ids = demoDirectoryChurches().map((c) => c.id)
    expect(ids).not.toContain('ch3')
    expect(ids).not.toContain('ch4')
  })

  it('esconde a aprovada com conta inativa (o ramo status=active tem dentes)', () => {
    // Os quatro fixtures não exercitam esse ramo sozinho: nenhuma igreja mockada é
    // aprovada E inativa. Então a linha entra aqui, só para o filtro poder errar.
    const inativa: Church = { ...churches[1]!, id: 'ch-inativa', name: 'Igreja Inativa Teste', status: 'inactive' }
    churches.push(inativa)
    try {
      const rows = demoDirectoryChurches()
      expect(rows.map((c) => c.id)).not.toContain('ch-inativa')
      expect(demoManagedChurches().map((c) => c.id)).toContain('ch-inativa')
    } finally {
      churches.pop()
    }
  })

  it('vem em ordem de nome, como o .order(name) do modo real', () => {
    expect(demoDirectoryChurches().map((c) => c.name)).toEqual(['Comunidade Vida Nova', 'Igreja Batista Central'])
  })
})

describe('projeção — o que chega ao navegador', () => {
  it('o diretório não leva contato privado nem uuid de quem cadastrou', () => {
    for (const forbidden of ['email', 'zip', 'website', 'lat', 'lng', 'created_by']) {
      expect(DIRECTORY_COLUMNS, `coluna ${forbidden} não deveria ir para o público`).not.toContain(forbidden)
    }
    const rows = demoDirectoryChurches()
    expect(rows).toHaveLength(2)
    expect(Object.keys(rows[0]!).sort()).toEqual([...DIRECTORY_COLUMNS].sort())
  })

  it('a lista de gestão é o diretório mais o contato institucional', () => {
    expect([...MANAGED_COLUMNS].sort()).toEqual([...DIRECTORY_COLUMNS, 'email', 'website', 'zip'].sort())
    const [primeira] = demoManagedChurches()
    expect(Object.keys(primeira!).sort()).toEqual([...MANAGED_COLUMNS].sort())
  })
})

describe('mapa — projeção com coordenadas (Fase 4)', () => {
  it('é o diretório mais lat/lng, e o diretório segue sem as coordenadas', () => {
    expect([...MAP_COLUMNS].sort()).toEqual([...DIRECTORY_COLUMNS, 'lat', 'lng'].sort())
    // A lista de igrejas não precisa de coordenada; só o mapa pede. Exposição nova
    // de dado, tratada na revisão de risco da Fase 4.
    expect(DIRECTORY_COLUMNS).not.toContain('lat')
    expect(DIRECTORY_COLUMNS).not.toContain('lng')
  })

  it('lat/lng existem na tabela churches da migração 0001', () => {
    expect(hasColumn(churchesDdl, 'lat')).toBe(true)
    expect(hasColumn(churchesDdl, 'lng')).toBe(true)
  })

  it('tem a mesma audiência do diretório: aprovada E ativa', () => {
    expect(demoMapChurches().map((c) => c.id)).toEqual(demoDirectoryChurches().map((c) => c.id))
    expect(demoMapChurches().every((c) => c.approval_status === 'approved' && c.status === 'active')).toBe(true)
  })

  it('a linha do mapa tem exatamente as colunas da projeção, coordenadas inclusive', () => {
    const rows = demoMapChurches()
    expect(Object.keys(rows[0]!).sort()).toEqual([...MAP_COLUMNS].sort())
    // ch1 e ch2 têm coordenada no mock; o mapa carrega o valor real, não inventa.
    expect(rows.find((c) => c.id === 'ch1')).toMatchObject({ lat: -23.1857, lng: -45.8871 })
  })

  it('vem em ordem de nome; a ordenação por distância é da tela, não daqui', () => {
    expect(demoMapChurches().map((c) => c.name)).toEqual(['Comunidade Vida Nova', 'Igreja Batista Central'])
  })
})

describe('lista de gestão — espelho do caso I4', () => {
  it('traz todas as igrejas, inclusive pendentes e em análise', () => {
    const rows = demoManagedChurches()
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((c) => c.approval_status))).toEqual(new Set(['approved', 'pending', 'in_review']))
  })

  it('ordena por status e depois por nome', () => {
    expect(demoManagedChurches().map((c) => `${c.approval_status}:${c.name}`)).toEqual([
      'approved:Comunidade Vida Nova',
      'approved:Igreja Batista Central',
      'in_review:Igreja do Evangelho Quadrangular Monte Sião',
      'pending:Assembleia de Deus Esperança',
    ])
  })
})

describe('minhas igrejas — espelho dos casos I5/I6', () => {
  it('lista a igreja do vínculo ativo com o papel', () => {
    expect(demoMyChurches('u1')).toEqual([
      {
        church_id: 'ch1',
        name: 'Igreja Batista Central',
        city: 'São José dos Campos',
        state: 'SP',
        approval_status: 'approved',
        role_key: 'church_admin',
      },
    ])
  })

  it('convite ainda não aceito não vira igreja na lista', () => {
    expect(demoMyChurches('u3')).toEqual([])
  })

  it('quem não tem vínculo não tem igreja', () => {
    expect(demoMyChurches('u-ninguem')).toEqual([])
  })
})

describe('projeção amarrada ao schema', () => {
  it('toda coluna selecionada existe na tabela correspondente', () => {
    for (const column of MANAGED_COLUMNS) {
      expect(hasColumn(churchesDdl, column), `churches.${column}`).toBe(true)
    }
    for (const column of ['church_id', 'status'] as const) {
      expect(hasColumn(churchMembersDdl, column), `church_members.${column}`).toBe(true)
    }
    expect(hasColumn(rolesDdl, 'key')).toBe(true)
    for (const column of ['id', 'name', 'city', 'state', 'approval_status'] as const) {
      expect(hasColumn(churchesDdl, column), `churches.${column} (embed)`).toBe(true)
    }
  })

  it('o grupo I da suíte SQL seleciona as mesmas colunas do código', () => {
    const suite = readFileSync(new URL('../../supabase/tests/database/rls_isolation.sql', import.meta.url), 'utf8')
    const grupoI = suite.slice(suite.indexOf('-- GRUPO I'))
    for (const column of MANAGED_COLUMNS) {
      expect(grupoI, `coluna ${column} ausente do grupo I`).toContain(column)
    }
  })
})

function tableBlock(table: string) {
  const sql = readFileSync(new URL('../../supabase/migrations/0001_initial_schema.sql', import.meta.url), 'utf8')
  const start = sql.indexOf(`create table if not exists public.${table} (`)
  if (start < 0) throw new Error(`tabela ${table} não encontrada na migração 0001`)
  return sql.slice(start, sql.indexOf('\n);', start))
}

function hasColumn(block: string, column: string) {
  return new RegExp(`^\\s+${column}\\s+\\S`, 'm').test(block)
}
