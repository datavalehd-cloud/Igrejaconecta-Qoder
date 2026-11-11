import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { can, MFA_REQUIRED_ROLES, type Permission } from '@/utils/rbac'

interface ProtectedProps {
  children: ReactNode
  permission?: Permission
  requireSuperAdmin?: boolean
}

/**
 * Proteção de rotas (Fase 1). Sem sessão -> /login. Sem permissão/papel ->
 * /acesso-negado. Em produção a checagem real de permissão também acontece no
 * banco via RLS; aqui garantimos a UX e o bloqueio de navegação.
 */
export function ProtectedRoute({ children, permission, requireSuperAdmin }: ProtectedProps) {
  const { isAuthenticated, session, initializing } = useAuth()
  const location = useLocation()

  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-sm text-slate-500">
        Carregando sessão…
      </div>
    )
  }

  if (!isAuthenticated || !session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (requireSuperAdmin && session.role !== 'superadmin') {
    return <Navigate to="/acesso-negado" replace />
  }

  if (permission && !can(session.role, permission)) {
    return <Navigate to="/acesso-negado" replace />
  }

  // Papéis administrativos exigem MFA: sem fator cadastrado -> ativar no perfil;
  // com fator mas sessão ainda em aal1 -> voltar ao login para confirmar o código.
  if (MFA_REQUIRED_ROLES.includes(session.role) && !session.mfaVerified && location.pathname !== '/app/perfil') {
    return (
      <Navigate
        to={session.mfaEnrolled ? '/login' : '/app/perfil'}
        state={{ from: location.pathname }}
        replace
      />
    )
  }

  return <>{children}</>
}
