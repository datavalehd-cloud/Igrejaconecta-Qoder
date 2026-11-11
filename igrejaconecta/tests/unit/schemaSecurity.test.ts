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
