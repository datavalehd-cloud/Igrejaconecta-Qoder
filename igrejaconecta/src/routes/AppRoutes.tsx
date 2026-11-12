import { Routes, Route } from 'react-router-dom'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { churchNav, adminNav } from '@/components/navigation/navConfig'
import { ProtectedRoute } from './guards'

import { HomePage } from '@/pages/public/HomePage'
import { EventsPage, ChurchesPage, CategoriesPage } from '@/pages/public/EventsPage'
import { EventDetailPage } from '@/pages/public/EventDetailPage'
import { ChurchMapPage } from '@/pages/public/ChurchMapPage'
import { SearchPage } from '@/pages/public/SearchPage'
import { VisitorProfilePage } from '@/pages/public/VisitorProfilePage'

import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { RecoverPasswordPage } from '@/pages/auth/RecoverPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { ConfirmEmailPage } from '@/pages/auth/ConfirmEmailPage'

import { ChurchDashboardPage } from '@/pages/church/ChurchDashboardPage'
import { ChurchOnboardingPage } from '@/pages/church/ChurchOnboardingPage'
import { ChurchProfilePage } from '@/pages/church/ChurchProfilePage'
import { BranchesPage } from '@/pages/church/BranchesPage'
import { UsersPage } from '@/pages/church/UsersPage'
import { MinistriesPage } from '@/pages/church/MinistriesPage'
import { ServiceHoursPage } from '@/pages/church/ServiceHoursPage'
import { EventsManagePage } from '@/pages/church/EventsManagePage'
import { EventFormPage } from '@/pages/church/EventFormPage'
import { CalendarPage } from '@/pages/church/CalendarPage'
import { RegistrationsPage } from '@/pages/church/RegistrationsPage'
import { CheckInPage } from '@/pages/church/CheckInPage'
import { CampaignsPage } from '@/pages/church/marketing/CampaignsPage'
import { SocialAccountsPage } from '@/pages/church/marketing/SocialAccountsPage'
import { AIAssistantPage } from '@/pages/church/ai/AIAssistantPage'
import { AutomationPage } from '@/pages/church/automation/AutomationPage'
import { UserProfilePage } from '@/pages/church/UserProfilePage'

import { AdminDashboardPage } from '@/pages/admin/AdminDashboardPage'
import { AdminChurchesPage } from '@/pages/admin/AdminChurchesPage'
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage'
import { AdminOrganizationsPage } from '@/pages/admin/AdminOrganizationsPage'
import { AdminIntegrationsPage } from '@/pages/admin/AdminIntegrationsPage'
import { AuditLogsPage, SystemLogsPage } from '@/pages/admin/AdminLogsPage'
import { AdminReportsPage } from '@/pages/admin/AdminReportsPage'
import { AdminSupportPage } from '@/pages/admin/AdminSupportPage'
import { AdminSettingsPage } from '@/pages/admin/AdminSettingsPage'

import { NotFoundPage, AccessDeniedPage } from '@/pages/ErrorPages'

export function AppRoutes() {
  return (
    <Routes>
      {/* Público */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/eventos" element={<EventsPage />} />
        <Route path="/eventos/:slug" element={<EventDetailPage />} />
        <Route path="/igrejas" element={<ChurchesPage />} />
        <Route path="/mapa" element={<ChurchMapPage />} />
        <Route path="/categorias" element={<CategoriesPage />} />
        <Route path="/buscar" element={<SearchPage />} />
        <Route path="/visitante/perfil" element={<VisitorProfilePage />} />
      </Route>

      {/* Autenticação */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/cadastro" element={<RegisterPage />} />
      <Route path="/recuperar-senha" element={<RecoverPasswordPage />} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route path="/confirmar-email" element={<ConfirmEmailPage />} />

      {/* Painel da igreja */}
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <DashboardLayout groups={churchNav} panelLabel="Painel da Igreja" />
          </ProtectedRoute>
        }
      >
        <Route index element={<ChurchDashboardPage />} />
        <Route path="perfil" element={<UserProfilePage />} />
        {/* onboarding: sem guarda de permissão porque é justamente quem ainda não tem igreja (e portanto não tem papel nela) quem cadastra */}
        <Route path="onboarding" element={<ChurchOnboardingPage />} />
        <Route path="igreja" element={<ProtectedRoute permission="church.manage"><ChurchProfilePage /></ProtectedRoute>} />
        <Route path="filiais" element={<BranchesPage />} />
        {/* roster: qualquer membro da igreja lê (a view mascara os contatos); convites ficam atrás de members.manage */}
        <Route path="usuarios" element={<UsersPage />} />
        <Route path="convites" element={<ProtectedRoute permission="members.manage"><UsersPage /></ProtectedRoute>} />
        <Route path="ministerios" element={<MinistriesPage />} />
        <Route path="horarios" element={<ServiceHoursPage />} />
        <Route path="eventos" element={<ProtectedRoute permission="events.manage"><EventsManagePage /></ProtectedRoute>} />
        <Route path="eventos/novo" element={<ProtectedRoute permission="events.manage"><EventFormPage /></ProtectedRoute>} />
        <Route path="eventos/:id/editar" element={<ProtectedRoute permission="events.manage"><EventFormPage /></ProtectedRoute>} />
        <Route path="calendario" element={<CalendarPage />} />
        <Route path="inscricoes" element={<ProtectedRoute permission="registrations.manage"><RegistrationsPage /></ProtectedRoute>} />
        <Route path="checkin" element={<ProtectedRoute permission="registrations.manage"><CheckInPage /></ProtectedRoute>} />
        <Route path="marketing" element={<ProtectedRoute permission="marketing.manage"><CampaignsPage /></ProtectedRoute>} />
        <Route path="redes" element={<ProtectedRoute permission="marketing.manage"><SocialAccountsPage /></ProtectedRoute>} />
        <Route path="ia" element={<ProtectedRoute permission="ai.use"><AIAssistantPage /></ProtectedRoute>} />
        <Route path="automacoes" element={<ProtectedRoute permission="automation.manage"><AutomationPage /></ProtectedRoute>} />
      </Route>

      {/* Painel SuperAdmin */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute requireSuperAdmin>
            <DashboardLayout groups={adminNav} panelLabel="SuperAdmin" accent="navy" />
          </ProtectedRoute>
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="igrejas" element={<AdminChurchesPage />} />
        <Route path="usuarios" element={<AdminUsersPage />} />
        <Route path="organizacoes" element={<AdminOrganizationsPage />} />
        <Route path="integracoes" element={<AdminIntegrationsPage />} />
        <Route path="logs" element={<SystemLogsPage />} />
        <Route path="auditoria" element={<AuditLogsPage />} />
        <Route path="relatorios" element={<AdminReportsPage />} />
        <Route path="suporte" element={<AdminSupportPage />} />
        <Route path="configuracoes" element={<AdminSettingsPage />} />
      </Route>

      {/* Erros */}
      <Route path="/acesso-negado" element={<AccessDeniedPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
