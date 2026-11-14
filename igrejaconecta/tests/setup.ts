import { vi } from 'vitest'

/**
 * Rede de proteção da suíte. Sem modo demo, todo serviço fala com o Supabase — e o
 * `.env.local` também é carregado nos testes, então um arquivo que esquecesse de
 * simular o client escreveria no banco que está no ar. Aqui o módulo já vem com um
 * client que estoura no primeiro acesso.
 *
 * O teste que precisa do client registra o próprio `vi.mock('@/services/supabase/client')`
 * no topo do arquivo, e o mock do arquivo tem precedência sobre este registro global.
 */
vi.mock('@/services/supabase/client', () => {
  const boom = () => {
    throw new Error('TESTE-SEM-MOCK: acesso ao Supabase real bloqueado pela suíte')
  }
  return {
    supabase: new Proxy(function () {}, { get: boom, apply: boom }),
    supabaseHost: 'teste.supabase.co',
  }
})
