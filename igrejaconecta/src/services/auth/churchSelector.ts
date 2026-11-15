/**
 * Escolha de igreja do painel (SuperAdmin). A chave guardada aqui não
 * é autoridade sobre nada: `loadSession` só consulta esta chave quando o papel
 * lido do banco é `superadmin` e confere a linha em `churches` antes de devolvê-la
 * como igreja ativa da sessão. Para qualquer outro papel a chave é ignorada — o que
 * define a igreja deles é a linha de `church_members`, não o navegador.
 */
export const CHURCH_SELECTOR_KEY = 'ic:painel-igreja'

export function readSelectedChurchId(): string | null {
  try {
    return localStorage.getItem(CHURCH_SELECTOR_KEY)
  } catch {
    // Sem storage (modo privado, cota cheia) a escolha simplesmente não existe.
    return null
  }
}

export function writeSelectedChurchId(churchId: string | null): void {
  try {
    if (churchId) localStorage.setItem(CHURCH_SELECTOR_KEY, churchId)
    else localStorage.removeItem(CHURCH_SELECTOR_KEY)
  } catch {
    // Persistir falhou: a escolha vale até o próximo loadSession desta aba.
  }
}
