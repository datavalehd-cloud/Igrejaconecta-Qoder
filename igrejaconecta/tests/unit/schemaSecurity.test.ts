import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = join(root, 'src')

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return tsFiles(full)
    return /\.(ts|tsx)$/.test(entry) ? [full] : []
  })
}

const sources = () => tsFiles(src).map((f) => ({ path: relative(root, f).replaceAll('\\', '/'), text: readFileSync(f, 'utf8') }))

// Regra da especificação: a service_role key (ignora RLS) só existe no backend.
// Se ela chegar ao bundle do navegador, qualquer visitante lê qualquer igreja.
// Os textos de UI/comentários citam "service_role" de propósito; o que não pode
// é o código ler a variável de ambiente ou entregá-la ao createClient.
describe('o bundle do frontend não expõe credenciais privilegiadas', () => {
  it('nenhum código de src/ lê uma service role key', () => {
    const offenders = sources()
      .filter(({ text }) => /VITE_[A-Z0-9_]*SERVICE_ROLE|SERVICE_ROLE_KEY/.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('só o client Supabase chama createClient, e só com a anon key', () => {
    const callers = sources().filter(({ text }) => /createClient\s*\(/.test(text)).map(({ path }) => path)
    expect(callers).toEqual(['src/services/supabase/client.ts'])
    const client = readFileSync(join(src, 'services', 'supabase', 'client.ts'), 'utf8')
    expect(client).toMatch(/VITE_SUPABASE_ANON_KEY/)
    expect(client).not.toMatch(/SERVICE_ROLE/)
  })

  it('nenhuma credencial literal (JWT do Supabase) está no código', () => {
    const offenders = sources()
      .filter(({ text }) => /eyJ[A-Za-z0-9_-]{10,}\.eyJ/.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })
})

// A migration demo→real não é um detalhe de execução: se um ramo `if (!supabase)`
// voltar a entrar num serviço, a tela passa a mostrar dados inventados para quem
// estiver sem chave, e nenhum teste de comportamento pega isso (os testes sempre
// fornecem o cliente). Esta cerca é estrutural — quebra o contrato, não o número.
describe('nenhum caminho demo sobrou dentro do aplicativo', () => {
  const services = () => tsFiles(join(src, 'services')).map((f) => ({ path: relative(root, f).replaceAll('\\', '/'), text: readFileSync(f, 'utf8') }))

  it('nenhum serviço lê a loja de mocks', () => {
    const offenders = services().filter(({ text }) => /from '@\/data\/mock'/.test(text)).map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  // Era uma allowlist que só encolhia (passos M3b..M3d): as páginas ainda presas na
  // loja de mocks estavam listadas aqui, e nenhuma podia entrar. Zerou no M3d,
  // então a cerca virou proibição seca — um `import` novo de `@/data/mock` no
  // aplicativo quebra este teste. O arquivo existe (M3e é só movê-lo para
  // `tests/fixtures/`), mas nada dentro de `src/` o alcança.
  it('nenhum arquivo do aplicativo importa a loja de mocks', () => {
    const readers = sources()
      .filter(({ text }) => /from '@\/data\/mock'/.test(text))
      .map(({ path }) => path)
      .sort()
    expect(readers).toEqual([])
  })

  it('nenhum serviço tem ramo condicional em torno do Supabase', () => {
    const offenders = services()
      .filter(({ text }) => /if\s*\(\s*!?\s*supabase\s*\)/.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('a única implementação de auth é a do Supabase', () => {
    const files = readdirSync(join(src, 'services', 'auth'))
    expect(files.filter((f) => !/\.ts$/.test(f) || /demo|mock/i.test(f))).toEqual([])
    expect(files).toEqual(expect.arrayContaining(['supabaseBackend.ts']))
  })

  it('sem as duas chaves públicas o client recusa, em vez de subir sem banco', () => {
    const client = readFileSync(join(src, 'services', 'supabase', 'client.ts'), 'utf8')
    // A recusa vem antes de qualquer `createClient`: sem chave não há cliente — e
    // também não há `supabase = null`, que é como um ramo demo volta a nascer.
    const guard = client.search(/if\s*\(\s*!url\s*\|\|\s*!anonKey\s*\)/)
    expect(guard).toBeGreaterThan(-1)
    expect(client.slice(guard, client.indexOf('createClient(', guard))).toMatch(/throw new Error/)
    expect(client).not.toMatch(/SupabaseClient\s*\|\s*null/)
  })
})
