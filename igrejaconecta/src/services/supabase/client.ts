import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * O aplicativo existe para falar com o Supabase: não há modo demo. Sem as duas
 * chaves públicas (`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`) no ambiente de
 * build, o app nem sobe — uma tela em branco com esta mensagem vale mais do que
 * navegar por dados inventados achando que são da igreja. A `service_role`
 * NUNCA aparece aqui: ela não vai para o navegador em nenhuma hipótese.
 */
if (!url || !anonKey) {
  throw new Error(
    'Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente e rode o build de novo.',
  )
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export const supabaseHost = new URL(url).host
