# IgrejaConecta

Plataforma que conecta igrejas e visitantes: gestão de eventos, localização, divulgação
digital e inteligência artificial. **Sem cobrança, assinaturas ou faturamento** nesta versão.

> Status atual: **Fase 1 fechada (Auth real no Supabase + isolamento verificado), Fase 2 escrevendo
> no banco, Fase 3 com eventos e inscrições reais, Fase 4 com filiais, localização e mapa real,
> Fase 5 com campanhas de divulgação no banco + distribuição sem chave, Fase 6 com o gerador
> local de texto de campanha (sem IA e sem chave), Fase 7 com automações em simulação local
> (liga/desliga + dry-run, nada envia) e Fase 8 com o painel do SuperAdmin lendo o que a RLS já
> devolve — diretório global de usuários, eventos de todas as igrejas, relatórios agregados e CSV,
> sem migração nem política nova, e o que não existe diz "não conectado"** —
> Supabase Auth (login, cadastro, recuperação,
> confirmação, redefinição e MFA TOTP) ligado por uma camada única (`AuthBackend`); a suíte de RLS
> roda num Postgres real com `npm run test:rls` (1052 declarações, grupos A–U, sem Docker e sem projeto).
> A tela de **Usuários** lê a view `church_roster` e escreve de verdade: convite por e-mail,
> cancelamento, mudança de papel e aceite (`memberService`, migração 0008). O SuperAdmin **aprova,
> rejeita, suspende e reativa** de verdade (`churchApprovalService`), e o efeito é o que a suíte mede:
> aprovar põe a igreja no diretório público, suspender/rejeitar tira — sem cegar a própria igreja.
> Cada alteração confirmada registra ator, igreja e transição em `audit_logs` **na mesma transação**
> (trigger da migração 0009), e a tela de Auditoria lê esses registros (`auditService`, grupos K e L).
> **Eventos** vêm do banco (migração 0011, grupo M) e **inscrições** escrevem por RPC (migração 0012,
> grupo N): o visitante se inscreve num evento publicado, entra na lista de espera quando lota, a
> equipe vê nomes e códigos, faz check-in e cancela promovendo a fila — e a contagem de inscritos na
> tela vem de `event_registration_stats`, não de um número inventado. O **formulário de evento**
> também escreve: cria rascunho, edita sem trocar o endereço público e transiciona o status —
> publicar só para quem tem `events.publish`, cancelar para quem gerencia. A **Fase 4** (migração 0013,
> grupo O) acrescenta **filiais** (`church_branches`, sem delete e sem vitrine pública), **coordenadas**
> no evento e na igreja, e o **mapa público real** — Leaflet + OpenStreetMap, GPS do navegador sem
> geocodificador, distância e rota. A **Fase 5** (migração 0014, grupo P) grava **campanhas de
> divulgação** no banco (rascunho, conteúdo preparado, redes alvo, agendamento) com a mesma audiência
> de `marketing.manage`, e distribui **sem chave**: link de WhatsApp, copiar link com UTM e Web Share.
> Publicar numa rede **não existe aqui e não é fingido** — um trigger só deixa `service_role` marcar
> `published`, e o frontend devolve "não conectado" sem escrever. A **Fase 6** liga o gerador de
> texto de campanha que **não precisa de chave** — `utils/campaignText.ts` monta nome, mensagem e
> hashtags com os dados reais do evento, no navegador, e salva como rascunho pela mesma porta
> `marketing.manage`; artes, vídeos e IA de provedor seguem "não conectado", porque a chave nunca
> pode ir ao frontend. A **Fase 7** liga as automações como **simulação local**: `utils/automationEngine.ts`
> calcula, no navegador e com os eventos e inscrições reais da igreja, **o que cada regra dispararia
> agora** (a mensagem que *seria* enviada, rotulada como simulação), e ligar/desligar uma regra muda
> esse dry-run na hora. **Nada executa, envia ou agenda de verdade** — disparar exigiria um scheduler
> no servidor (pg_cron, fila ou Edge Function) e um provedor de envio (SMTP, WhatsApp Cloud ou Web
> Push) com backend que guardasse as chaves; nada disso existe aqui, e a tela diz "não conectado" em
> vez de fingir. A **Fase 8** põe o painel do SuperAdmin para **ler o que a RLS já devolve** no ramo
> `is_superadmin()` — sem migração nem política nova: o **diretório global de usuários** (um vínculo por
> linha, nome/e-mail/papel/igreja resolvidos pelos embeds, projeção congelada que não vaza `role_id` nem
> carimbos), os **eventos de todas as igrejas** em qualquer status e os **relatórios agregados** com
> exportar CSV, tudo gateado em `superadmin` antes de qualquer consulta (defesa em profundidade; a
> política no banco é a segunda camada). O que **não existe** — organizações, suporte, integrações,
> monitoramento de provedor, exportar PDF, receita/IA — segue no menu mas diz **"não conectado"** ou
> **"não existe ainda"**, sem número nem status fingido. A **Fase 9** deixa o app **pronto para
> publicar sem publicar nada**: `index.html` com Open Graph, Twitter card, canonical, theme-color e
> JSON-LD (Organization + WebSite) no HTML inicial — o único SEO que scrapers de rede veem num SPA;
> `robots.txt`, `sitemap.xml` (só rotas fixas; as dinâmicas exigiriam gerador com o banco) e
> `manifest.webmanifest` reais; ícones PWA (192/512/maskable/apple) e `og-image.png` **derivados do
> favicon**, não redesenhados; `useDocumentMeta` aplica title/canonical/robots/JSON-LD por rota
> (schema.org/Event no detalhe, `noindex` em login e painéis); e um service worker que pré-cacheia o
> shell, só registra em produção e **nunca cacheia dado de provedor nem `/app`/`/admin`**. Tudo pelo
> mesmo caminho de código.
> **Não há modo demo**: sem as duas chaves no `.env.local` o app não sobe — `client.ts` lança antes
> de qualquer render, e nenhum dado fictício chega à tela. O que existia de mock virou fixture de teste.
> **Rodada M (2026-11-13)**: as migrações 0015..0021 deram origem real a ministérios/equipe, perfis de
> rede social, favoritos do visitante, organizações, suporte e eventos de segurança (grupos Q..U da
> suíte), a 0021 fechou um oráculo "uuid → nome" que a 0015 tinha deixado aberto, `/app/ministerios`
> e `/app/redes` já leem **e escrevem** o banco (M3a e M3b) e o perfil institucional e o perfil pessoal
> gravam de verdade (M3c) — saiu o CNPJ inventado, o "Responsável" de enfeite e o card de redes que não
> salvava nada. E desde o M3d o `/visitante/perfil` também: o coração da página de evento grava em
> `visitor_favorites`, cidade e interesses gravam em `visitor_preferences` (as duas da 0016) e o
> histórico sai de `event_registrations` pelo id da sessão — **nenhum arquivo de `src/` importa a loja
> de mocks** (medido no `dist/`: nenhum dado fictício no bundle). O TikTok saiu do aplicativo inteiro — nem
> perfil nem campanha oferecem a rede. 0015..0021 rodam no Postgres embarcado; no projeto que está no
> ar elas entram no passo M7 (com a 0020 casada com a saída do TikTok da tela).

## Stack

- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4
- React Router 7
- Supabase (Auth + PostgreSQL + Storage) — obrigatório; as chaves públicas entram no build pelo `.env.local`
- lucide-react (ícones)

## Identidade visual

| Cor | Hex |
|-----|-----|
| Azul-marinho | `#15345B` |
| Azul | `#2563A6` |
| Verde | `#16A36A` |
| Branco | `#FFFFFF` |
| Cinza | `#F4F6F8` |

Tokens definidos em `src/index.css` (`@theme`). Logotipo textual em
`src/components/layout/Logo.tsx`.

## Rodando localmente

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + build de produção
npm test           # 613 testes unitários (Vitest): RBAC, utils, serviços, motores locais e o contrato das migrações
npm run test:rls   # suíte de isolamento num Postgres embarcado (sem Docker, sem projeto Supabase)
```

### Contas

Não existe conta padrão nem senha embutida: conta, papel e igreja vêm **só do banco**.

- `/cadastro` cria a pessoa (`signUp`, com confirmação de e-mail se o projeto exigir).
- `/app/onboarding` cria a igreja e o trigger 0006 coloca quem cadastrou como `church_admin` dela.
- Colegas entram pelo convite da tela Usuários (0008); o aceite dá o papel convidado, nunca `superadmin`.
- SuperAdmin não se auto-promove (guarda 0005). Promova com `supabase/promote_superadmin.sql`,
  que exige vínculo ativo em alguma igreja.
- Não há menu de trocar de papel: o papel é o que `church_members`/`roles` dizem da conta.

As contas que existiam aqui (`admin@igrejaconecta.app`, `marcos@ibcentral.org.br`, senha `demo1234`)
eram do modo demo e saíram do aplicativo junto com `demoBackend.ts` e `authService.ts`. Para validar
RBAC hoje, use contas reais distintas ou o convite com o papel desejado.

## Conectando o Supabase (obrigatório — sem isto o app não abre)

1. Crie um projeto no Supabase.
2. Copie `.env.example` para `.env.local` e preencha **você mesmo** (as chaves não devem
   passar pelo chat):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   **Nunca** use a `service_role` key no frontend.
3. Aplique as migrações (SQL editor ou `supabase db push`), nesta ordem:
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_rls_policies.sql`
   - `supabase/migrations/0003_storage_buckets.sql`
   - `supabase/migrations/0004_rls_hardening.sql`
   - `supabase/migrations/0005_superadmin_role_guard.sql`
   - `supabase/migrations/0006_church_creator_membership.sql`
   - `supabase/migrations/0007_church_roster_view.sql`
   - `supabase/migrations/0008_church_invitations.sql`
   - `supabase/migrations/0009_church_approval_audit.sql`
   - `supabase/migrations/0010_audit_insert_guard.sql`
   - `supabase/migrations/0011_events.sql`
   - `supabase/migrations/0012_event_registrations.sql`
   - `supabase/migrations/0013_branches_location.sql`
   - `supabase/migrations/0014_marketing_campaigns.sql`
   - `supabase/migrations/0015_ministries_and_social_accounts.sql`
   - `supabase/migrations/0016_visitor_favorites_preferences.sql`
   - `supabase/migrations/0017_church_networks.sql`
   - `supabase/migrations/0018_support_tickets.sql`
   - `supabase/migrations/0019_security_events.sql`
   - `supabase/migrations/0020_drop_tiktok_from_campaigns.sql`
   - `supabase/migrations/0021_ministry_membership_guard.sql`

   No projeto que está no ar (`dlucvyjxidrfyjwuouvp`) **0001..0014 e o seed já foram aplicados**;
   0015..0021 ainda não — é o que falta para as telas de ministérios, favoritos, organizações,
   suporte e alertas lerem do banco em produção (sem elas a consulta responde `42P01`).
4. **Obrigatório — rode `supabase/seed.sql` no SQL Editor.** Sem ele o esquema existe mas a matriz
   RBAC não: `permissions` e `role_permissions` ficam vazios, `has_church_permission()` devolve
   `false` para todo mundo que não é SuperAdmin, e **toda** escrita gateada por permissão (evento,
   campanha, membro, convite, filial, inscrição, ministério, perfil de rede, edição da igreja) cai em
   `403 / 42501`; o roster ainda
   volta com e-mail e telefone mascarados. O sintoma engana porque o cadastro de igreja e a leitura
   continuam funcionando — só a primeira escrita de evento falha. Detalhes em
   [Seed obrigatório](#seed-obrigatório-papéis-permissões-e-matriz-rbac).
   O arquivo é idempotente (`on conflict do nothing`) e **não** insere usuário, igreja nem
   credencial — pode rodar de novo sem risco.
5. No painel do Supabase, em **Authentication → URL Configuration**, adicione:
   - Site URL: `http://localhost:5173`
   - Redirect URLs: `http://localhost:5173/login` e `http://localhost:5173/redefinir-senha`
     (confirmação de e-mail volta para `/login`; recuperação de senha volta para `/redefinir-senha`).
6. Em **Authentication → MFA Factors**, habilite **TOTP** (o app usa `factorType: 'totp'`).
7. Crie o primeiro usuário (SuperAdmin) — pelo cadastro do app ou manualmente no painel — e
   registre a associação em `church_members` com o `role_id` correspondente ao papel. Sem
   associação ativa, o usuário entra como **visitante**. (`supabase/promote_superadmin.sql` faz isso
   para o dono da conta; ele exige vínculo ativo em alguma igreja.)
8. Reinicie o dev server **depois** de preencher as chaves: elas entram no build, não em tempo de
   execução. Falta alguma, `src/services/supabase/client.ts` lança na carga do módulo e a tela fica
   branca com o erro no console — não há segunda metade para "cair" quando o banco não está ligado.

### Seed obrigatório (papéis, permissões e matriz RBAC)

`supabase/seed.sql` **não é opcional** e não vem junto com as migrações. Ele insere:

| O que | Quantidade |
|-------|-----------|
| `roles` | 6 (`superadmin`, `church_admin`, `manager`, `communicator`, `pastor`, `visitor`) |
| `permissions` | 11 (`church.manage`, `events.manage`, `members.manage`, …) |
| `role_permissions` | 33 pares (superadmin 11, church_admin 9, manager 7, communicator 3, pastor 3) |
| `system_settings` | 2 (`platform`, `privacy`) |

Sem essas linhas, `has_church_permission(p_church, p_perm)` (0001) — que é
`is_superadmin() OR exists(vínculo ativo ⋈ roles ⋈ role_permissions ⋈ permissions)` — devolve `false`
para qualquer não-SuperAdmin, porque o join não acha permissão nenhuma. Quem usa a função:

| Onde | Permissão | O que quebra sem o seed |
|------|-----------|------------------------|
| `churches` UPDATE (0002) | `church.manage` | editar os dados da igreja |
| `church_members` INSERT/UPDATE (0002) | `members.manage` | gerenciar membros |
| `church_invitations` (0008) | `members.manage` | convidar / aceitar convite |
| `church_roster` (0007) | `members.manage` | `email` e `phone` voltam `null` — o roster aparece mascarado até para o administrador |
| `events` INSERT/UPDATE + trigger de publicação (0011) | `events.manage` / `events.publish` | criar, editar e publicar evento |
| `event_registrations` + RPCs (0012) | `registrations.manage` | lista de inscrições, check-in, cancelamento |
| `church_branches` (0013) | `church.manage` | criar/editar filial |
| `marketing_campaigns` (0014) | `marketing.manage` | criar/editar campanha |
| `ministries` + `ministry_members` (0015) | `members.manage` | criar, editar, apagar ministério e mexer na equipe |
| `church_social_accounts` (0015) | `church.manage` | gravar/remover o @handle de uma rede |
| `support_tickets` / `support_messages` (0018) | `church.manage` | o administrador da igreja assunto do chamado não lê o ticket |

Em todos os casos o banco responde `403 {"code":"42501","message":"new row violates row-level
security policy for table …"}`. A mensagem é idêntica à de uma violação real do `WITH CHECK`, o que faz
o diagnóstico parecer problema de código.

Para confirmar se o seed já foi aplicado, no SQL Editor:

```sql
select (select count(*) from permissions)      as permissoes,   -- esperado: 11
       (select count(*) from roles)            as papeis,       -- esperado: 6
       (select count(*) from role_permissions) as matriz;       -- esperado: 33
```

`system_settings` volta 0 para quem não é SuperAdmin — a leitura é restrita (`system_settings_read`),
não é sinal de seed faltando.

**Episódio real (2026-11-13):** o projeto `dlucvyjxidrfyjwuouvp` estava no ar com as 14 migrações e
sem o seed. O onboarding de igreja funcionava (o trigger 0006 anexa o criador e `churches_insert` não
usa `has_church_permission`), a aprovação pelo SuperAdmin funcionava (SuperAdmin é
`is_superadmin()`), e o **primeiro** evento criado pelo `church_admin` recém-aprovado caía em
`42501`. Depois de rodar o seed: 11 / 6 / 33, `has_church_permission(…) → true`, e o evento foi
criado com `201`.

### O que cada fluxo faz no aplicativo e o que o fixture espelha

Desde o passo M1 o aplicativo **só** fala com o Supabase. As colunas abaixo são as duas metades que
restaram do antigo modo demo: à esquerda, o espelho em memória que agora vive em `tests/fixtures/*Mirror.ts`
e serve para os testes unitários especificarem a regra; à direita, o que roda no navegador.

| Fluxo | Fixture de teste (`tests/fixtures`) | Aplicativo (Supabase) |
|-------|-------------------------------------|------------------------|
| Login | — (removido: `demoBackend.ts` apagado) | `signInWithPassword`; MFA real via `challengeAndVerify` |
| Papel / igreja | — (removido: `authService.ts` apagado) | lido de `profiles` + `church_members`/`roles` (sob RLS) |
| Cadastro | — (era sempre "envia e-mail") | `signUp`; pula a confirmação se o projeto não exige |
| Recuperação | — (era simulada) | `resetPasswordForEmail` + página `/redefinir-senha` (`updateUser`) |
| MFA | — (era sempre "ativo" para admin) | QR Code + segredo reais em `/app/perfil`; sem fator ativo o painel fica bloqueado |
| Trocar papel | — (menu do demo saiu da UI) | não existe: o papel vem do vínculo ativo |
| Roster da igreja | `demoRoster` com a mesma regra da view | `select` em `church_roster` (0007) |
| Listas de igrejas | `demoDirectoryChurches` / `demoManagedChurches` / `demoMyChurches`, com o mesmo filtro e a mesma projeção | `select` de `churches` (ou do embed `church_members → churches`) com a lista de colunas de `churchService`; a visibilidade é decidida por `churches_public_read` |
| Convite / papel / aceite | loja em memória do módulo, com as mesmas recusas | `church_invitations` + RPCs `pending_invitations_for_me` / `accept_church_invitation` (0008) |
| Aprovação / suspensão (SuperAdmin) | `setChurchApprovalStatus` na loja do módulo, recusando quem não é `superadmin` com a mensagem do `42501` | `update churches set approval_status` com `.select(APPROVAL_COLUMNS)`; a linha devolvida pelo banco é o que a tela afirma |
| Auditoria da aprovação | uma linha em memória por mudança de status, com ator e transição; reload restaura exemplos | trigger da 0009 grava a trilha na mesma transação do update, com ator de `auth.uid()`; leitura de `audit_logs` e embeds sob RLS |
| Eventos (diretório, detalhe, agenda, categorias) | `demoPublicEvents` / `demoPublicEventBySlug` / `demoChurchEvents` / `demoEventCategories`, com o mesmo filtro e a mesma projeção | `select` de `events` com as colunas de `eventService` e os embeds `event_categories(name)` e `churches(...)`; quem decide a audiência é `events_public_read` / `events_church_read` (0011) |
| Inscritos no evento | `demoRegistrationStats()` conta a loja em memória (e todo evento aparece, inclusive o sem inscrição) | `select` da view `event_registration_stats` (0012), sem filtro nenhum no cliente — quem decide a audiência é a view |
| Inscrição do visitante | `demoRegisterForEvent` com as mesmas recusas e a mesma fila por capacidade | RPC `register_for_event` (0012): o visitante é `anon` e não tem grant de escrita na tabela |
| Lista de inscrições / CSV | `demoChurchRegistrations(churchId)`, e papel sem `registrations.manage` não recebe nada | `select` de `event_registrations` com a projeção `REGISTRATION_SELECT`; a política `event_registrations_read` é a guarda |
| Check-in / cancelamento | `demoCheckIn` / `demoCancelRegistration`, exigindo `registrations.manage` e promovendo a fila | RPCs `check_in_registration` / `cancel_event_registration` (0012), que conferem permissão **antes** de revelar se a inscrição existe |
| Ministérios e equipe | `demoMinistries` / `demoCreateMinistry` / `demoAddMinistryMember`, com `guardPerson()` reproduzindo a 0021 (referência antes de audiência) e `members_count` derivado de `ministry_members` | `select` em `ministry_list` (0015) + escritas em `ministries` / `ministry_members` pela porta `members.manage` (`ministryService`) |
| Quem pode escrever | checado na loja do fixture (`members.manage`) | decidido pelo RLS e pelos triggers; o erro do banco é o que aparece |

As escritas do fixture vivem **só enquanto o teste roda** (memória do módulo, sem `localStorage`):
são espelho para a suíte unitária, não caminho do aplicativo. No navegador tudo que muda é o que o
Supabase gravou, e é a suíte de RLS que prova quem pode ver e escrever o quê.

Sessão iniciada em `aal1` (sem MFA confirmado) **não** abre `/app` nem `/admin` para
SuperAdmin/Administrador da igreja: o `ProtectedRoute` manda ativar o MFA em `/app/perfil`
ou voltar ao login para digitar o código.

## Estrutura

```text
src/
  components/
    common/      # Button, Card, Badge, fields, DataTable, Cards, StatusBadges, Notice,
                 # approvalMap (o texto/cor de cada status, num arquivo sem componente)
    admin/       # ApprovalActions (Aprovar/Rejeitar/Suspender/Reativar, com confirmação)
    layout/      # Logo, PublicLayout, DashboardLayout, AuthLayout
    navigation/  # navConfig (menus igreja e admin)
    forms/
  pages/
    public/      # home, eventos, detalhe, igrejas, mapa, categorias, busca, visitante
    auth/        # login (com MFA), cadastro, recuperação, redefinição, confirmação
    church/      # painel da igreja (fases 2, 3, 5, 6, 7) + onboarding de igreja (/app/onboarding)
      marketing/ # campanhas, redes sociais
      ai/        # IgrejaConecta AI
      automation/# automações
    admin/       # painel SuperAdmin (fase 8)
    ErrorPages.tsx  # 404 e acesso negado
  hooks/         # usePermissions, useRoster, useInvitations, useChurches, useChurchApproval,
                 # useEvents, useRegistrations, useAdmin (leituras globais do SuperAdmin: eventos,
                 # usuários e campanhas) e useKeyedList (loading/erro/recarregar derivados do
                 # resultado, com linhas presas à identidade) e useDocumentMeta (title, canonical,
                 # robots e JSON-LD por rota, aplicando o utils/seo.ts no <head>, Fase 9)
  config/        # site.ts — identidade canônica do site (URL, nome, tagline, descrição, cores,
                 # locale); alimenta canonical, OG, sitemap, manifest e JSON-LD (Fase 9)
  contexts/      # AuthContext (sessão + RBAC; uma implementação de backend: Supabase)
  services/
    supabase/    # client — único ponto que lê as chaves; lança se faltar alguma
    auth/        # authTypes (contrato) + supabaseBackend (a única implementação)
    data/        # rosterService (view church_roster), memberService (convites, papéis, aceite),
                 # churchService (diretório público, lista de gestão, igrejas da conta e o
                 # createChurch do onboarding — pending + slug único),
                 # churchApprovalService (escrita de approval_status pelo SuperAdmin),
                 # auditService (verbos e leitura da trilha; a escrita real é do trigger 0009),
                 # eventService (diretório público, evento por slug, agenda da igreja, categorias e a
                 # agenda global do SuperAdmin), registrationService (inscrição do visitante, lista da
                 # equipe, contagens, check-in e cancelamento — toda escrita por RPC), branchService
                 # (filiais da 0013, sem delete), marketingService (campanhas da 0014, publicar bloqueado
                 # no banco), adminService
                 # (diretório global de vínculos do SuperAdmin, Fase 8 — gate + projeção congelada),
                 # ministryService (ministérios e equipe pela view `ministry_list` da 0015, com a
                 # audiência de líder/participante fechada pela 0021 — M3a), socialAccountService
                 # (perfis de rede da 0015, @handle editável e `connected` travado no banco — M3b),
                 # churchProfileService (cadastro institucional: 13 colunas editáveis, `slug`/`status`/
                 # `approval_status`/`created_by` fora do patch — M3c) e myProfileService (nome e
                 # telefone da própria conta; e-mail, id e avatar nunca — M3c),
                 # visitorFavoriteService (o par (conta, evento) em `visitor_favorites`: insert/delete
                 # pela PK composta, sem UPDATE porque a tabela não tem) e visitorPreferenceService
                 # (cidade e interesses em `visitor_preferences`, upsert pela chave da conta — M3d)
  types/         # modelo de domínio
  utils/         # rbac, format, cn, geo (haversine/distância), share (distribuição sem chave),
                 # campaignText (gerador local de texto, Fase 6), automationEngine (motor local de
                 # simulação de automações, Fase 7) e reports (agregação + CSV do relatório global do
                 # SuperAdmin, Fase 8) e seo (canonical, OG/Twitter, robots e JSON-LD puros, Fase 9)
                 # — os quatro últimos sem chave, sem provedor e sem fetch
  data/          # loja de mocks: desde o M3d **nenhum arquivo de `src/` a importa** — só os fixtures de
                 # `tests/`. O arquivo ainda está aqui (o M3e é movê-lo); no bundle ele já não existe
                 # (medido em `dist/`: `Camila Torres`, `Congresso de Jovens 2026` e o resto da loja não
                 # aparecem no JS gerado).
  routes/        # AppRoutes + guards (ProtectedRoute)
supabase/
  migrations/    # schema + RLS + storage + hardening + guards (0001..0021)
  functions/     # Edge Functions (fases 5-8, a implementar)
  tests/
    database/    # rls_isolation.sql — suíte de isolamento (roda local e no projeto)
    local/       # shim_supabase.sql — emula auth.*/storage.* só para o Postgres local
  seed.sql                 # OBRIGATÓRIO depois das migrações: papéis, permissões e matriz RBAC
  promote_superadmin.sql   # promove o dono da conta a superadmin (exige vínculo ativo em igreja)
scripts/
  rls-local.mjs  # sobe Postgres embarcado (sem Docker) e roda a suíte
  make-pwa-icons.ps1  # gera icon-192/512, maskable-512, apple-touch-icon e og-image
                      # a partir da geometria do favicon (System.Drawing; Fase 9)
public/
  favicon.svg + icon-192/512.png, maskable-512.png, apple-touch-icon.png, og-image.png  # marca (Fase 9)
  robots.txt, sitemap.xml, manifest.webmanifest, sw.js  # SEO/PWA crawler-visible (Fase 9)
tests/           # unit + fixtures
  fixtures/      # *Mirror.ts — os espelhos em memória que o modo demo usava, agora só de teste
                 # (admin, branch, church, event, marketing, member, ministry, registration, roster,
                 # social). Leem `src/data/mock` e importam as constantes e mensagens dos serviços, para
                 # não derivarem regra própria. Nenhum caminho do aplicativo passa por aqui.
  unit/          # rbac, format, roster, memberWrites, churchLists, events (paridade fixture × RLS,
                 # projeções e anti-deriva contra os grupos I/M), registrations (contrato da 0012,
                 # projeção, RPCs e loja do fixture contra o grupo N), churchApproval, auditTrail,
                 # geo (haversine/distância) e branches (Fase 4, grupo O), marketing (Fase 5, grupo P),
                 # ministries (M3a: projeção comparada com o texto da view, gates, espelho da 0021,
                 # contrato de escrita e mensagens do banco — sem oráculo de existência)
                 # socialAccounts (M3b: projeção e as duas listas de rede comparadas ao texto dos
                 # CHECKs, gate church.manage, payload sem `connected` e o espelho do trigger)
                 # profiles (M3c: as colunas editáveis + as travadas cobrindo a tabela inteira, o patch
                 # literal conferido contra a 0001, o gate church.manage antes de consultar, a coordenada
                 # fora do CHECK e, no perfil pessoal, exatamente nome e telefone — nunca e-mail, id ou
                 # avatar, e nenhuma exceção de SuperAdmin)
                 # visitorProfile (M3d: as projeções comparadas coluna a coluna ao CREATE TABLE da 0016,
                 # os interesses e a cidade conferidos contra os CHECKs escritos na migração, o insert
                 # literal do favorito sem `created_at`, o delete pela PK composta sem oráculo de
                 # existência, o upsert `onConflict: 'user_id'` das preferências, o gate de sessão antes
                 # de qualquer consulta e o histórico recortado por `user_id` com o slug do embed)
                 # e share (distribuição sem chave), campaignText (Fase 6, gerador local) e
                 # automationEngine (Fase 7, motor de simulação — inclusive a fronteira "nenhum segredo
                 # na fonte"), admin (Fase 8, leituras globais: gate superadmin, projeção anti-deriva,
                 # políticas reais que amparam a leitura, agregação e CSV) e schemaSecurity (guarda do
                 # service_role + a cerca estrutural que não deixa um ramo demo voltar: nenhum serviço
                 # importa `@/data/mock`, nenhum tem `if (!supabase)`, a auth só tem uma implementação,
                 # o client recusa subir sem as duas chaves e **nenhum arquivo de `src/` importa a loja
                 # de mocks** (era uma allowlist que só encolhia; zerou no M3d e virou proibição) e seo (Fase 9: canonical/OG/robots/JSON-LD puros + presença e
                 # anti-deriva dos estáticos index.html, robots, sitemap, manifest, sw e main)
```

## Rotas principais

- Público: `/`, `/eventos`, `/eventos/:slug`, `/igrejas`, `/mapa`, `/categorias`, `/buscar`, `/visitante/perfil`
- Auth: `/login`, `/cadastro`, `/recuperar-senha`, `/redefinir-senha`, `/confirmar-email`
- Igreja: `/app`, `/app/onboarding`, `/app/igreja`, `/app/filiais`, `/app/usuarios`, `/app/ministerios`, `/app/horarios`, `/app/eventos`, `/app/calendario`, `/app/inscricoes`, `/app/checkin`, `/app/marketing`, `/app/redes`, `/app/ia`, `/app/automacoes`, `/app/perfil`
- SuperAdmin: `/admin`, `/admin/igrejas`, `/admin/usuarios`, `/admin/organizacoes`, `/admin/integracoes`, `/admin/logs`, `/admin/auditoria`, `/admin/relatorios`, `/admin/suporte`, `/admin/configuracoes`
- Erros: `/acesso-negado`, `*` (404)

## Segurança (Fase 1)

- RLS habilitado em todas as tabelas (`0002_rls_policies.sql`).
- Isolamento multi-igreja via `current_church_ids()`, `has_church_permission()` e `is_superadmin()`.
- Público só lê igrejas aprovadas/ativas; dados privados ficam restritos aos membros da própria igreja.
- Aprovação/suspensão de igrejas e escrita em papéis/permissões: somente SuperAdmin.
- Proteção de rotas no frontend (`ProtectedRoute`) **e** no banco (RLS) — defesa em profundidade.
- MFA exigido para SuperAdmin e Administrador da igreja: desafio/verificação TOTP reais no
  Supabase (`aal2`) e ativação com QR Code em `/app/perfil`.

## Decisões de onboarding e roster (resolvidas)

**Quem cadastra uma igreja vira administrador dela** (`0006_church_creator_membership.sql`).
Antes, o `insert` em `churches` era aceito mas a igreja sumia da tela do criador: sem linha em
`church_members` ele não passava nem na leitura (`churches_public_read` pede `approved` ou vínculo)
nem na escrita (`churches_update` pede `church.manage`), dependendo de um SuperAdmin anexá-lo.
Um trigger `AFTER INSERT` SECURITY DEFINER — o mesmo padrão do `handle_new_user` do Supabase, que
por isso atravessa o RLS — cria o vínculo com papel `church_admin`, nunca `superadmin`.

**O roster da igreja é uma view, não um afrouxamento de `profiles`** (`0007_church_roster_view.sql`).
`public.church_roster` devolve `member_id, church_id, user_id, full_name, avatar_url, role_key,
role_name, membership_status` para qualquer membro ativo da igreja, e `email`/`phone` **só** para quem
tem `members.manage`. `profiles` continua legível apenas pelo próprio dono (mais SuperAdmin), então
telefone e e-mail de centenas de membros não viram leitura de toda a igreja — escolha deliberada de
LGPD. O isolamento mora no `WHERE` da view (`current_church_ids()`, que lê `auth.uid()` de quem
consulta) e por isso a view é marcada `security_invoker = false` de forma explícita: o filtro é do
caller, não do dono. Anon não tem `select` na view.

**Primeiro consumo (Fase 2, passo 1):** a tela **Usuários** (`/app/usuarios`) agora lê esse roster por
`src/services/data/rosterService.ts` — `select ... from church_roster where church_id = sessão`; o
espelho `demoRoster()` (hoje em `tests/fixtures/rosterMirror.ts`) tem a **mesma** regra (só ativos,
contatos mascarados sem `members.manage`), para que a suíte prove a paridade com o que o banco mostra. A rota **deixou de exigir
`members.manage`** no `ProtectedRoute`: quem segura a página é a view, não o guard, e um Gerente precisa
ver os colegas para a decisão de LGPD fazer sentido. O que a permissão continua controlando é a escrita
— o botão de convite, a coluna de ações e o card de convites só aparecem para quem tem `members.manage`;
`/app/convites` permanece protegido. Reversão: `permission="members.manage"` de volta na rota
`usuarios` de `src/routes/AppRoutes.tsx` (aí só administrador vê a lista, e a máscara vira caminho morto).

**Escrita real (Fase 2, passo 2):** convite por e-mail, cancelamento, mudança de papel e aceite
passaram por `src/services/data/memberService.ts`, backed por `church_invitations` (migração **0008**).
Três decisões que valem registro:

1. **Por que uma tabela nova e não `church_members`:** `user_id` é `not null references profiles`, então
   quem ainda não tem conta não tem linha para referenciar. O convite existe antes da pessoa. Aceitar é
   que cria o vínculo — por isso o aceite é uma RPC `SECURITY DEFINER` (`accept_church_invitation`): o
   convidado não tem vínculo algum, então nenhuma política de escrita o deixaria inserir em
   `church_members`.
2. **Convite não escala para `superadmin`:** seria a porta de volta para o buraco fechado pela 0005
   (um convite aceito viraria vínculo com papel global). Há duas travas independentes — o trigger
   `trg_church_invitations_role` na tabela e a checagem dentro da RPC — e os casos H4 (pelo convite) e
   H10 (convite criado por cima do trigger, no SQL Editor) provam cada uma. Trocar papel em
   `church_members` continua bloqueado pela 0005 (H13/C13).
3. **Só o destinatário aceita, e só com e-mail confirmado:** a RPC compara o e-mail do convite com o da
   sessão e exige `email_confirmed_at` em `auth.users`; sem isso qualquer conta se aproveitava de um
   convite aberto por um admin, ou de um e-mail digitado errado (H8). `pending_invitations_for_me()`
   faz o mesmo filtro para a listagem, e nem anon nem outro usuário a atravessa (H6/H8).

A UI não decide nada disso: em modo real o que aparece é a resposta do banco — inclusive os erros
`42501` ("sem permissão") e `23505` ("já existe convite pendente"), mapeados para texto legível em
`describeDbError`. O espelho `demo*` correspondente em `tests/fixtures/memberMirror.ts` tem as mesmas
recusas, e `tests/unit/memberWrites.test.ts` confere cada espelho contra o caso de RLS correspondente. Reversão: `drop table public.church_invitations;
drop function public.pending_invitations_for_me(); drop function public.accept_church_invitation(uuid);`
— a tela de Usuários volta a ler o roster, mas convite/papel viram botão morto de novo.

**Listas reais de igrejas (Fase 2, passo 3):** `/igrejas`, `/mapa`, o destaque da home, `/buscar`,
`/admin/igrejas`, a fila de pendentes do `/admin`, "Minhas igrejas" em `/app/perfil` e o cabeçalho do
`/app` agora leem por `src/services/data/churchService.ts`. A decisão que importa é **quais colunas
saem do banco**: a RLS é por linha, então um `select *` no diretório entregaria a qualquer visitante
`email`, `website`, `zip`, `lat`/`lng` e `created_by` de cada igreja. `DIRECTORY_COLUMNS` é o que o
público recebe; `MANAGED_COLUMNS` acrescenta os campos que só a tela de gestão usa. Os dois nomes
estão escritos **por extenso** no grupo I da suíte e amarrados a ela por teste unitário, então
renomear ou derrubar uma coluna numa migração quebra `npm run test:rls` em vez de estourar em
produção com "column does not exist".

O `.eq('approval_status','approved').eq('status','active')` do app **não é a guarda** — é redundância.
Quem decide é `churches_public_read`. Ele existe porque a política, sozinha, deixa o membro ler a
*própria* igreja pendente, e a lista pública de "comunidades verificadas" não pode mostrar quem ainda
não foi aprovado. O grupo I mede as duas camadas separadamente (com e sem o WHERE) justamente para
o WHERE poder sumir num refactor sem que a prova suma junto.

"Minhas igrejas" é o caminho do embed (`church_members → churches`): quando a RLS esconde a igreja, o
PostgREST devolve `null` no embed e a linha é **descartada** — não se inventa um nome a partir do
`church_id`. É por isso que convite ainda não aceito não aparece ali: o vínculo existe (e aparece em
"Convites para você"), a igreja não. O caso I6 é essa frase escrita em SQL.

Onde a ligação real teria introduzido uma mentira, a tela mostrou `—`: a contagem de eventos do mapa e
os zeros de Eventos/Inscrições/Membros e "2 filiais cadastradas" no painel da igreja, porque aquelas
tabelas ainda eram mock em modo real. Eventos passou a ler o banco na Fase 3 (passo 1), Inscrições a ler
e escrever no passo 2 e o formulário a escrever no passo 3; Membros, Campanhas e filiais passaram a ler
no passo M1, então o `—` ficou só enquanto a consulta está em voo. Ministérios passaram a ler **e
escrever** o banco no passo M3a (0015 + 0021 + `ministryService`) e os perfis de rede social no M3b
(0015 + `socialAccountService`); o cadastro institucional e o perfil pessoal passaram a gravar de
verdade no M3c — [src/services/data/churchProfileService.ts](src/services/data/churchProfileService.ts)
e [src/services/data/myProfileService.ts](src/services/data/myProfileService.ts) sobre as tabelas e
políticas que a 0001/0002 já traziam, com a 0004 travando `approval_status`. No M3d foi a vez do
`/visitante/perfil` e do coração da página de evento:
[src/services/data/visitorFavoriteService.ts](src/services/data/visitorFavoriteService.ts) e
[src/services/data/visitorPreferenceService.ts](src/services/data/visitorPreferenceService.ts) sobre a
0016, mais o histórico saindo de `event_registrations` pelo id da sessão (a mesma `event_registrations_read`
da 0012). **Nenhuma tela do aplicativo lê `@/data/mock` desde então.**
Os botões Aprovar/Suspender/Rejeitar do SuperAdmin ficaram desabilitados com o motivo na tela
durante este passo — a escrita deles é o passo 4, logo abaixo.

Reversão: no M3d já não existe "devolver uma linha de import" — `VisitorProfilePage` e o coração de
`EventDetailPage` consomem [src/hooks/useVisitorProfile.ts](src/hooks/useVisitorProfile.ts) e os dois
serviços novos, e o histórico vem de `useMyRegistrations`; voltar atrás é reescrever as três leituras com
`useState` e deixar a 0016 e suas políticas sem uso. Nas duas telas do M3c a reversão já não
é uma linha de import: `/app/igreja` consome `churchProfileService` (tabela `churches`, 0001, política
`churches_update` da 0002 por `church.manage`, com a guarda de `approval_status` da 0004) e `/app/perfil`
consome `myProfileService` (`profiles`, 0001, `profiles_self_update` da 0002 só para a própria conta), e
os cadastros fictícios que as duas exibiam saíram do mock junto com o CNPJ e o "Responsável" de enfeite —
voltar atrás é recriar fixture e deixar serviço e políticas sem uso. Não há mais caminho para
"desligar" as leituras reais do painel ou do mapa: `pendingWiring` e `countEvents` saíram do código no
M1, e sem as duas chaves o app nem sobe.

Reversão, se você preferir o caminho mais aberto: `drop view public.church_roster;` + criar uma
política de `profiles` por colega de igreja — e, para o cadastro, `drop trigger
trg_churches_creator_admin on public.churches;` (nesse caso o fluxo de cadastro volta a exigir uma
RPC `create_church` no backend).

## Escrita real da aprovação do SuperAdmin (Fase 2, passo 4)

Os botões do painel SuperAdmin agora escrevem. `src/services/data/churchApprovalService.ts` faz
`update(churches).set({ approval_status }).eq('id').select(APPROVAL_COLUMNS)` e devolve **a linha que
o banco confirmar**, não a que a tela pediu; se o `update` não devolve linha (RLS filtrando) a frase
é de erro, nunca de sucesso. `useChurchApproval(reload)` é uma linha ocupada por vez, monta o aviso
com o status lido de volta e relê a lista. `ApprovalActions` decide quais botões existem por status
(pendente/em análise → aprovar+rejeitar; aprovada → suspender+rejeitar; suspensa → reativar;
rejeitada → reanalisar) e pede confirmação nas destrutivas — o `key={`${id}:${approval_status}`}` da
lista reinicia a confirmação pendente quando o status muda, para não sobrar "Confirmar suspender"
depois de já ter suspenso.

**Nenhuma migração nova.** Suspensão já morava em `approval_status = 'suspended'` (o CHECK da 0001
aceita os cinco valores) e `status` (`active`/`inactive`) é a conta da própria igreja, editável por
quem tem `church.manage`. A coluna sensível já estava guardada por dois mecanismos que trabalham
juntos, porque RLS não controla coluna: a política `churches_admin_status` (0002, só
`is_superadmin()`) e o trigger `trg_churches_approval_status` (0004, `42501` para qualquer outro
papel). O que faltava era prova de **audiência**, e é o **grupo J** da suíte: J1 aprovar põe a igreja
no diretório anônimo (e o `get diagnostics row_count` prova que a escrita aconteceu, não só a
leitura); J2 suspender tira do público sem cegar a própria igreja; J3 rejeitar tira; J4 grava o
avesso — `email`/`zip`/`website` seguem acessíveis a quem conseguir fazer SQL, porque a proteção de
coluna é a projeção do app, congelada nos testes unitários.

O espelho de teste tem as duas guardas: `demoSetApproval()` recusa quem não é `superadmin` com a mesma
mensagem do `42501`, e `demoDirectoryChurches()` lê o mesmo array — é assim que a suíte prova que aprovar
na tela de gestão aparece no diretório público, sem escrever no banco.

Reversão: apague `churchApprovalService.ts`, `useChurchApproval.ts`, `ApprovalActions.tsx` e
`approvalMap.ts`, e devolva `NOT_WIRED` aos botões de `AdminChurchesPage`/`AdminDashboardPage` (o
`Notice` e o `approvalLabel` ficam parados sem uso; `approvalMap.ts` pode continuar servindo o
`ApprovalBadge`). Nada disso toca o banco — o schema e as políticas são os mesmos de antes, e o que
o usuário aprovou por ele continua aprovado (a escrita é do banco, não do app).

## Auditoria atômica da aprovação (Fase 2, passo 5)

A migração **0009** cria `trg_churches_approval_audit`, um trigger `AFTER UPDATE OF approval_status`
com `SECURITY INVOKER` e `search_path` fixo. A mudança de status e o insert em `audit_logs` pertencem
à **mesma transação**: se a trilha falhar, o banco desfaz a alteração. `INSERT ... RETURNING INTO
STRICT` também impede sucesso quando outro trigger descarta o insert silenciosamente.
Nenhuma política RLS ou permissão foi ampliada.

`churchApprovalService` envia **um único update**, apenas com `approval_status`, e devolve a linha
confirmada pelo banco. Não consulta o estado anterior nem envia ator ou escreve auditoria pelo
frontend. O trigger obtém `actor_id` de `auth.uid()`, nome/igreja de `NEW` e `metadata: { de, para }`
de `OLD`/`NEW`, sob o lock da alteração. Isso também cobre updates diretos pela API. Repetir o
mesmo status ou mudar só o nome não cria trilha de aprovação.

Os verbos são `igreja.aprovada`, `igreja.reativada`, `igreja.suspensa`, `igreja.rejeitada`,
`igreja.em_analise` e `igreja.pendente`. `auditService` cuida da leitura; a trilha da suíte vem de
`demoSetApproval()` em `tests/fixtures/churchMirror.ts`.
`/admin/auditoria` lista os registros mais recentes primeiro, com os embeds `profiles(email)` e
`churches(name)`. Campo ausente permanece `—`; erro de consulta não vira lista fictícia. Há estados
de carregamento, erro, vazio e atualização. A conta e o papel fazem parte da chave da leitura.

**Limites explícitos:**

- Perder a resposta pode deixar o cliente sem saber se a transação inteira foi confirmada, mas não
  cria um intervalo entre duas requisições de escrita. Não há retry automático; confira a lista e
  a Auditoria antes de tentar novamente. A tela não anuncia sucesso parcial nem log novo em no-op.
- A RLS bloqueia insert por usuários comuns (0004) e update/delete inclusive pelo SuperAdmin.
  Isso não torna o histórico inviolável para `service_role` ou para o proprietário do banco.
  O backend sem usuário continua permitido e deixa `actor_id` nulo, sem inventar uma identidade.
- O SuperAdmin **não** insere mais trilha pela API: a 0010 exige a marca de transação que só o
  trigger liga (e desliga em seguida). **K5 agora mede a recusa** — ator de outra conta, linha
  plausível em nome próprio e insert logo após um update legítimo, na mesma transação. Quem executa
  SQL direto (SQL Editor, dono do banco, `service_role`) continua fora do alcance da RLS e pode
  ligar a marca; isso não é fechável por política. Trilhas forjadas antes da 0010 não são corrigidas.
- O fixture de teste prepara a trilha e só altera a igreja após adicioná-la, sem `await` entre essas
  operações; falha de preparação não muda a igreja. No aplicativo nada disso é em memória — quem escreve
  a trilha é o trigger, na mesma transação do update.
- Registrado neste passo como **somente local**: ainda não havia projeto Supabase remoto. Há — as
  0009 e 0010 estão aplicadas no projeto que está no ar (ver "Estado do banco").

Verificação local: **97 testes unitários**, incluindo 46 da trilha (demo, cliente Supabase simulado
e o anti-deriva da marca entre 0009 e 0010), e **74 casos de isolamento** no Postgres embarcado. K mede trilha automática, embeds,
isolamento, recusa e imutabilidade pelo app. L mede privilégios do trigger, seis transições com
ator/nome/de/para reais, ausência de duplicação em no-op, rollback de múltiplas alterações e
trilhas, descarte silencioso do insert e backend sem usuário. As injeções de erro e descarte têm
sondas que confirmam seu funcionamento antes das asserções; tudo termina em rollback.

No navegador local (demo), eventos DOM confirmaram: aprovar uma igreja fictícia gerou exatamente
uma trilha com ator, igreja e `de/para`; o aviso diz só "aprovada", sem promessa de auditoria;
repetir o status não mudou `updated_at` nem criou linha; uma falha simulada na preparação da trilha
deixou igreja e histórico intactos e a tentativa seguinte funcionou; a tela de Auditoria mostrou as
duas ações da sessão. Todas as simulações em memória foram restauradas e o console ficou sem erros.
A superfície visual do navegador embutido segue indisponível (viewport 0x0), portanto layout e
cliques físicos não foram conferidos. O caminho Supabase foi verificado em camadas — cliente
simulado nos unitários e SQL real no Postgres embarcado —, não ponta a ponta no provedor.

Aplique a 0009 e a 0010 antes de usar esta versão do frontend em um projeto real. Remover o trigger sozinho
reabre a possibilidade de aprovação sem trilha; não é uma reversão segura. Uma reversão precisa
coordenar banco e aplicativo, preservando os registros de auditoria existentes.

## Eventos reais (Fase 3, passo 1)

A migração **0011** cria `event_categories` (catálogo público, como `roles`) e `events`, com índices,
`touch_updated_at` e RLS. Quatro políticas de leitura e três de escrita, todas medidas no grupo M:

- `events_public_read`: evento **publicado e público** de igreja **aprovada e ativa**. O `status`
  sozinho não basta — suspender ou rejeitar a igreja tira os eventos dela do ar junto, sem tocar em
  nenhum evento (M4/M4b).
- `events_church_read`: SuperAdmin ou membro da igreja, em qualquer status, rascunho inclusive (M3).
  `visibility` **não** é controle de acesso: é intenção de produto. Quem segura a linha é o vínculo,
  e o M5 grava isso por extenso — um visitante anexado à igreja lê o evento privado, e anon não.
- escrita: `events.manage` na igreja do evento; publicar exige **`events.publish`**, cobrado por um
  trigger `BEFORE INSERT OR UPDATE OF status` com `42501` (M6), porque RLS não controla valor de
  coluna. A função é `SECURITY INVOKER` com `search_path` fixo e sai do caminho quando
  `current_user = 'service_role'` — virar `DEFINER` quebraria o backend, e é o E4 que impede.

`eventService` tinha, neste passo, quatro leituras — diretório público, evento por slug, agenda da
igreja e categorias — e nenhuma escrita (as escritas vieram no passo 3, logo abaixo). As
projeções `EVENTS_PUBLIC_COLUMNS`, `EVENTS_MANAGED_COLUMNS` e `EVENT_CATEGORY_COLUMNS` são o
contrato: a RLS é por linha, então é a projeção que decide as colunas que chegam ao navegador (M8 é o
avesso disso, como J4). Os casos M1/M3 escrevem as mesmas colunas por extenso e os unitários comparam
as listas **nos dois sentidos**.

Telas ligadas: `/`, `/eventos`, `/eventos/:slug`, `/categorias`, `/buscar`, `/mapa`, e no painel
`/app`, `/app/eventos` e `/app/calendário`. Todas têm carregando/erro/vazio reais e recarregar.

**Limites explícitos:**

- `registrations_count` saiu de todas as projeções, do mock e das telas neste passo: a tabela de
  inscrições não existia, e número sem fonte confirmada não vira contagem na tela. No passo 2 a
  contagem voltou, vinda de `event_registration_stats` (0012) — uma fonte só, para o demo e para o
  real.
- O formulário de evento era demonstração neste passo; check-in e lista de inscrições também. Os três
  passaram a escrever de verdade — inscrições no passo 2, o formulário no passo 3.
  O painel do SuperAdmin mostra `—` em "Eventos" no modo real, porque a leitura global dele ainda não
  foi ligada.
- No calendário, a grade do mês recorta os eventos pelo mês em exibição; sem isso um evento de
  dezembro aparecia em novembro. As visões de semana e dia continuam estrutura pronta.
- Implementação e execução **somente locais**: nenhuma migração foi aplicada em projeto remoto.

Verificação local: **135 testes unitários**, incluindo 38 de eventos (projeções amarradas à 0011,
paridade demo × RLS com os ramos de `visibility` e de igreja fora do ar provados por fixtures
temporárias, contrato Supabase simulado e anti-deriva contra M1/M2/M3/M9 e E4), e **85 casos de
isolamento** no Postgres embarcado.

No navegador local (modo demo), o texto do DOM confirmou: `/eventos` lista só os 2 eventos no ar, em
ordem de início, com as 15 categorias do catálogo; `/eventos/congresso-de-jovens-2026` mostra
"Inscritos —" e a organizadora resolvida (nome, denominação, cidade/UF, WhatsApp); o slug do evento
em rascunho devolve "Evento não encontrado"; `/categorias` conta 1 evento no ar em Congressos e 1 em
Vigílias e 0 nas demais; `/mapa` conta 2 eventos publicados na igreja A e 0 na B (o da B está
agendado); `/buscar` por "vigília" acha 1. No painel: `/app` mostra 3 eventos (2 publicados) e os
próximos com badge de status, sem contagem inventada; `/app/eventos` lista os 3 com categoria
resolvida e "—" em Inscritos; `/app/calendário` põe Vigília no dia 14 e Congresso no dia 20 de
novembro e **não** mostra o evento de 12 de dezembro na grade de novembro; `/app/eventos/novo` tem o
select de categoria com 15 opções vindas do catálogo e valor = id. Console sem erros.

Duas coisas **não** foram clicadas no navegador, de propósito: suspender/rejeitar uma igreja para ver
o diretório esvaziar (é ação reservada a você, e o efeito está provado no SQL — M4/M4b — e no espelho
demo — "suspender a igreja tira os eventos dela do ar"), e publicar um evento (o formulário ainda não
escreve; é o passo 2). A superfície visual do navegador embutido segue indisponível (viewport 0x0),
então layout e cliques físicos não foram conferidos. O caminho Supabase foi verificado em camadas —
cliente simulado nos unitários e SQL real no Postgres embarcado —, não ponta a ponta no provedor.

Aplique a 0011 antes de usar esta versão do frontend em um projeto real: sem ela as leituras de
eventos falham com "relation public.events does not exist" e as telas mostram o estado de erro.

## Inscrições reais (Fase 3, passo 2)

A migração **0012** cria `event_registrations` (inscrição, lista de espera, capacidade, código do
ingresso e check-in), a view de agregados `event_registration_stats` e três RPCs. O grupo N da suíte
mede tudo isso: 15 casos / 60 asserções.

**Toda escrita passa por RPC `SECURITY DEFINER`.** Quem se inscreve é um visitante anônimo, sem
vínculo com igreja nenhuma, então não há política de insert que sirva: a tabela tem RLS ligado,
`revoke all ... from anon, authenticated`, `grant select` só para `authenticated` e **uma única**
política, de leitura. Nenhuma escrita direta é possível por nenhum papel — nem pelo dono da
inscrição, que cancela pela RPC.

- `register_for_event(evento, nome, e-mail, telefone)` valida os dados, trava a linha do evento com
  `for update` (é o que serializa a disputa pela última vaga), confere se o evento está no ar —
  publicado, público, igreja aprovada e ativa, e ainda não começou —, recusa e-mail repetido e
  devolve `confirmed` ou `waitlist` conforme a capacidade. **Nunca devolve o `ticket_code`**: o
  visitante não precisa dele, e a função é `anon`.
- `check_in_registration` e `cancel_event_registration` conferem **permissão antes de existência**:
  id inexistente devolve o mesmo `sem_permissao` de uma linha alheia, então as RPCs não servem de
  oráculo para descobrir quais inscrições existem. Cancelar com vaga livre promove o mais antigo da
  fila (`cancelada_com_promocao`).
- `church_id` é derivado do evento por trigger (`42501` se forçado), porque é a coluna que a política
  de leitura usa — deixá-la na mão de quem escreve seria deixar a linha aparecer na igreja errada.
- `event_registration_stats` tem `security_invoker = false` e o isolamento no WHERE: anon vê só os
  eventos no ar, o membro os da própria igreja (rascunho inclusive), o SuperAdmin todos. Só
  agregados — a view não tem nome, e-mail, telefone nem código (N15 confere pelo
  `information_schema`, com sonda de que a varredura ainda enxerga coluna).

`registrationService` tem duas leituras (lista da equipe e contagens) e três escritas, todas por RPC,
mais os espelhos demo com as mesmas recusas, a mesma fila e a mesma porta. As projeções
`REGISTRATION_COLUMNS` e `STATS_COLUMNS` são o contrato: a RLS é por linha, então é a projeção que
decide as colunas que chegam ao navegador. A lista da equipe é a **única** leitura que traz nome,
e-mail e código, e ela exige `registrations.manage` — papel que o comunicador não tem. O recorte no
cliente não é a guarda (o banco é), mas sem ele o espelho demo mostraria o que o banco recusaria.

Telas ligadas: `/eventos/:slug` (formulário de inscrição, contagem e vagas restantes), `/app`,
`/app/inscricoes` (filtro por evento, CSV, check-in e cancelamento), `/app/checkin` (código digitado
ou bipado, log e resumo), `/app/eventos` (coluna Inscritos) e `/admin` (cartão Inscrições). O `—`
inventado saiu de todas elas: o número vem da view, ou do espelho demo, ou não aparece.

**Limites explícitos:**

- **Nenhum QR Code é gerado e nenhuma câmera é aberta** — não há biblioteca de QR no projeto, e
  fingir isso seria mostrar capacidade inexistente. O check-in é pelo código do ingresso (`A2F-9C3`,
  alfabeto sem `0`/`1`), digitado ou lido por scanner USB; a tela diz isso por extenso.
- **Nenhum e-mail ou WhatsApp é enviado.** O texto da inscrição diz que quem avisa é a igreja.
- O `ticket_code` aparece só para a equipe (na lista e no CSV) e para o dono da inscrição; o
  visitante vê apenas "confirmada" ou "lista de espera".
- A porta `registrations.manage` também esconde as telas. Verificado no navegador no passo 3, com a
  conta demo de comunicadora (`paula@ibcentral.org.br`, criada para isso): `/app/inscricoes` responde
  com o **403 da guarda de rota** ("Acesso negado"), antes de a página montar — o texto próprio da
  tela ("O seu papel não gerencia inscrições") é uma segunda linha que a guarda atalha. Está provado
  no SQL (N3) e no unitário de qualquer forma.
- `formatDate` tratava `2026-11-01` como UTC e mostrava 31 de out. em UTC-3. Corrigido na origem:
  data sem hora é lida como local. O carimbo real do banco tem hora e fuso, e segue inalterado.
- Implementação e execução **somente locais**: nenhuma migração foi aplicada em projeto remoto.

Verificação local: **177 testes unitários**, incluindo 40 de inscrições (contrato da 0012 lido do
arquivo — RLS sem política de escrita, projeção comparada nos dois sentidos, view sem dado pessoal,
RPCs `DEFINER` com `search_path` fixo, permissão antes de existência, e cada código do SQL amarrado a
uma mensagem da tela e vice-versa) e **100 casos de isolamento** no Postgres embarcado.

No navegador local (modo demo), o texto do DOM confirmou: `/eventos/congresso-de-jovens-2026` mostra
"Inscritos 3 / 500" e "498 vaga(s) restante(s)" (o evento tem uma pessoa na lista de espera, que não
ocupa vaga); inscrever "Marta Vieira" com e-mail em maiúsculas e espaços devolve "Inscrição
confirmada. A equipe da igreja tem o seu código para o check-in no dia." **sem mostrar código
nenhum**, e a contagem sobe para 4 / 500 com 497 vagas; repetir o mesmo e-mail devolve "Este e-mail
já está inscrito neste evento." sem criar linha. Em `/app` o cartão Inscrições mostra 4 "inscritos
ativos"; em `/app/inscricoes` o filtro por evento tira o João Pedro (é da Vigília), o check-in da
Camila vira "Check-in feito" com o aviso "Check-in registrado.", o cancelamento da Beatriz (lista de
espera, evento com vaga) vira "Cancelada" com "Inscrição cancelada.", e o CSV sai com BOM, separador
`;`, status em português e as colunas Nome/E-mail/Telefone/Evento/Código/Status/Inscrição/Check-in.
Em `/app/checkin` o código `425222` (sem o traço, como manda um scanner) registra "Check-in de João
Pedro registrado." e o resumo vai a 100%; `999-999` devolve "Nenhuma inscrição deste evento tem o
código"; o código `FF5-222`, válido em **outro** evento, também é recusado; repetir um check-in feito
devolve "Esta pessoa já estava registrada como presente."; e o da Beatriz, cancelada, devolve "Esta
inscrição foi cancelada.". Em `/app/eventos` a coluna Inscritos mostra 1, "2 / 500" e 0 (o rascunho,
sem inscrição — zero, não traço, porque a fonte respondeu); em `/admin` o cartão Inscrições mostra 4.
Console sem erros em todas as telas.

Como no passo anterior, o caminho Supabase foi verificado em camadas — cliente simulado nos
unitários e SQL real no Postgres embarcado —, não ponta a ponta no provedor. A superfície visual do
navegador embutido segue indisponível, então layout e cliques físicos não foram conferidos.

Aplique a 0012 antes de usar esta versão do frontend em um projeto real: sem ela as contagens falham
com "relation public.event_registration_stats does not exist" e a inscrição devolve erro.

## Escrita real de eventos (Fase 3, passo 3)

Nenhuma migração nova: as políticas de insert/update/delete já estavam na 0011 e a porta de publicação
já era medida por M6/E4. O passo fechou o serviço e a UI.

`eventService` ganhou três escritas — `createEvent`, `updateEvent` e `setEventStatus`. Diferente das
inscrições (que só existem por RPC), aqui a equipe escreve direto na tabela: a RLS é a guarda, e o
trigger `trg_events_publish` é o que separa `events.manage` de `events.publish`.

**O que o formulário não escreve, de propósito:**

- `church_id` — vem da sessão, nunca do formulário. É o campo que o **M10** (novo) passou a medir: o
  USING de `events_update` olha a igreja atual, então um gerente alcança a linha; quem barra a mudança
  é o WITH CHECK, que avalia o `church_id` novo. Sem ele, um gerente "transferiria" o evento — e as
  inscrições junto, porque `event_registrations.church_id` é derivado do evento.
- `slug` — gerado do nome na criação e **imutável na edição**: links já divulgados continuam valendo.
  A tela diz isso por extenso no subtítulo.
- `is_free` — o produto não cobra; não há caminho na UI para mudar.
- `status` — fora do patch de edição. Toda transição passa por `setEventStatus`, para a porta de
  publicação existir num lugar só.
- **Excluir não existe na UI.** `event_registrations.event_id` é `on delete cascade` (0012): apagar o
  evento apagaria as inscrições junto. A tela **cancela** (`status = 'cancelled'`), e um unitário
  congela isso — o código do serviço não pode conter `.delete(`.

As colunas escritas estão congeladas em `EVENT_INSERT_COLUMNS` e `EVENT_PATCH_COLUMNS`, comparadas
com a 0011 nos dois sentidos, como as projeções de leitura.

**Campos desabilitados com o motivo na tela** (em vez de sumirem, para não fingir que gravam): Filial
("a tabela de eventos ainda não tem coluna de filial"), Latitude/Longitude ("Mapa e GPS são a Fase
4"), Vídeo ("sem coluna na tabela") e o upload de capa — a capa é por URL http(s) já hospedada.

**Conta demo nova:** `paula@ibcentral.org.br` (comunicadora, igreja A). O comunicador é o único papel
com `events.manage` **sem** `events.publish` e sem `registrations.manage` — sem uma conta ativa para
ele, essas duas portas não eram clicáveis no navegador. `cm3` continua `invited`: é o fixture de
"convite não aceito não vira igreja".

**Dois defeitos achados na verificação e corrigidos:**

1. Salvar uma edição **não dava retorno nenhum**. O `onSaved()` chamava `reload()`, que troca a chave
   do `useKeyedList`; a lista esvaziava, o pai mostrava "Carregando..." e o formulário desmontava — o
   aviso "Alterações salvas." morria junto com o componente. Agora a escrita devolve a linha gravada e
   é ela que alimenta o cartão de status (`current`), sem reler a agenda. O formulário não pisca mais.
2. A página pública mostrava **"São José dos Campos — null"** para um evento sem cidade: `${event.city}`
   dentro de um template literal imprime `null`. O texto de compartilhamento tinha o mesmo defeito
   ("...em null."). Os dois agora omitem a parte que não existe.

**Limites explícitos:**

- **Tirar do ar exige só `events.manage`.** O trigger da 0011 guarda apenas `new.status = 'published'`,
  então a comunicadora volta um evento publicado para rascunho e o cancela — o serviço e o espelho demo
  reproduzem exatamente isso, e foi conferido no navegador. É a regra da migração, não uma escolha
  deste passo; endurecê-la (exigir `events.publish` para **sair** de publicado) muda política de
  segurança e precisa de decisão sua.
- Sem igreja ativa na sessão ninguém cria evento — **nem o SuperAdmin**, que é transversal para ler e
  editar mas não tem igreja ativa. A tela diz isso.
- Slug duplicado é recusado com o endereço na mensagem ("Já existe um evento com o endereço
  /retiro-de-lideres..."). Na edição o 23505 não inventa slug: a mensagem é genérica.
- Sem oráculo de existência: linha que não volta e linha sem permissão devolvem a mesma mensagem.
- Implementação e execução **somente locais**: nenhuma migração foi aplicada em projeto remoto.

Verificação local: **217 testes unitários**, sendo 78 de eventos (portas de permissão, contrato
Supabase simulado das três escritas, validação, espelho demo e anti-deriva contra M6/M7/M10 e E4) e
**101 casos de isolamento / 677 declarações** no Postgres embarcado.

**Três mutações** neste passo, cada uma com backup e `md5sum -c` na restauração:

- `with check (true)` no lugar da expressão real de `events_update` → a suíte cai em **M10**
  ("gerente da igreja A moveu o evento para a igreja B", declaração 568/677). **A primeira tentativa de
  mutação foi inócua e é o achado do passo:** só *apagar* a cláusula `with check` não muda nada — sem
  ela o Postgres reusa a expressão do `USING` para a linha nova, e o comportamento é idêntico. Está
  anotado no caso M10 para ninguém repetir.
- `gatePublish` devolvendo sempre `null` (porta de publicação desligada no serviço) → caem **três**
  unitários: "publicar sem `events.publish` é recusado antes de qualquer consulta (M6)", "a porta vem
  antes da validação" e "o comunicador cria e edita, mas não publica — igual ao banco".
- `demoEditableEvent` devolvendo o evento sem conferir a igreja → cai "editar evento de outra igreja
  devolve *não encontrado*, sem confirmar que existe". O espelho demo voltaria a editar linha alheia
  que o banco recusa.

Nenhuma mutação ficou no código nem nas migrações (`0011_events.sql` e `eventService.ts` conferidos
por `md5sum -c` depois da restauração).

No navegador local (modo demo), o texto do DOM confirmou, como `marcos@` (administrador, com MFA):
criar sem nome devolve "Informe o nome do evento (pelo menos 3 caracteres)." sem sair da tela; fim
antes do início devolve "A data final precisa ser depois do início."; "Retiro de Lideres" salva como
rascunho com o slug `/retiro-de-lideres`, capacidade "0 / 120" e **não aparece** no diretório público;
a edição carrega os valores gravados, salva com "Alterações salvas." visível e mantém o slug mesmo
trocando o nome para "Retiro de Lideres 2026"; publicar mostra "Evento publicado: já aparece no
diretório público.", troca os botões para Rascunho/Cancelar e põe o evento no `/eventos` com
`/eventos/retiro-de-lideres`; criar outro "Retiro de Lideres" devolve a mensagem de endereço
duplicado; `/app/inscricoes` como comunicadora responde com o 403 da guarda de rota. Como `paula@`
(comunicadora): o cabeçalho tem só "Salvar rascunho" e o aviso âmbar "O seu papel cria e edita
eventos, mas não põe no ar...", o rascunho "Ensaio do Coral de Natal" é criado e entra na agenda com
o slug gerado, cancelar mostra "Evento cancelado: saiu do diretório público e as inscrições continuam
registradas." e esconde todas as transições, e voltar o Congresso de Jovens para rascunho **tira o
evento do diretório público na hora** (sobrou só a Vigília). Console sem erros em todas as telas.

Como nos passos anteriores, o caminho Supabase foi verificado em camadas — cliente simulado nos
unitários e SQL real no Postgres embarcado —, não ponta a ponta no provedor. A superfície visual do
navegador embutido segue indisponível (viewport 0x0), então layout e cliques físicos não foram
conferidos: a verificação é pelo texto do DOM e por navegação programada.

Aplique a 0011 antes de usar esta versão do frontend em um projeto real: sem ela as escritas falham
com "relation public.events does not exist".

## Filiais, localização e mapa real (Fase 4)

Uma migração nova — `0013_branches_location.sql` — e três serviços ligados a ela. Nada remoto foi
aplicado: a 0013 roda no Postgres embarcado (`npm run test:rls`, 23 declarações) e só.

**O que a 0013 cria:**

- `church_branches` (filiais/congregações) com `lat`/`lng` opcionais e RLS própria: leitura para membro
  **ativo** da igreja e para o SuperAdmin, insert/update com `church.manage`. **`anon` não recebe grant
  nenhum** — a recusa acontece antes da RLS (caso O1). Filial não é vitrine pública.
- `events.branch_id` (+ `latitude`/`longitude`), com o trigger `enforce_event_branch` (SECURITY DEFINER,
  `search_path` fixo, sem EXECUTE público) que recusa filial de outra igreja com o **mesmo** SQLSTATE
  `42501` e a **mesma** mensagem de uma filial inexistente — sem oráculo de existência (caso O8).
- CHECK de coordenada nas três tabelas (`churches`, `church_branches`, `events`): `lat` entre -90 e 90,
  `lng` entre -180 e 180, NULL aceito. Endereço sem GPS é estado honesto, não erro (caso O9).
- **Não há delete em camada nenhuma**: sem política e sem grant, nem o SuperAdmin apaga filial (O7). Uma
  filial cadastrada é editada, não excluída; o serviço não expõe a operação e a tela não oferece botão.

**O que passou a ser real no app:**

- `branchService` — leitura (`fetchChurchBranches`, com o recorte de membro ativo espelhando O3) e
  escrita (`createBranch`/`updateBranch`, porta `church.manage`). Projeção `BRANCH_COLUMNS` congelada e
  comparada com a 0013 nos dois sentidos.
- `eventService` — o formulário de evento grava filial e coordenadas (`branch_id`, `latitude`,
  `longitude`); a filial de outra igreja é recusada no espelho demo com `EVENT_BRANCH_MISMATCH`, a mesma
  mensagem do trigger. Só o campo **Vídeo** continua desabilitado (sem coluna).
- `churchService` — `MAP_COLUMNS` (diretório + `lat`/`lng`) e `fetchMapChurches`/`demoMapChurches`.
- **Mapa público (`/mapa`)** — Leaflet + OpenStreetMap (decisão sua): tiles reais, sem chave. Só é
  plotada igreja com coordenada real (`toLatLng`); sem coordenada a lista diz "não aparece no mapa" e o
  pino não é inventado. GPS do navegador (`useGeolocation`), **sem geocodificador** — distância
  (haversine), ordenação por proximidade (`sortByProximity`) e o botão Rota (`directionsUrl`) só existem
  depois que o navegador confirma a posição. Se os tiles não carregarem (sem rede), o aviso é honesto em
  vez de um desenho fingindo ser mapa.

### Revisão de risco — coordenada na projeção pública do mapa

**Mudança de audiência de dado:** `MAP_COLUMNS` é o primeiro lugar em que o app **exibe** `lat`/`lng` de
uma igreja para `anon`. Avaliado por escrito antes de ligar:

- **No banco não é exposição nova.** A RLS de `churches` é por linha e `churches_public_read` (0002) já
  devolve a linha inteira da igreja aprovada+ativa para `anon`; `lat`/`lng` sempre foram legíveis por
  quem consulta o diretório. O que a projeção faz é **limitar** colunas, não abrir: `DIRECTORY_COLUMNS`
  continua sem `lat`/`lng` (a lista de igrejas não precisa deles), e só o mapa os pede.
- **Sensibilidade baixa.** A coordenada é a localização pública do templo — o mesmo fato já exibido como
  endereço/cidade no diretório. Não é dado pessoal (não é a casa de ninguém), não é contato privado
  (`email`/`website`/`zip` seguem fora, só na lista de gestão).
- **O que ficou de fora, de propósito:** coordenada de **filial** nunca chega ao público (`church_branches`
  sem grant de `anon`, O1; o mapa plota igrejas, não congregações), e `latitude`/`longitude`/`branch_id`
  de **evento** seguem fora da projeção pública de eventos. Publicar a lista de filiais seria decisão da
  igreja, não default do app.
- **GPS do visitante** é lido no navegador e usado só para distância/rota locais; não é enviado ao banco
  nem armazenado. Sem geocodificador, nenhum endereço é resolvido por terceiro.

**Prova por mutação** (cada guarda quebrada de propósito; o teste tem de falhar; código restaurado e
suíte verde de novo — 286 unitários):

| Guarda quebrada | Teste que pegou |
| --- | --- |
| `lat` dentro de `DIRECTORY_COLUMNS` | "o diretório não leva contato privado…" + "é o diretório mais lat/lng, e o diretório segue sem as coordenadas" + "a linha do mapa tem exatamente as colunas da projeção" (3) |
| `MAP_COLUMNS` sem `lat`/`lng` | "é o diretório mais lat/lng…" + "a linha do mapa tem exatamente as colunas da projeção, coordenadas inclusive" (2) |
| `gateWrite` de filial devolvendo sempre `null` | "papel sem church.manage não escreve, e nenhuma consulta sai" + "a porta vem antes da validação" (2) |
| Removida a checagem de membro ativo (O3) | "vínculo convidado não lê filial (caso O3)" (1) |
| `demoBranchMismatch` aceitando filial de outra igreja | "filial de outra igreja é recusada — espelho demo do trigger (O8)" + "editar apontando para filial de outra igreja também é recusado" (2) |

Nenhuma mutação ficou no código: `churchService.ts`, `branchService.ts` e `eventService.ts` foram
restaurados e a suíte completa voltou a 286/286.

**Limites explícitos da Fase 4:**

- Sem rede, os tiles do OpenStreetMap não carregam e o mapa mostra o aviso de falha — os pinos e a lista
  seguem com os dados já baixados. Nunca há um mapa desenhado fingindo ser real.
- Sem geocodificador: digitar um endereço não vira coordenada. O GPS do navegador ou a digitação manual
  de `lat`/`lng` são as únicas entradas.
- Coordenada é opcional nas três tabelas; igreja/filial/evento sem GPS é estado normal e visível.
- Implementação e execução **somente locais**: a 0013 não foi aplicada em projeto remoto. Aplique-a antes
  de usar este frontend em um projeto real, junto com 0011 e 0012.

Verificação local: **286 testes unitários** (31 de filiais, 24 de geo/distância, 18 de listas de igrejas
— 5 do mapa —, 87 de eventos) e **749 declarações** de isolamento no Postgres embarcado com a 0013
aplicada (23 declarações), tudo verde.

No navegador local (modo demo, `npm run dev`), o texto do DOM confirmou:

- **`/mapa`** — contêiner Leaflet presente com **9 tiles reais do OpenStreetMap carregados** e **2 pinos**
  (as duas igrejas com coordenada; nenhuma sem coordenada no fixture, então nenhum aviso de "não
  plotada"). Ao clicar em "Usar minha localização" com o GPS negado, aparece a mensagem honesta
  "Permissão de localização negada. Libere o acesso no navegador ou digite as coordenadas." e **nenhum
  pino de usuário é inventado** — distância e ordenação por proximidade só aparecem com posição
  confirmada. Console sem erros.
- **`/app/filiais`** (como `marcos@`, church_admin, com MFA) — a lista traz "Sede — Centro" com a
  coordenada real `-23.1857, -45.8871` e "Congregação Zona Sul" com **"sem coordenada"**; não há botão
  nem texto de excluir, e o cartão "Sem exclusão pelo app…" está visível. O formulário de edição carrega
  nome/endereço/cidade/UF/responsável e os campos de latitude/longitude (com `min`/`max` -90/90 e
  -180/180) já preenchidos, mais o botão de GPS e o aviso "Sem geocodificador: o endereço não vira
  coordenada sozinho.". Editar o responsável e **Salvar alterações** gravou de verdade: a lista passou a
  mostrar o novo valor.
- **`/app/eventos/novo`** — o campo **Filial** é um `select` real e habilitado com as filiais da igreja
  vindas do `branchService` ("Sem filial (evento da igreja inteira)", "Congregação Zona Sul",
  "Sede — Centro"), e o `CoordsField` (latitude/longitude + GPS) está presente. O campo **Vídeo** segue
  desabilitado (sem coluna na tabela).

Como nos passos anteriores, o caminho Supabase real foi verificado em camadas — cliente simulado nos
unitários e SQL real no Postgres embarcado —, não ponta a ponta no provedor. A superfície visual do
navegador embutido segue indisponível para inspeção de layout fino (viewport), então a verificação é
pelo texto do DOM, pelos atributos dos campos e por navegação programada.

## Campanhas de divulgação e distribuição sem chave (Fase 5)

Uma migração nova — `0014_marketing_campaigns.sql` — e um serviço ligado a ela. Nada remoto foi
aplicado: a 0014 roda no Postgres embarcado (`npm run test:rls`, 17 declarações) e só.

**O que a 0014 cria:**

- `marketing_campaigns` com RLS própria: leitura e escrita exigem `marketing.manage` na igreja da
  campanha (SuperAdmin atravessa). **`anon` não recebe grant nenhum** — a recusa acontece antes da RLS
  (caso P1). Campanha é dado de gestão, não vitrine. Pastor não tem `marketing.manage` (rbac e seed),
  então não vê campanha — a mesma audiência que a rota `/app/marketing` já exige.
- O trigger `enforce_campaign_publish` (INVOKER, `search_path` fixo) que **só deixa `service_role`**
  marcar `status = 'published'` ou `'failed'`. Pelo `authenticated` a transição é recusada com `42501`
  e uma mensagem própria (caso P7): nenhuma campanha nasce "publicada" sem confirmação real do provedor.
- CHECK de contenção em `networks` (só instagram/facebook/tiktok/whatsapp **na 0014** — a 0020 recria o
  CHECK sem o tiktok, no passo M3b) e em `status` (draft/
  scheduled/published/failed/cancelled). `event_id` é `on delete set null`; `church_id`, `on delete cascade`.
- **Não há política de delete** e o grant de `authenticated` não inclui delete, como em `church_branches`
  (0013). Campanha é **cancelada** (`status = 'cancelled'`), não apagada (caso P8).

**O que passou a ser real no app:**

- `marketingService` — leitura (`fetchChurchCampaigns`, com o recorte de membro ativo + `marketing.manage`
  espelhando P2/P3) e escrita (`createCampaign`/`updateCampaign`/`setCampaignStatus`, porta `marketing.manage`).
  Projeção `CAMPAIGN_COLUMNS` congelada e comparada com a 0014 nos dois sentidos; `created_by` existe na
  tabela mas não é projetado. `publishCampaign()` **não recebe argumento e nunca escreve**: devolve sempre
  "não conectado", o espelho no serviço do trigger P7.
- `utils/share.ts` — distribuição **sem chave**: `whatsappShareLink` (wa.me), `copyToClipboard`,
  `webShare` (Web Share nativo) e `utmLink` (marca a origem). Tudo honesto: sem clipboard nem Web Share,
  o resultado diz o motivo em vez de fingir sucesso.
- **Central de divulgação (`/app/marketing`)** — lista real via `useChurchCampaigns`, formulário de
  criar/editar (nome, mensagem, redes, evento vinculado), agendar/cancelar/reabrir reais via
  `setCampaignStatus`, e o botão **Publicar** que devolve o aviso honesto sem marcar nada. A distribuição
  gera o link público do evento **só se ele está publicado e público** (`publicUrlFor`); senão a tela diz
  por quê em vez de distribuir um link que abre em "evento não encontrado".
- **Redes sociais (`/app/redes`)** — todas as contas **Não conectado**, sem botão de "conectar" de mentira
  e sem nota falsa de backend. A página explica o que conectar exigiria (OAuth + backend com tokens) e
  aponta para a distribuição sem chave.
- **Página pública do evento (`/eventos/:slug`)** — WhatsApp, copiar link (com UTM) e compartilhamento
  nativo, sem chave nenhuma.

### Revisão de risco — audiência da tabela nova e a guarda de publicação

**Mudança de audiência de dado:** a 0014 cria uma tabela privada nova e uma guarda que impede o app de
publicar. Avaliado por escrito antes de ligar:

- **Não é exposição nova — é restrição.** `marketing_campaigns` nasce sem grant de `anon` e com RLS por
  `marketing.manage`; nenhum dado de divulgação vira público. O que chega ao navegador é limitado pela
  projeção `CAMPAIGN_COLUMNS` (a RLS é por linha e deixaria ler a linha inteira); `created_by` fica de fora.
- **Sensibilidade.** Campanha é conteúdo de gestão da igreja (nome, mensagem, redes alvo, agendamento).
  Não é dado pessoal de terceiro: o `message` é o texto que a própria igreja vai divulgar. A distribuição
  sem chave expõe apenas o **link público do evento**, que já é público por definição (evento publicado +
  visibilidade pública).
- **Publicação nunca é fingida.** O princípio "mostrar só estado confirmado pelo provedor" vira duas
  barreias: no banco, o trigger recusa `published`/`failed` de `authenticated` (P7); no serviço,
  `publishCampaign` não escreve e devolve "não conectado". Nenhuma conta aparece como conectada e nenhuma
  campanha como publicada sem confirmação real. **Nenhum segredo passa pelo app** e nenhum "Authorize" de
  terceiro é clicado em nome do usuário.
- **O que ficou de fora, de propósito:** postagem real em rede (exige OAuth + backend + tokens, que não
  existem aqui); Open Graph/SEO por evento (exigiria prerender/SSR — o app é SPA); delete de campanha
  (campanha é cancelada, não apagada).

**Prova por mutação** (cada guarda quebrada de propósito; o teste tem de falhar; código restaurado e
suíte verde de novo — 342 unitários e 827 declarações SQL):

| Guarda quebrada | Teste que pegou |
| --- | --- |
| `gateWrite` do serviço devolvendo sempre `null` | "papel sem marketing.manage não escreve, e nenhuma consulta sai" + "a porta vem antes da validação" (2 unitários) |
| `publishCampaign` gravando `published` de mentira | "publishCampaign devolve 'não conectado' para qualquer papel, sem escrever" + "o fonte do serviço não grava status published" (2 unitários) |
| Leitura demo sem o gate `marketing.manage` | "pastor não tem marketing.manage: não lê campanha nenhuma (P3)" + "visitante não lê" (2 unitários) |
| Leitura demo sem a checagem de membro ativo | "vínculo convidado não lê (caso P3)" (1 unitário) |
| Política de leitura com `USING (true)` | guarda estrutural **E2** ("política aberta em tabela privada") — a suíte para antes dos casos P |
| Política de leitura trocada para `events.manage` | **P3** comportamental ("pastor da A leu 2 campanha(s)") — mutação que a E2 não vê, porque o `USING` continua real |
| Trigger `enforce_campaign_publish` neutro (`if false`) | **P7** ("authenticated inseriu campanha já publicada") |
| `WITH CHECK (true)` no insert | **P3** ("pastor sem marketing.manage inseriu campanha") — para antes do P4 |
| `WITH CHECK` do insert checando uma igreja fixa, não a da linha | **P4** ("church_admin da A criou campanha na igreja B") — isola a barreira de igreja cruzada que o P3 não cobre |

Duas ordens valem como achado: abrir o insert (`WITH CHECK (true)`) é pego primeiro pelo **P3** (pastor
não insere), e o **P4** só é alcançável com uma mutação que mantém o pastor bloqueado mas libera a igreja
vizinha para quem gerencia a própria — foi assim que o P4 provou ter dentes próprios. Nenhuma mutação
ficou no código: `marketingService.ts` e `0014_marketing_campaigns.sql` foram restaurados e a suíte
completa voltou a 342/342 unitários e 827/827 declarações.

**Limites explícitos da Fase 5:**

- Publicar numa rede **não existe**: exige OAuth + backend com tokens (service_role). O botão Publicar
  devolve o aviso honesto; a campanha continua rascunho ou agendada.
- Distribuição é **sem chave**: WhatsApp (wa.me), copiar link com UTM e Web Share nativo. Se o navegador
  não tem clipboard nem Web Share, a tela diz isso e sobra o caminho manual — nunca finge sucesso.
- O link de distribuição só existe para evento **publicado e público**; caso contrário a tela explica por
  quê em vez de gerar um link morto.
- Registrado neste passo como **somente local**: a 0014 ainda não estava em projeto remoto. Ela foi
  aplicada depois, junto com 0001–0013 e o `seed.sql`, no projeto que está no ar (ver "Estado do banco").

Verificação local: **342 testes unitários** (40 de campanhas, 16 de distribuição sem chave) e **827
declarações** de isolamento no Postgres embarcado com a 0014 aplicada (17 declarações), tudo verde.

No navegador local (modo demo, `npm run dev`), o texto do DOM confirmou:

- **`/app/marketing`** (como `paula@`, communicator, **sem MFA**) — a lista traz as **três campanhas da
  própria igreja** em ordem de criação ("Ação Social de Natal" agendada, "Vigília — contagem regressiva"
  rascunho, "Divulgação Congresso de Jovens" agendada) e **nenhuma da igreja vizinha** (isolamento P2/P3
  visível na tela). O banner honesto está no topo. Abrindo a campanha do evento publicado+público, o
  painel mostra as redes como **"Instagram/Facebook/WhatsApp — não conectado"**, a caixa "Distribuição sem
  chave" com o link marcado `?utm_source=igrejaconecta&utm_medium=social&utm_campaign=divulgacao-congresso-de-jovens`
  e os botões WhatsApp / Copiar link / Compartilhar (este **desabilitado**, com o aviso "Este navegador não
  tem compartilhamento nativo"). Clicar **Publicar** não muda o status: aparece o aviso "Nenhuma rede está
  conectada…" e a campanha **continua Agendada** — o trigger P7 espelhado na tela. **Reabrir rascunho**
  gravou de verdade: o status virou "Rascunho", o agendamento foi limpo e o aviso "Campanha rascunho."
  apareceu. Console sem erros.
- **Achado corrigido na verificação:** o link de WhatsApp do painel era montado com a URL **limpa** do
  evento, enquanto Copiar/Compartilhar/exibição usavam a URL **com UTM** — ou seja, o canal principal de
  divulgação de uma igreja chegava sem a marcação de origem. `shareText` passou a embutir o `taggedUrl`
  (não o `publicUrl`), e o `wa.me` verificado agora carrega `utm_source/utm_medium/utm_campaign`, igual aos
  demais botões e à página pública do evento. Build + 342 unitários verdes depois da correção.
- **`/app/redes`** (como `paula@`) — as **quatro contas** (Instagram, Facebook, TikTok, WhatsApp) aparecem
  como **"Não conectado"**, cada uma com o que conectar exigiria de verdade (Meta Graph, TikTok Content
  Posting, WhatsApp Cloud). O banner "Nenhuma rede está conectada" explica que publicar exige OAuth +
  backend com tokens e que **não há botão de "conectar" de mentira**; sobra o cartão "Distribuição sem
  chave" apontando para a Central. Nenhum botão Conectar/Renovar/Desconectar existe no DOM. Console sem erros.
  *(Medição da Fase 5, superada no M3b: a tela passou a ler e escrever `church_social_accounts`, o TikTok
  saiu das duas superfícies e o "Não conectado" virou selo que só aparece quando o banco diz o contrário —
  ver [M3b](#m3b--perfis-de-rede-escrevendo-o-banco-e-o-tiktok-fora).)*
- **`/eventos/:slug`** (página pública, verificado antes) — "Divulgar este evento" com WhatsApp / Copiar /
  Compartilhar e o link UTM correto; o WhatsApp da igreja organizadora segue separado.

Como nos passos anteriores, o caminho Supabase real foi verificado em camadas — cliente simulado nos
unitários e SQL real no Postgres embarcado —, não ponta a ponta no provedor. A superfície visual do
navegador embutido segue indisponível para inspeção de layout fino (viewport), então a verificação é
pelo texto do DOM, pelos atributos dos campos, pelos `href` dos links e por navegação programada.

## Gerador local de texto de campanha (Fase 6)

A Fase 6 liga a parte do "IgrejaConecta AI" que **não precisa de chave**: um gerador de texto de
campanha que roda no aparelho, determinístico, sem provedor e sem IA. Nada remoto foi criado e
**nenhuma migração nova** — o texto gerado salva como rascunho pela porta que já existe
(`marketing.manage` + RLS da 0014), então a suíte de isolamento (827 declarações) não precisou rerodar.

**O que é local (funciona agora):**

- `utils/campaignText.ts` — a função pura `generateCampaignText(event, style)` monta **nome**
  ("Divulgação — <evento>"), **mensagem** (abertura por estilo, primeira frase da descrição, data por
  `formatDateTime`, local, "Entrada gratuita" ou "Vagas limitadas (N)", CTA e hashtags) e **redes** alvo.
  Três estilos (`convite`/`urgente`/`informativo`) geram três mensagens distintas. As hashtags saem do
  nome + categoria do evento via `slugify` (sem acento, sem stopword, sem número puro) e sempre incluem
  `#IgrejaConecta`. **Sem emoji** (usa "Data:"/"Local:"), determinístico: a mesma entrada produz sempre
  a mesma saída.
- Ligado em dois lugares: no formulário de **Nova campanha** (`/app/marketing`), o campo "Sugestão de
  texto (modelo local, sem IA)" com seletor de estilo + botão **Gerar sugestão** preenche nome, mensagem
  e redes a partir do evento vinculado; e na página **`/app/ia`**, o cartão "Gerador de texto de campanha"
  (evento + estilo + **Gerar texto**) mostra o resultado com **Copiar mensagem** e, para quem tem
  `marketing.manage`, **Criar rascunho de campanha** (grava de verdade via `createCampaign`).

**A fronteira de honestidade (local x provedor):**

- O que **não precisa de chave** está ligado e funciona: gerar texto a partir dos dados reais do evento.
- O que **precisa de `OPENAI_API_KEY`** — IA de provedor (texto de modelo, artes/imagem, vídeos) — fica
  **"Não conectado"**, no mesmo padrão da Fase 5. A chave **nunca vai para o frontend**, onde ficaria
  exposta; ela exigiria um backend que a guardasse, e esse backend não existe aqui. Nenhum botão finge
  uma arte, um vídeo ou uma resposta de modelo que não aconteceu.
- Os testes travam essa fronteira: uma asserção lê o fonte de `campaignText.ts` e falha se aparecer
  `import.meta.env`, `fetch(`, `supabase` ou `api[_-]?key`, e se os imports não forem exatamente
  `@/utils/format` e `@/types`. Ou seja, o gerador **não pode** passar a chamar provedor ou ler segredo
  sem quebrar um teste.

**Limites explícitos da Fase 6:**

- É um **modelo local (template), não IA**: o texto é montado com os dados do evento, não gerado por um
  modelo. A página diz isso com todas as letras.
- Artes, vídeos e IA de provedor **não existem** sem um backend com chave; quando ele existir, a chave
  fica só nele.
- O rascunho criado salva pela mesma audiência da Fase 5; em **modo demo** a escrita não persiste entre
  recarregamentos (estado em memória), como toda escrita demo.

Verificação local: **360 testes unitários** (18 do gerador: determinismo, formato dos fatos, hashtags,
estilos distintos, validação como `CampaignDraft` e a fronteira de honestidade no fonte), build verde e
lint sem erro novo. Como a Fase 6 **não muda auth nem audiência de dado** (reusa `createCampaign`, já
guardado, sem tabela/política/projeção nova), a prova por mutação não é disparada — no lugar, os
unitários + a asserção "nenhum segredo na fonte".

No navegador local (modo demo, `npm run dev`), o texto do DOM confirmou:

- **`/app/ia`** (como `paula@`, communicator, **sem MFA**) — banner honesto ("modelo local (template),
  não é IA"; chave nunca no frontend). Escolhendo "Congresso de Jovens 2026" + estilo Convite e clicando
  **Gerar texto**, o resultado trouxe nome "Divulgação — Congresso de Jovens 2026", mensagem com
  "Data: 20/11/2026, 19:30", "Local: Rua das Palmeiras, 120 — Centro, São José dos Campos",
  "Vagas limitadas (500)." e as hashtags `#congresso #jovens #congressos #IgrejaConecta`; o log
  "Gerado nesta sessão" registrou a geração. **Criar rascunho de campanha** gravou (aviso verde
  "Rascunho de campanha criado." + link "Abrir Central de divulgação") e o botão virou "Rascunho criado"
  desabilitado. O cartão "Artes, vídeos e IA de provedor" mostra tudo **Não conectado**, cada um com o
  que conectar exigiria, e a nota "Sem botão de gerar de mentira". Console sem erros.
- **`/app/marketing`** (como `paula@`) — em **Nova campanha**, o campo "Sugestão de texto (modelo local,
  sem IA)" nasce com estilo e **Gerar sugestão desabilitados** e a dica "Escolha um evento vinculado…";
  ao selecionar "Congresso de Jovens 2026" o botão habilita e, clicando, **preenche** nome
  ("Divulgação — Congresso de Jovens 2026") e mensagem com o mesmo texto do gerador. Console sem erros.

Como nos passos anteriores, o caminho Supabase real foi verificado em camadas — cliente simulado nos
unitários —, não ponta a ponta no provedor. A superfície visual do navegador embutido segue indisponível
para inspeção de layout fino (viewport), então a verificação é pelo texto do DOM e por navegação programada.

## Automações e notificações (Fase 7)

A Fase 7 tira as automações do mock e as liga como **simulação local honesta**. Nada remoto foi
criado e **nenhuma migração nova** — as regras vivem em estado local/sessão (não há tabela de
automação), então a suíte de isolamento (827 declarações) não precisou rerodar. O que existe é um
motor puro que calcula **o que cada regra dispararia agora** com os dados reais da igreja, e uma tela
que liga/desliga cada regra e mostra esse dry-run sem fingir execução.

**O que é local (funciona agora):**

- `utils/automationEngine.ts` — funções puras e determinísticas, sem provedor, sem chave, sem `fetch`
  e sem emoji. `evaluateRule(rule, ctx)` casa os eventos da igreja com o gatilho da regra e devolve os
  eventos que **disparariam** (`wouldFire`) com uma prévia por evento: rótulo, detalhe, quantas pessoas
  receberiam e a **mensagem que seria enviada** (`confirmMessage`/`reminderMessage`/`cancelledMessage`/
  `linkMessage`). Quatro gatilhos, cada um com a sua regra de casamento:
  - `new_registration` — evento **publicado** com inscrições ativas (pendente + confirmada + check-in;
    **lista de espera fica de fora**, porque ainda não recebeu a vaga);
  - `event_soon` — evento **publicado** com inscrições ativas que **começa dentro de 24h**
    (`SOON_WINDOW_HOURS`, contado do instante da simulação);
  - `event_cancelled` — evento **cancelado** com inscritos (aqui entram também os da lista de espera —
    todo mundo que se inscreveu precisa saber);
  - `new_event` — evento **publicado e público**, gerando o link público (`absoluteUrl('/eventos/<slug>')`).
  `evaluateAll` roda só as regras ligadas, na ordem; `summarize` soma regras que disparariam, mensagens
  e eventos distintos. O contexto (`events`, `stats`, `now`) vem dos hooks reais (`useChurchEvents`,
  `useRegistrationStats`) — o dry-run é calculado sobre o que a igreja tem de verdade.
- **Tela `/app/automacoes`** — quatro contadores honestos: **Regras ativas** (as que você ligou),
  **Disparariam agora** (com os dados atuais), **Mensagens na simulação** (as que *seriam* enviadas) e
  **Envios reais** = **0 · não conectado**. Cada regra é um cartão com um interruptor
  (`role="switch"`, `aria-checked`) que muda o estado local e, com ele, o dry-run na hora. Quando uma
  regra ativa casa, a tela lista os eventos e mostra a mensagem exata que seria enviada, com a ressalva
  "N pessoa(s) receberia(m) — se houvesse provedor. Nada é enviado.". Quando não casa, diz "Nada
  dispararia agora com os dados atuais da sua igreja.".

**A fronteira de honestidade (local x backend/provedor):**

- O que **não precisa de chave nem de servidor** está ligado: calcular e mostrar o que dispararia, e
  ligar/desliga cada regra. O link de `new_event` é o link público do evento (que já existe na Fase 3).
- O que **precisa de scheduler + provedor + backend** fica **"Não conectado"**, no mesmo padrão das
  Fases 5 e 6. Dois cartões laterais dizem o que cada coisa exigiria de verdade: os **canais de envio**
  (E-mail/SMTP, WhatsApp Business, Push web e Interno, cada um com o provedor + backend que faltam) e
  **Execução e agendamento** (um scheduler no servidor que detecte o gatilho, um provedor que envie, e
  idempotência/logs para não enviar duas vezes). O banner do topo é explícito: *"Nenhuma automação
  executa aqui […] nada fica marcado como enviado ou agendado."*
- A régua é a mesma das outras fases: **mostrar só o estado confirmado**. Nenhum dry-run vira "enviado",
  nenhuma regra ligada vira "agendada com sucesso", e as chaves **nunca vão para o frontend** — disparar
  de verdade exigiria um backend que as guardasse, e esse backend não existe aqui.
- Os testes travam essa fronteira: uma asserção lê o fonte de `automationEngine.ts` e falha se aparecer
  `import.meta.env`, `fetch(`, `supabase` ou `api[_-]?key`, e se os imports não forem exatamente
  `@/utils/format`, `@/utils/share` e `@/types`. Outras asserções exigem que as mensagens **não**
  contenham emoji nem palavras que finjam execução (`enviado`/`enviada`/`enviamos`/`entregue`/
  `executado`/`disparado`/`agendado com sucesso`) nem `undefined`/`null`/`NaN`. Ou seja, o motor **não
  pode** passar a chamar provedor, ler segredo ou mentir sobre envio sem quebrar um teste.

**Limites explícitos da Fase 7:**

- **Nada envia, nada agenda e nada executa.** É dry-run: mostra o que *seria* feito, calculado no
  navegador. Disparar de verdade exige scheduler (pg_cron, fila ou Edge Function) + provedor (SMTP,
  WhatsApp Cloud, Web Push) + backend com as chaves — decisão de produto + infra, não de frontend.
- As regras ficam em **estado local/sessão** (memória do componente): ligar/desligar muda a simulação
  atual, mas não persiste no banco (não há tabela de automação) e volta ao recarregar.
- O "instante" da simulação é fixado na carga da página (`SIMULATION_INSTANT`), para o dry-run ser
  determinístico enquanto a tela está aberta; `event_soon` só casa evento que começa dentro de 24h
  desse instante.
- Como a Fase 7 **não muda auth nem audiência de dado** (sem tabela, política, projeção ou RPC novos —
  reusa leituras já guardadas de eventos e inscrições), a **prova por mutação não é disparada**; no
  lugar, os unitários do motor + a asserção "nenhum segredo na fonte".

Verificação local: **381 testes unitários** (21 do motor: determinismo, casamento de cada gatilho,
exclusões corretas — lista de espera fora do `new_registration` mas dentro do `event_cancelled`,
evento fora da janela de 24h e rascunho/privado/não listado/cancelado fora do `new_event` —, contagem
de destinatários, link gerado, resumo somado, mensagens honestas e a fronteira de segredo no fonte),
build verde e lint sem erro novo. A remoção dos mocks inertes (`automationRules` do `data/mock.ts` e a
interface `AutomationRule` dos tipos) não deixou referência pendente.

No navegador local (modo demo, `npm run dev`), o texto do DOM confirmou, como `ana@ibcentral.org.br`
(gerente, tem `automation.manage`, **sem MFA**):

- **`/app/automacoes`** — banner honesto no topo; contadores reais (com as quatro regras ligadas:
  **Regras ativas 4**, **Disparariam agora 2**, **Mensagens na simulação 3**, **Envios reais 0 · não
  conectado** — sem número inventado do tipo 128/7/1). "Confirmar nova inscrição" casou **2 eventos**
  (Vigília de Oração com "1 inscrição ativa" e Congresso de Jovens 2026 com "2 inscrições ativas" — a
  pessoa na lista de espera do Congresso ficou de fora, como manda a regra), cada um com a mensagem que
  seria enviada e "Nada é enviado."; "Gerar link público do evento" casou os **mesmos 2 eventos**
  publicados+públicos com os links `http://localhost:5175/eventos/vigilia-de-oracao` e
  `.../congresso-de-jovens-2026` (o rascunho "Ação Social de Natal" ficou de fora). "Lembrete 24h" e
  "Avisar inscritos em cancelamento" mostraram "Nada dispararia agora…" — correto, com `now` em
  11/11/2026 os eventos são 14/11 e 20/11 (fora da janela de 24h) e não há evento cancelado. Os dois
  cartões laterais listam todos os canais como **Não conectado** com o que cada um exigiria. Console sem
  erros.
- **Interruptor funcional** — desligar "Confirmar nova inscrição" mudou o estado local e o dry-run na
  hora, sem recarregar: **Regras ativas 4→3**, **Disparariam agora 2→1**, **Mensagens na simulação
  3→0**, o cartão passou a mostrar "Desativada — não entra na simulação." e o switch a
  `aria-checked="false"`. É a prova de que o liga/desliga local alimenta a simulação de verdade. Console
  sem erros.

Como nos passos anteriores, o caminho Supabase real foi verificado em camadas — cliente simulado nos
unitários —, não ponta a ponta no provedor (e a Fase 7 nem toca o banco). A superfície visual do
navegador embutido segue indisponível para inspeção de layout fino (viewport), então a verificação é
pelo texto do DOM, pelos atributos dos interruptores e por navegação programada.

## SuperAdmin e relatórios reais (Fase 8)

A Fase 8 liga o painel do SuperAdmin ao que a RLS **já** devolve no ramo `is_superadmin()` —
**sem migração e sem política nova**. O escopo saiu de duas decisões: **"Real + honesto"** (as
leituras globais que o SuperAdmin pode fazer — eventos, usuários, campanhas e relatórios agregados
— passam a vir dos dados reais, com exportar CSV; o que era fingido foi zerado) e **"Manter,
honestas"** (Organizações, Suporte, Integrações e Monitoramento seguem no menu, mas mostram
"não conectado"/"não existe ainda", sem número nem status inventado).

### Duas camadas de defesa, como nas fases anteriores

Cada leitura global tem **dois** guardas, não um:

1. o **gate no serviço** — `adminService.fetchPlatformUsers` e `eventService.fetchAllEvents`
   devolvem `[]` para qualquer papel que não seja `superadmin`, **antes** de qualquer consulta
   (quem não é SuperAdmin não dispara `from(...)`);
2. a **política no banco** — `church_members_read`, `profiles_self_read`, `churches_public_read`
   (0002) e `events_church_read` (0011) têm o ramo `public.is_superadmin()`, que é o que devolve
   as linhas de todas as igrejas. É a segunda camada, nunca a única.

Os testes amarram as duas: o gate (com cliente Supabase simulado, provando que `from` não é
chamado para não-SuperAdmin) e a política (lendo o texto das migrações e confirmando o
`is_superadmin()` em cada uma).

### A projeção é o contrato do que chega ao navegador

A RLS é **por linha**: ela deixa o SuperAdmin ler a linha inteira de `church_members` e de
`profiles`. O que limita as **colunas** que vão ao navegador é o `select`. Por isso
`PLATFORM_USER_SELECT` está congelado:

```text
user_id, church_id, status, roles(key), churches(name), profiles(full_name, email)
```

`role_id`, `created_at`, `updated_at`, telefone e `avatar_url` ficam **de fora** — a tela de
gestão global precisa de nome, e-mail, papel, igreja e status, e nada mais. Um teste anti-deriva
compara a string exata e afirma que nenhuma coluna proibida aparece; outro confirma que toda
coluna projetada existe na tabela (0001) e que os três embeds resolvem por FK real.

### Relatórios agregados + CSV

`utils/reports.ts` é **puro** (não toca em DOM nem em banco): deriva das leituras globais as
contagens por seção — igrejas por aprovação, eventos por status, campanhas por status, usuários
por papel e inscrições por status — e gera o CSV no mesmo padrão da tela de Inscrições (células
entre aspas, separador `;`, CRLF; o BOM entra só no download). Toda chave do enum aparece, **mesmo
zerada** — o relatório não esconde ausência. Exportar PDF, receita, assinaturas e consumo de IA
ficam "não conectado" (exigem backend e provedores externos).

### O que é honesto em vez de fingido

- **Dashboard**: contagens globais reais (igrejas, pendentes, usuários distintos + vínculos,
  eventos + publicados, inscrições, campanhas). Removidos os números chutados (248 usuários,
  2 erros de integração, 1.2k de consumo de IA). O cartão Monitoramento lista 6 provedores,
  todos "Não conectado".
- **Usuários**: diretório global somente-leitura, com a nota de que **não existe bloqueio global
  de plataforma** (bloquear, reativar ou mudar o papel é no cadastro de cada igreja). Removidos
  os botões mortos (Activity/Ban/Reativar).
- **Integrações**: 5 provedores (OpenAI, Meta, TikTok, WhatsApp Business, Google Maps), cada um
  "Não conectado" + "Para conectar: {requisito}". Removidos status/chamadas/logs fingidos e o
  botão morto "Ver logs". *(No M3b o TikTok saiu também daqui: são **4** provedores listados.)*
- **Organizações** e **Suporte**: `EmptyState` honesto ("Redes de igrejas ainda não existem",
  "Suporte ainda não existe") — não há tabela, e agrupar igrejas ou abrir chamados exigiria
  migração nova. Removidos os arrays fake e os botões mortos.
- **Configurações**: Plataforma e LGPD somente-leitura (sem tabela de configurações). O cartão
  **Segurança** reflete o que o banco e o código aplicam de fato: RLS Ativado, MFA Obrigatório,
  `service_role` no frontend Bloqueado, Supabase conectado (real). "Alertas de tentativas
  suspeitas", que era "Ativo" fabricado, virou "Não conectado". Removidos o botão "Salvar" e o
  banner falso "salvas (demo)".

### Revisão de risco e prova por mutação

A revisão de risco escrita (diretório global de usuários + agregados cross-church) precedeu a
implementação: o risco central é **vazar dado entre igrejas** para quem não é SuperAdmin, e a
mitigação é o gate + a política + a projeção congelada, nesta ordem. Como exige a regra do
projeto, cada guarda foi provada por **mutação** (quebrar a guarda → o teste tem de falhar →
restaurar → `md5sum -c` confere):

| Mutação | Guarda quebrada | Testes que falharam |
|---------|-----------------|---------------------|
| M1 | gate `role !== 'superadmin'` do `adminService` (fetch + demo → no-op) | "ninguém além do SuperAdmin recebe o diretório global", "quem não é SuperAdmin não dispara consulta nenhuma" |
| M2 | `PLATFORM_USER_SELECT` + `role_id` | "é exatamente o combinado, sem coluna extra", "não vaza role_id, carimbos, telefone nem avatar" |
| M3 | gate `role !== 'superadmin'` do `eventService` (fetch + demo → no-op) | "ninguém além do SuperAdmin recebe a agenda global", "quem não é SuperAdmin não dispara consulta nenhuma" |
| M4 | agregação `status === k` → `events.length` | "conta cada seção pelo campo certo", "toda chave do enum aparece, mesmo zerada" |
| M5 | CSV `.join(';')` → `.join(',')` | "tem cabeçalho, separador ; e CRLF, sem BOM" |

Todas restauradas e conferidas por `md5sum -c`; suíte completa **412 testes** verde após o
restore. Build (`tsc -b && vite build`) e lint (0 erros, 3 avisos pré-existentes) limpos.

### Verificação no browser (SuperAdmin, modo demo)

Entrando como `admin@igrejaconecta.app` (superadmin, MFA — qualquer código de 6 dígitos no demo),
as sete páginas do painel foram verificadas pelo texto do DOM, com console sem erros:

- **/admin** — 4 igrejas (2 aprovadas), 2 pendentes, 5 usuários (5 vínculos), 4 eventos
  (2 publicados), 4 inscrições, 4 campanhas; aprovação com Monte Sião (Em análise) e Assembleia
  Esperança (Pendente); Monitoramento com 6 provedores "Não conectado".
- **/admin/usuarios** — os 5 vínculos com nome, e-mail, papel, igreja e status reais (inclusive
  Tiago Reis, da Comunidade Vida Nova — cross-church), nota "somente leitura".
- **/admin/relatorios** — agregação bate com os dados: igrejas (2 aprovadas/1 pendente/1 em
  análise), eventos (2 publicados/1 agendado/1 rascunho), campanhas (2 agendadas/2 rascunho),
  usuários por papel (2 admin/1 gerente/2 comunicador), inscrições (1 pendente/1 confirmada/1
  espera/1 check-in). Exportar CSV funcionou; Exportar PDF desabilitado com título honesto.
- **/admin/integracoes**, **/admin/organizacoes**, **/admin/suporte**, **/admin/configuracoes** —
  todas honestas ("Não conectado"/"não existe ainda"/somente-leitura), sem número nem botão morto.

Como a Fase 8 **não toca o banco** (só lê o que a RLS já devolve), a suíte de RLS não precisa
rerodar. O caminho Supabase real foi verificado em camadas — cliente simulado nos unitários —,
não ponta a ponta no provedor.

## SEO, PWA e preparação para publicação (Fase 9)

A Fase 9 deixa o app **pronto para publicar sem publicar nada**. Nenhum domínio foi comprado,
nenhum host foi configurado e nada foi ao ar; o que existe é o conjunto de arquivos e de código que
um host estático + um projeto Supabase real precisam para o app subir bem indexado e instalável.

### O que é crawler-visible e o que é por rota (limite honesto)

Num SPA puro há duas camadas de SEO e elas não são equivalentes — e o README não finge que são:

- **HTML inicial (`index.html` + `public/`)**: é o único lugar que scrapers de rede (Facebook,
  LinkedIn, X) e crawlers que não executam JS veem. Por isso `index.html` carrega, estáticos, o
  Open Graph site-level, o Twitter card, o canonical da home, o `theme-color`, o link do manifest e
  os JSON-LD `Organization` + `WebSite`.
- **Por rota (via `useDocumentMeta`)**: o Google executa JS, então title, canonical, robots, OG e o
  JSON-LD de Evento trocam corretamente a cada rota e valem para indexação e para o título da aba.
  Mas **não** alimentam o cartão de rede por página — isso exigiria prerender/SSR, que não existe
  aqui. OG por página fica documentado como limite, nunca apresentado como se funcionasse.

O `sitemap.xml` lista **só as rotas públicas fixas** (`SITEMAP_PATHS` em `utils/seo.ts`). As URLs
dinâmicas (`/eventos/:slug`, `/igrejas/:slug`) ficam de fora de propósito: listá-las exigiria um
gerador no build ou no servidor consultando o banco real, e inventar slugs seria fabricar URL.
`lastmod` é omitido em vez de chutado.

### Ícones e imagem de compartilhamento

`scripts/make-pwa-icons.ps1` redesenha a **geometria do `favicon.svg`** (retângulo navy `#15345B`
rx=14, cruz branca, ponto verde `#16A36A`) com System.Drawing (GDI+) — sem Python, sem ImageMagick,
sem redesign por IA — e gera `icon-192.png`, `icon-512.png`, `maskable-512.png` (conteúdo na zona
segura de 80%), `apple-touch-icon.png` (180) e `og-image.png` (1200×630, marca + nome + tagline).
O `manifest.webmanifest` só referencia esses arquivos; um teste anti-deriva falha se algum `src`
apontar para arquivo que não existe.

### Service worker

`public/sw.js` pré-cacheia o shell (index.html, manifest, ícones, og-image) no install; navegações
públicas são network-first com fallback ao shell em cache; assets estáticos same-origin são
cache-first com preenchimento em runtime (os nomes com hash do build entram no cache no primeiro
uso online). **Nunca** cacheia: respostas de terceiros/Supabase (early-return de cross-origin), e
as rotas privadas `/app` e `/admin` — offline, elas recebem um 503 honesto em vez do shell, porque
exigem sessão viva. O registro em `src/main.tsx` acontece **só em produção**
(`import.meta.env.PROD`), para não cachear código em mudança no dev.

### Revisão de risco e prova por mutação

A Fase 9 não mexe em auth nem em audiência de dados (não há migração nem política nova), então o
risco a provar é o de **deriva silenciosa**: um canonical errado, um `noindex` invertido, um
manifest apontando ícone inexistente ou um SW passando a cachear dado de provedor. Cada mutação
abaixo foi aplicada, o teste alvo falhou, e o arquivo foi restaurado com `md5sum -c` OK (suíte
427/427 verde ao final):

| # | Mutação | O que quebra |
|---|---------|--------------|
| M1 | `eventToJsonLd` com `if (true)` no lugar de `if (event.is_free)` | evento pago ganharia `offers` (preço inventado) |
| M2 | `resolveCanonical` sem remover barra final | canonical `/eventos/` errado |
| M3 | robots invertido (`noindex ? 'index, follow' : ...`) | página privada indexável |
| M4 | imagem OG padrão trocada por `/errado.png` | `absoluteImage()` e `og:image` |
| M5 | manifest com `src` `/icon-192-NAO-EXISTE.png` | anti-deriva: ícone do manifest não existe |
| M6 | SW sem o early-return de cross-origin | cachearia Supabase/terceiros |
| M7 | registro do SW sem `import.meta.env.PROD` | SW ativo no dev |

### Verificação no browser (build de produção, `npm run preview`)

- **Home**: title/canonical/robots/OG/Twitter/theme-color corretos; service worker **registrado**
  (1 registration, scope do preview); 2 JSON-LD estáticos; manifest, robots, sitemap, sw.js e os
  cinco PNGs respondem 200.
- **/eventos**: title `Eventos · IgrejaConecta`, canonical `.../eventos`, robots `index, follow`.
- **/eventos/vigilia-de-oracao**: 3 JSON-LD (o de Evento marcado `data-seo`); `Event` com
  `eventStatus: EventScheduled`, `offers.price: "0"` (é grátis), **sem `geo`** (o evento não tem
  coordenada — não é inventada) e `organizer` resolvido para a igreja real.
- **/login**: robots `noindex, nofollow`; o JSON-LD gerenciado some (0) e os 2 estáticos permanecem.
- **Cache Storage**: shell precacheado + assets/navegações preenchidos em runtime; `/app`, `/admin`
  e qualquer origem de terceiro **ausentes** do cache. Console limpo.

### Preparar sem publicar (o que falta para ir ao ar)

As escolhas já estão feitas: **backend = Supabase real antes de publicar** (o site só sobe com dados
reais, nunca mockados) e **host = Vercel (team data14)**. O `vercel.json` já está no repositório com
`buildCommand: npm run build`, `outputDirectory: dist` e a rewrite SPA (`/(.*) → /index.html`) — o
filesystem do Vercel serve os estáticos (`sw.js`, `manifest.webmanifest`, ícones) **antes** das
rewrites, então cada arquivo continua exato. **Está publicado** em
https://igrejaconecta.vercel.app (team data14) desde 2026-11-12; cada novo deploy só acontece após
você digitar **"publica"**.

O endereço canônico é o subdomínio do Vercel: `siteUrl` em `src/config/site.ts` usa esse default (não
há `VITE_SITE_URL` no `.env.local`), e `index.html`, `public/robots.txt` e `public/sitemap.xml`
carregam o mesmo endereço hardcoded. `tests/unit/seo.test.ts` amarra os quatro — se um divergir, a
suíte falha.

Ordem para ir ao ar (o passo 1 é seu — criar o projeto Supabase e colar as chaves):

1. Criar o projeto no [supabase.com](https://supabase.com), aplicar `supabase/migrations/*` (0001–0021),
   **rodar `supabase/seed.sql`** (obrigatório — sem ele toda escrita gateada por permissão falha com
   `42501`; ver [Seed obrigatório](#seed-obrigatório-papéis-permissões-e-matriz-rbac))
   e colar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (a **anon pública**) no `.env.local`. A
   `service_role` **nunca** vai ao frontend nem ao Vercel. Rode `npm run test:rls` contra o projeto
   real antes de qualquer deploy (ver seção de RLS). **Feito**: projeto `dlucvyjxidrfyjwuouvp`,
   migrações 0001–0014 aplicadas e seed aplicado em 2026-11-13 (11 permissões / 6 papéis / 33 pares).
   **0015..0021 ainda não foram aplicadas lá** — é o passo M7; sem elas as telas novas (ministérios,
   perfis de rede, favoritos, organizações, suporte, alertas) falham com `42P01` no ar. A 0020 tem
   ordem, e ela já está do lado certo: o app não oferece mais TikTok em campanha nem em perfil
   (passo M3b), então a migração sobe **no mesmo deploy** que tira a opção da tela — nunca antes, para
   uma linha já salva com a rede antiga não voltar a salvar, nunca depois, para a tela não oferecer o
   que o banco recusa.
2. `npm run build` gera `dist/` (estáticos já incluídos). Confira o build com `npm run preview`.
3. Se um dia existir domínio próprio, trocar o endereço nos quatro lugares acima (ou definir
   `VITE_SITE_URL` no build **e** trocar os três estáticos) — canonical, OG e sitemap precisam
   concordar com o endereço que responde.
4. As variáveis do Vercel são configuradas **por você**, pelo painel/CLI, nunca via agente (segredos
   não passam pelo agente). O deploy atual é **prebuilt**: o build roda aqui com o `.env.local`, e só
   o `.vercel/output` sobe — portanto não há variável de ambiente no projeto Vercel, e as chaves
   públicas ficam embutidas no bundle no momento do build local.
5. Publicar só após o seu "publica" — `vercel build --prod` + `vercel deploy --prebuilt --prod
   --scope data14`, com o portão de segurança no `.vercel/output` antes do envio.

## Onboarding de igreja pelo app (2026-11-12)

O cadastro de igreja já existia **no banco** desde a Fase 1 — `churches_insert` (0002) aceita o insert
de quem está logado e `trg_churches_creator_admin` (0006) anexa o criador como `church_admin` — mas
nenhuma tela chamava isso: entrar na plataforma dependia de SQL Editor. Agora existe
`/app/onboarding` (`src/pages/church/ChurchOnboardingPage.tsx` + `createChurch` em
`src/services/data/churchService.ts`), com entrada pelo painel quando a conta não tem igreja.

Fluxo real: a conta criada em `/cadastro` entra sem igreja → `/app` mostra o cartão "Sua conta ainda
não tem igreja" → `/app/onboarding` → o insert sai com `created_by` = id da sessão e
`approval_status = 'pending'` → o trigger 0006 anexa o criador como `church_admin` no mesmo statement
→ a tela avisa que nada funciona antes da aprovação do SuperAdmin e que é preciso recarregar a sessão
para o papel valer. O SuperAdmin aprova em `/admin/igrejas`, como sempre.

### Duas camadas, como nas outras escritas

| Camada | O que garante |
|--------|---------------|
| Banco (0002 + 0006) | `churches_insert` só aceita `created_by = auth.uid() and approval_status = 'pending'` — nem forjar o criador nem criar igreja já aprovada passa. O papel vem do trigger `SECURITY DEFINER`, que só conhece `church_admin` (o guarda da 0005 segue valendo para `superadmin`) |
| App (`createChurch`) | Nunca escolhe papel nem status: o insert é fixo nesses dois campos. Slug único com sufixos `-2`…`-10` em vez de falhar no `churches_slug_unique` (23505). Sem criador ou com nome < 3 caracteres, recusa antes de consultar. Erro 42501 volta como frase legível, não como stack |

A projeção devolvida (`CREATED_COLUMNS`) não inclui `created_by`, `email`, `website` nem coordenadas —
é o mínimo para a tela confirmar o que acabou de criar.

### Sessão defasada logo depois do cadastro

A sessão é uma foto do login; o vínculo novo só existe na leitura. Por isso os dois lugares que
decidem "tem igreja?" consultam a **lista de vínculos**, não só `session.churchId`:

- `/app/onboarding` recusa criar de novo se a conta já tem vínculo (evita igreja duplicada por um
  clique a mais) e, quando o vínculo é mais novo que a sessão, oferece **Recarregar sessão** em vez de
  um link que o guarda de permissão barraria;
- `/app` usa o vínculo como desempate para mostrar o nome e o status da igreja pendente.

O recálculo de papel e igreja a partir dos vínculos está no `loadSession` do `supabaseBackend` (era
também no `demoBackend.restore()`, até o passo M1 tirar o modo demo do aplicativo). Sem isso, quem
criava a igreja continuava "sem igreja" até sair e entrar de novo. SuperAdmin continua sem igreja.

### Testes e prova por mutação

`tests/unit/churchOnboarding.test.ts` (17 casos): recusas, espelho demo do insert + do trigger, slug em
colisão, candidatos esgotados, campos opcionais virando `null`, projeção, e anti-deriva lendo o fonte do
serviço e as migrações 0002/0006 (se alguém trocar `'pending'` por `'approved'` ou remover o
`created_by`, o teste falha).

Mutações aplicadas e revertidas — todas pegas:

| Mutação | Casos que falharam |
|---------|--------------------|
| `approval_status: 'pending'` → `'approved'` (demo e real) | 4, inclusive o anti-deriva do fonte |
| remover `created_by: creator.id` do insert real | 1 (anti-deriva) |
| vínculo demo como `superadmin`/`r1` em vez de `church_admin`/`r2` | 2 |
| `refresh()` do demo virando no-op | 1 (visitante não virava administrador) |
| tirar o ramo de SuperAdmin do `refresh()` | 1 (superadmin ganhava igreja) |

**Convenção que vale para qualquer teste novo:** o `.env.local` também é carregado no modo de teste,
então um arquivo que esquecesse de simular o client escreveria no banco que está no ar. Desde o M1 a
rede é global: `tests/setup.ts` registra um `vi.mock('@/services/supabase/client')` com um `Proxy` que
estoura no primeiro acesso (`TESTE-SEM-MOCK: acesso ao Supabase real bloqueado pela suíte`). O teste que
precisa do client registra o próprio `vi.mock` no topo do arquivo — o mock do arquivo tem precedência
sobre o global — e injeta o `from` por um objeto `vi.hoisted`:

```ts
const backend = vi.hoisted(() => ({ supabase: null as { from: typeof from } | null }))
vi.mock('@/services/supabase/client', () => backend)
beforeEach(() => { backend.supabase = { from } })
```

As escritas nos fixtures (`tests/fixtures/*Mirror.ts`) são chamadas sem `await`: a loja de teste é
síncrona, e um `await` ali só esconderia que nada foi consultado.

### Rodar sem tocar no banco que está no ar

Não há mais como: o modo demo foi apagado do aplicativo no M1. As duas chaves públicas são obrigatórias
no ambiente de build — sem elas o `client.ts` lança antes do `createClient` e o app não sobe. A
alternativa ao banco real são os fixtures (`tests/fixtures/`), que espelham as regras do serviço em
memória e só existem na suíte de testes; nenhuma página do aplicativo serve dados mockados, e a cerca em
`tests/unit/schemaSecurity.test.ts` falha se um ramo demo ressuscitar.

### Verificação no browser (2026-11-12, ainda em modo demo — registro anterior ao M1)

- `visitante@email.com` → `/app`: cartão "Sua conta ainda não tem igreja" + botão **Cadastrar igreja**;
- `/app/onboarding`: formulário com as 27 UFs, nome obrigatório (mín. 3) → envio → cartão verde
  "Igreja Batista Vale da Bênção · aguardando aprovação", com os três avisos (aprovação, recarregar
  sessão, MFA) e a nota de que no demo nada é gravado;
- voltando ao `/app` sem recarregar: "Painel de Igreja Batista Vale da Bênção · status pending",
  Membros 1, e o cartão de onboarding sumiu;
- `ana@ibcentral.org.br` (já tem igreja) → `/app/onboarding`: "Igreja Batista Central · Igreja
  aprovada…" com **Abrir dados da igreja**, sem formulário;
- `admin@igrejaconecta.app` (SuperAdmin, MFA) → `/app/onboarding`: "A sua conta é a direção da
  plataforma" com **Ir para aprovações**, sem formulário;
- console sem erro nem aviso.

## Dois bloqueios reais achados no ar (2026-11-13)

O fluxo completo foi testado em produção com uma segunda conta (`/cadastro` → onboarding → MFA →
aprovação do SuperAdmin → evento publicado → campanha). Dois bloqueios apareceram, os dois com
mensagem de RLS idêntica (`403 / 42501 "new row violates row-level security policy for table …"`) e
causas completamente diferentes.

### 1. Código: `return=representation` no insert de `churches`

`.insert(…).select(…)` no supabase-js manda o header `Prefer: return=representation`, que vira
`INSERT … RETURNING`. O PostgreSQL avalia o `RETURNING` **antes** dos triggers `AFTER ROW`, então a
linha nova é checada contra `churches_public_read` num instante em que `trg_churches_creator_admin`
(0006) ainda não criou o vínculo — e `current_church_ids()` ainda não inclui a igreja. Resultado:
`42501` mesmo com o insert correto e o `WITH CHECK` de `churches_insert` satisfeito.

`createChurch` agora insere **sem** representação e relê pelo slug em seguida, já com o vínculo
ativo. A distinção só é visível pelo header: `return=minimal` devolve `201`.

`events` **não** precisa disso — quem cria o evento já é membro da igreja, então a linha nova passa
em `events_church_read` no próprio `RETURNING`.

Testes: `tests/unit/churchOnboardingReal.test.ts` (5 casos no caminho real, com cliente falso).

### 2. Dados: seed nunca aplicado

Ver [Seed obrigatório](#seed-obrigatório-papéis-permissões-e-matriz-rbac). Este é o que custa mais
diagnóstico, porque o `42501` aponta para o código enquanto a causa é uma tabela vazia.

### O que foi confirmado no provedor, não por relato

| Etapa | Evidência |
|-------|-----------|
| Onboarding | `POST /rest/v1/churches` → `201`; igreja `40fd16b3-…` slug `igreja-piloto-teste-de-onboarding` |
| Papel do criador | vínculo `church_admin` / `active` criado pelo trigger 0006 |
| MFA | token com `aal: 2` e `amr: ["totp","password"]` |
| Aprovação | `approval_status: approved`; trilha `igreja.aprovada` com ator `4a2b1bee-…`, metadata `{de: pending, para: approved}` e o mesmo timestamp do update (trigger 0009) |
| Evento | `201` rascunho → `published`; `/eventos/<slug>` responde `200` para anônimo |
| Campanha | `201`, `status: draft`; `marketing_campaigns` para anônimo → `401` (RLS correta) |
| Inscrição de visitante | RPC anônima `POST /rest/v1/rpc/register_for_event` → `200 "confirmed"`, depois `200 "ja_inscrita"` (mesmo e-mail, nome diferente) e `200 "waitlist"` (2º e-mail com `capacity = 1`) |

`created_by` da campanha é `null` por decisão documentada em `0014_marketing_campaigns.sql:37` — a
coluna existe para trilha futura e o serviço não a projeta.

**A inscrição de visitante foi medida na página pública de produção, sem sessão no app** (localStorage
com zero chaves), com um evento fixture de `capacity = 1`. Os três estados acima saíram do corpo
da resposta, não do texto da tela. Na mesma rodada:

- a tela mostrava `Inscritos 0 / 1` antes e `2 / 1` depois — número da view
  `event_registration_stats`, que é agregado e não abre a tabela;
- o botão passou de "Confirmar inscrição" a "Entrar na lista de espera" porque `spots_left` virou `0`,
  medido pela view, não pelo estado local;
- nome de 1 letra foi barrado **sem nenhuma chamada de rede** — a validação de `dados_invalidos` é
  feita no cliente, antes da RPC;
- as duas linhas gravadas tinham `user_id` nulo (visitante sem conta), `church_id` igual ao do evento
  (derivado pelo trigger, não enviado pelo cliente), `checked_in_at` nulo e `ticket_code` no formato
  `FA5-AF7` / `CC7-B23` — o código **não** apareceu na página, como decidido em `0012`.

O fixture (`edfcf242-…`, slug `culto-de-teste-inscricao`) e as duas inscrições foram apagados depois;
`event_registrations` voltou a zero por cascata e a URL do evento passou a renderizar
"Evento não encontrado". Publicar o evento por SQL exigiu `set_config('request.jwt.claims', …)` com o
sub do SuperAdmin, porque o `enforce_event_publish` da `0011` também vale para o editor.

**Esses dados de teste não existem mais no banco.** Em 2026-11-13 a igreja `40fd16b3-…`, o evento, a
campanha, o vínculo e a conta de teste foram apagados (cascata + `delete from auth.users`). Sobraram a
igreja `9cb79cc7-…` (Administração IgrejaConecta), o SuperAdmin `4a2b1bee-…` e a trilha
`igreja.aprovada`, que ficou com `church_id` nulo porque a FK é `on delete set null` — a auditoria
nunca é apagada junto com a igreja. Quem procurar a igreja do piloto não vai encontrar; a evidência
acima é a tabela, não o banco.

## Check-in medido no ar e o painel de duas fontes (2026-11-13)

O check-in foi medido na tela `/app/checkin` em produção, **com sessão de igreja**. SuperAdmin não
serve para isso: `src/services/auth/supabaseBackend.ts:60-72` devolve
`churchId: role === 'superadmin' ? undefined : …`, então a tela fica vazia para quem é a direção da
plataforma. A sessão usada foi uma segunda conta com vínculo `manager` temporário (`manager` não está
em `MFA_REQUIRED_ROLES`, `src/utils/rbac.ts:51`, então entra só com senha), apagado no fim.

### Os cinco caminhos, com o corpo da resposta da RPC

| # | Digitado na tela | O que o provedor respondeu | O que a tela fez |
|---|---|---|---|
| 1 | `A8C-35E` (confirmada) | `POST /rest/v1/rpc/check_in_registration` → `200 "presente"` | "Check-in de … registrado.", badge **Presente**, linha nova no log do balcão |
| 2 | `a8c35e` (minúsculo, sem traço — como um scanner USB digita) | `200 "ja_presente"` | "Esta pessoa já estava registrada como presente." e **nenhuma** linha nova no log |
| 3 | `ZZZ-999` (inventado) | — | recusa local, com **zero chamadas de rede**: o código é resolvido na lista antes da RPC |
| 4 | `ACB-857` (lista de espera) | `200 "presente"` | virou **Presente** — o balcão promove a fila |
| 5 | `5E2-5BB`, cancelada por SQL **depois** de a tela carregar | `200 "cancelada"` | "Esta inscrição foi cancelada." A linha ainda aparecia como "Confirmada" e o servidor venceu |

O caminho 4 é uma **decisão em aberto**, não um bug: `check_in_registration` (`0012_event_registrations.sql:224`)
promove qualquer estado que não seja `cancelled`, então quem estava na fila entra sem ter consumido
vaga. Se a porta do balcão deve recusar `waitlist`, isso muda política e audiência do registro — pede
revisão de risco escrita e caso novo no grupo N antes de mexer.

### O defeito achado: o "Resumo" misturava duas fontes e recarregava só uma

| Número do painel | De onde vem |
|---|---|
| Inscritos, Check-in feito, Lista de espera | view `event_registration_stats`, pelo `useRegistrationStats` de `CheckInPage.tsx:20` |
| Presentes % | `presentCount / expectedCount` calculado da **lista** (`CheckInPage.tsx:34-36`), com a cancelada fora do denominador |

O `reload()` no fim de `handleCheck` refazia apenas a lista. Na tela, logo depois de um check-in:
`Check-in feito 0` ao lado de `Presentes 67%`, e `Lista de espera 1` com a pessoa já marcada como
presente. Sumia ao recarregar a página — mas no balcão ninguém recarrega a página entre uma pessoa e a
próxima, que é justamente o fluxo da tela.

**Conserto** (commit `59b28e7`, duas linhas): a tela desestrutura `reload: reloadStats` do hook
(`CheckInPage.tsx:20`) e chama os dois juntos (`CheckInPage.tsx:72-73`). Nenhum hook mudou:
`useRegistrationStats` já devolvia o `reload` vindo do `useKeyedList` (`useKeyedList.ts:36`,
exportado em `useKeyedList.ts:42`).

**Testes**: `tests/unit/registrations.test.ts:562`, dois casos lidos do fonte das telas e dos hooks —
o primeiro conta os `reload()` de `CheckInPage.tsx` e exige o mesmo número de pares
`reload()` + `reloadStats()`; o segundo amarra o `reloadStats` ao refetch real (o `setTick` do
`useKeyedList`) e não a um no-op, com sonda anti-deriva nas dependências do effect. Mutações
aplicadas e revertidas, cada uma derrubando exatamente um caso:

| Mutação | Casos que falharam |
|---|---|
| tirar o `reloadStats()` de `handleCheck` | 1 (o par deixa de existir) |
| `useRegistrationStats` devolver `{ byEvent }` sem o `...result` | 1 (o `reload` deixa de ser o refetch do hook) |

### Reverificação no ar, depois de publicar

Mesmo procedimento (vínculo temporário + evento fixture com `capacity = 2` + 1 `confirmed` + 1
`waitlist`), conferindo o painel **sem recarregar a página entre os passos**:

| Momento | O que o painel mostrou |
|---|---|
| ao abrir | `Inscritos 2 · Check-in feito 0 · Lista de espera 1 · Presentes 0%` |
| depois de `B7D-4KA` | `Check-in feito 1` **junto com** `Presentes 50%` |
| depois de `C2E-9HF` (era fila) | `Check-in feito 2 · Lista de espera 0 · Presentes 100%` |

Bundle servido na aba: `assets/index-rZHaPKHG.js`, o mesmo arquivo do build local que contém o fix —
a conferência não rodou em versão antiga. Console: zero mensagens. Apagado o vínculo temporário, a
mesma sessão voltou a cair em `403 /acesso-negado`, como antes de ele existir.

Ficava aberto, e o teste de pareamento não pegava de propósito: o botão **Tentar de novo** da tela de
erro repitava só a lista, porque `onClick={reload}` é referência, não chamada — numa recarga depois de
falha de rede o painel podia ficar uma batida atrasado. **Fechado (2026-11-13):** os dois caminhos que
mexem no painel agora saem de um `reloadAll()` só (`src/pages/church/CheckInPage.tsx:61`), e o caso
"não sobra recarga de lista sozinha, nem no 'Tentar de novo'" não deixa mais nenhum `onClick={reload}`
solto na tela. Duas mutações conferidas, cada uma revertida em seguida: botar o botão de volta em
`onClick={reload}` derruba esse caso novo; tirar `reloadStats()` de dentro do `reloadAll()` derruba ele
e o pareamento antigo. Não medido ao vivo de propósito: a tela de erro só aparece quando o `fetch` da
lista falha, e nem o modo demo nem o projeto real estavam em falha de rede — o mecanismo do `reloadStats`
(recarregar a view sem recarregar a página) é o mesmo que já foi medido no ar acima.

### Fixture no SQL Editor do projeto real (o procedimento)

Escrever dado de teste no editor do Supabase não é só colar o INSERT. Cinco coisas travam, todas com
saída conhecida:

| O que acontece | Por quê | O que fazer |
|---|---|---|
| `42501: publicar evento exige a permissão events.publish` | `enforce_event_publish` (`0011_events.sql:97`) chama `is_superadmin()` / `has_church_permission()`, que leem `auth.uid()`; no editor não há sessão | dentro de `begin; … commit;`, `select set_config('request.jwt.claim.sub', (select cm.user_id::text … papel superadmin … limit 1), true)` antes do insert. `auth.uid()` também aceita `request.jwt.claims` como JSON com `sub` — as duas formas funcionam. Com `is_local = true` o GUC volta sozinho no commit e não fica pendurado na conexão |
| modal "Potential issue detected — this query creates a table without enabling RLS" | a heurística do editor dispara em **INSERT puro** e em `create temp table`; é falso positivo, não há DDL nenhum | clicar **Run without RLS**. **Nunca** "Run and enable RLS": esse botão emite `ALTER TABLE … ROW LEVEL SECURITY` na tabela real do projeto |
| a grade volta vazia depois de gravar | o editor devolve só o conjunto do **último** statement, e `commit;` não tem conjunto | a transação grava; os ids se leem numa **consulta separada**, só de leitura |
| `delete` com contagem na mesma statement devolve `evento_apagado 1` ao lado de `eventos 1` | as CTEs de leitura da própria statement veem o snapshot do **início** dela | conferir o estado final por uma segunda consulta de leitura — a primeira resposta não é a prova |
| `create temp table x as insert … returning …` → `42601 syntax error at or near "insert"` | CTAS não aceita `INSERT … RETURNING` | usar `with … as (insert … returning …)`, que ainda amarra tudo numa transação só |

Já dentro da tabela, `event_registrations` ainda exige o `church_id` do evento no insert: o trigger
`enforce_registration_church` (`0012_event_registrations.sql:77`) responde `42501` se faltar ou
divergir — é o preço de escrever por fora da RPC, e é o mesmo guarda que a suíte mede em N12.

Regras de casa que valem para qualquer fixture aqui: **uma** transação (falhou = nada escrito);
consulta de estado **antes** e **depois**; limpeza com guardas por id **e** slug **e** papel **e**
e-mail, para não apagar linha parecida; e estado final conferido por leitura. O desta medição
terminou em `eventos 0 | inscrições 0 | vínculos 1 | contas 2 | auditoria 6`, roster só
`datavalehd@gmail.com / superadmin` — nada dos testes ficou no banco.

## Lista de espera no balcão: avisar e confirmar (2026-11-13)

A medição acima deixou a pergunta: `check_in_registration` promove ao ver qualquer estado diferente de
`cancelled` — inclusive `waitlist` — e não tem trava de nenhuma dentro da função. Na prática um Enter no
código de quem estava na fila já marcava presença, e a pessoa entrava sem que a vaga tivesse existido.
O caminho inverso (travar no banco) foi descartado: a RPC continuaria permissiva para os outros
consumidores e a régua de "quem pode furar a fila" é do balcão, não do SQL.

**Decidido: avisar e confirmar, na tela, nas duas telas que fazem check-in. Zero migração.**

| Caminho | Antes | Agora |
|---|---|---|
| `/app/checkin`, código digitado ou bipado | `Enter` → RPC, e a fila promovia em silêncio | o código é reconhecido, a tela mostra o nome, diz que não havia vaga garantida e quantos lugares já foram marcados; nada é gravado até **Confirmar admissão de \<nome\>** |
| `/app/inscricoes`, botão da linha | um clique → RPC | o primeiro clique arma o aviso âmbar; gravar exige o botão de confirmar |
| `pending`, `confirmed`, `checked_in`, `cancelled` | RPC | RPC direto — a tela não trava quem tinha vaga, e o cancelado/já-presente continuam respondidos pelo banco |

As peças:

- `src/utils/checkInPolicy.ts` — `waitlistAdmission(reg, stats)` é o único lugar que sabe o que é fila e
  como se fala disso. Sem `stats` o aviso sai sem números; ele nunca chuta lotação.
- `CheckInPage.tsx` — separou a decisão da escrita: `handleCheck` (linha 85 faz o gate) escolhe,
  `commit` (58) grava. Enquanto o aviso está na tela o `Enter` é ignorado e "Registrar" fica desabilitado,
  então um scanner que manda o código duas vezes não se confirma sozinho. Digitar qualquer coisa no campo
  derruba o aviso pendente.
- `RegistrationsPage.tsx` — `run` (linha 68) passa pelo mesmo gate antes de chamar `commit` (53).

Revisão de risco — é política de escrita, não de audiência; nenhum dado novo é lido:

| Risco | Como fica |
|---|---|
| alguém confirmar sem ler | o botão repete o nome da pessoa e o aviso diz a consequência ("marca a presença e tira a pessoa da fila"); é um clique a mais, dado por quem já tem `registrations.manage` |
| a tela virar a única guarda do país das vagas | é a escolha feita, e por isso o caminho novo de check-in tem de obedecer ao `waitlistAdmission` — os testes amarram as duas telas existentes e a ausência de trava no SQL |
| travar quem tem vaga | impossível por estado: só `waitlist` arma o aviso |
| dado pessoal no aviso | o nome já está na lista, na mesma tela, para o mesmo papel |

Prova por mutação — quebrar o gate e ver o teste cair, cada mutação revertida em seguida:

| Mutação | Teste que caiu |
|---|---|
| `if (gate.needsConfirmation)` neutralizado na tela de check-in | "a tela de check-in chama a RPC só depois do clique de confirmar" |
| `return` do gate apagado dentro de `run` na lista de inscrições | "a lista de inscrições freia do mesmo jeito" |
| `status !== 'waitlist'` invertido na função pura | "só a fila precisa de confirmação" e "o aviso diz quem é a pessoa e não inventa lotação" |

Medido no browser em **modo demo** — `.env.demo.local` com `VITE_SUPABASE_URL`/`_ANON_KEY` vazios,
`npx vite --mode demo --port 5199`, arquivo apagado depois. Nenhuma escrita no projeto real, e nenhum
fixture novo: logado como `ana@ibcentral.org.br` (gerente), o botão de check-in da linha
**Beatriz Lopes** (`waitlist`) abriu o aviso *"Beatriz Lopes está na lista de espera: não tinha vaga
garantida quando se inscreveu. Confirmar a admissão marca a presença e tira a pessoa da fila."* com
**Confirmar admissão de Beatriz Lopes** / **Deixar na fila**. "Deixar na fila" fechou o bloco e a linha
continuou **Lista de espera**; rearmado, o clique em confirmar passou a linha para **Check-in feito**.
Console limpo. O `/app/checkin` não foi medido ao vivo aqui porque as inscrições mockadas não têm
`ticket_code` nenhum — a tela de código está coberta pelos testes de fonte acima.

## Rodada M — o banco que faltava (0015..0021) e as telas sem mock

### M2 — o que não existia passa a existir (0015..0020)

Nenhuma tela mudou neste passo: ele só deu origem real ao que cinco telas ainda inventavam, para o M3
ler do banco sem inventar regra no frontend.

| Migração | O que cria | Audiência |
|---|---|---|
| 0015 | `ministries`, `ministry_members`, `church_social_accounts` + a view `ministry_list` | lê membro ativo (ou SuperAdmin); escreve `members.manage` em ministério e `church.manage` em perfil de rede. **Nenhuma permissão nova** — o `seed.sql` já aplicado no projeto real continua valendo |
| 0016 | `visitor_favorites`, `visitor_preferences` | `user_id = auth.uid()` em toda operação, `WITH CHECK` incluso; `anon` sem grant nenhum — sem conta, sem favorito |
| 0017 | `church_networks`, `church_network_churches` + view `church_network_list` | escrita só do SuperAdmin; o membro vê apenas as redes das próprias igrejas, pelo `current_network_ids()` (`security definer`, para a política não ler a tabela de associação sob RLS) |
| 0018 | `support_tickets`, `support_messages` + view `support_ticket_list` | quem abriu, quem **gerencia** a igreja assunto e SuperAdmin — as três regras numa função só (`can_read_ticket`) porque `support_messages` não pode consultar `support_tickets` dentro da própria política. Sem delete: suporte é trilha |
| 0019 | `security_events` + RPC `log_security_event` + views de resumo | ninguém escreve pela API, nem SuperAdmin: `revoke all` e o insert só acontece dentro da função `security definer`, que grava `actor_id = auth.uid()` e aceita dois tipos (`permission_denied`, `publish_denied`). Tabela separada de `audit_logs` de propósito — uma RPC que ligasse a marca da 0010 reabriria o buraco que a 0010 fechou |
| 0020 | troca do CHECK de `marketing_campaigns.networks` | TikTok fora das redes de campanha; nenhuma linha é reescrita e a 0015 já não aceitava `tiktok` no CHECK de `church_social_accounts` — as duas superfícies concordam |

A 0015 também é onde `connected` deixa de ser campo editável: o trigger `enforce_social_connection`
recusa com `42501` qualquer `authenticated` que marque a conta como conectada (inclusive nascendo
conectada), pelo mesmo motivo do `enforce_campaign_publish` (0014). A tela grava o @handle — que o
administrador sabe — e o selo continua "não conectado" enquanto nenhum provedor confirmar.

**Delete de ministério existe**, ao contrário de campanha e filial: desfazer um ministério montado por
engano é operação normal, e `ministry_members` cai por cascata.

Suíte SQL: **grupos Q..U** (ministérios e perfis de rede social, favoritos, redes de igrejas, suporte,
eventos de segurança); a 0020 é provada no P9 e nos CHECKs de Q8/R5.

### M3a-0 — 0021: líder e participante de ministério têm de ser da igreja

**Revisão de risco.** A 0015 amarrava `ministries.leader_id` e `ministry_members.user_id` em `profiles`
sem conferir **de que igreja** é a pessoa. Falta de coerência seria ruim; aqui é de audiência:

| # | Risco | O que a guarda faz |
|---|---|---|
| 1 | `ministry_list` é `security_invoker = false` (mesma razão do `church_roster`), então o `left join profiles l` que forma `leader_name` **não passa pela RLS de `profiles`** — que pela 0002 só deixa cada um ler a si mesmo | a guarda fecha a **escrita**, não a leitura: `leader_id` passa a ser obrigatoriamente membro **ativo** da igreja do ministério — exatamente o conjunto que a própria view já mostraria àquela igreja. Nada é ampliado |
| 2 | Quem tem `members.manage` podia gravar qualquer uuid em `leader_id` e receber o `full_name` daquela pessoa na tela: oráculo "uuid → nome" sobre outras igrejas e sobre qualquer conta da plataforma | `enforce_ministry_leader()`, `BEFORE INSERT OR UPDATE OF church_id, leader_id`, recusa com `42501`; uuid que nem é perfil responde `23503` |
| 3 | O mesmo oráculo pelo caminho de participante — dar de fora como inscrito no ministério | `enforce_ministry_member()`, `BEFORE INSERT`, com as duas mensagens e a mesma régua de vínculo ativo (a tabela não tem update, então não há `UPDATE OF` aqui) |
| 4 | A guarda virar bloqueio geral: recusar tudo é tão inútil quanto recusar nada | Q9b escreve líder e participante **corretos** e exige que entrem — sonda anti-no-op |
| 5 | Perder a proteção por deriva estrutural (trigger trocado, `search_path` solto, grant recuperado) | Q9c lê `pg_trigger`/`pg_proc`: os dois existem, são `BEFORE` de linha, o do líder vigia `church_id,leader_id`, o do participante é só `INSERT`; as duas funções são `DEFINER` com `search_path` fixo e sem `EXECUTE` para `anon`/`authenticated` |

O padrão é o da casa (`enforce_event_branch`, 0013): `plpgsql` + `security definer` +
`set search_path = public` + `raise exception ... using errcode = '42501'` + `revoke execute`.

**Prova por mutação** — cada mutação aplicada na 0021, a suíte inteira rodando, arquivo restaurado no
`finally`. 10 de 10 pegues; na coluna, a mensagem que o Postgres estourou:

| Mutação | Pegou em |
|---|---|
| M1 — líder deixa passar quem não é da igreja | `Q9: leader de outra igreja aceito no update` |
| M2 — líder confere a igreja da sessão, não a do ministério | `Q9: leader de outra igreja aceito no update` |
| M3 — líder aceita vínculo `invited` | `Q9: leader invited aceito na propria igreja` |
| M4 — participante deixa passar quem não é da igreja | `Q9: participante de outra igreja aceito` |
| M5 — participante confere a igreja errada | `Q9: participante de outra igreja aceito` |
| M6 — participante aceita vínculo `invited` | `Q9: participante invited aceito no ministerio da A` |
| M7 — trigger do líder passa a vigiar só `leader_id` | `Q9c: o trigger de lider vigia leader_id — esperava church_id,leader_id` |
| M8 — trigger do participante removido | `Q9: participante de outra igreja aceito` |
| M9 — `revoke execute` das duas funções removido | `Q9c: anon/authenticated recuperou EXECUTE nas funcoes da 0021` |
| M10 — função do líder sem `set search_path` | `E3: funcao SECURITY DEFINER sem search_path fixo: enforce_ministry_leader` |

M10 não é pega pelo grupo Q — quem derruba é o **varredor estrutural E3** (função `SECURITY DEFINER`
sem `search_path` fixo, em qualquer migração), que é justamente o objetivo da cerca global.

Os casos `invited` (M3/M6) existem porque a convidada A tem papel de `manager` na igreja A: conferir só
a **existência** do vínculo deixaria passar quem ainda não aceitou o convite — a mesma régua do caso O3
de filiais.

### M3a — ministérios lendo e escrevendo o banco

`/app/ministerios` saiu de `@/data/mock`. As peças:

- [src/services/data/ministryService.ts](src/services/data/ministryService.ts) — `MINISTRY_COLUMNS` é a
  projeção da view `ministry_list`, comparada coluna a coluna com o texto da própria view em
  `tests/unit/ministries.test.ts` (contrato estrutural, não número). Leituras: `fetchMinistries`
  (membro com `.eq('church_id')`, SuperAdmin sem recorte, sem igreja na sessão **não sai consulta**) e
  `fetchMinistryMembers`. Escritas: `createMinistry` / `updateMinistry` / `deleteMinistry` /
  `addMinistryMember` / `removeMinistryMember`, todas gateadas por `can(role, 'members.manage')`
  **antes** de consultar — primeira camada; as políticas `ministries_write`/`_update`/`_delete` são a
  segunda.
- Escrita devolve o que o banco confirmou: `insert`/`update` na tabela + `.select('id').maybeSingle()`
  e **releitura pela view**, porque `leader_name` e `members_count` não existem na tabela — é o mesmo
  formato do conserto do insert de igreja (2026-11-13). Linha que não volta é "não encontrado ou sem
  permissão", nunca sucesso fingido: sem oráculo de existência.
- Erro do banco vira texto legível: `42501` → sem permissão; `23503` → "a pessoa indicada não é uma
  conta desta plataforma" (é o que a 0021 responde quando o uuid nem é perfil); `23514` → nome/tipo
  fora do permitido; `23505` em participante → "essa pessoa já participa do ministério".
- [src/hooks/useMinistries.ts](src/hooks/useMinistries.ts) e a tela: formulário oferece como líder
  **só gente do roster ativo** da igreja (a 0021 recusaria uuid digitado), a equipe do ministério é
  `ministry_members` real, e apagar pede confirmação armada na linha.
- [tests/fixtures/ministryMirror.ts](tests/fixtures/ministryMirror.ts) — o espelho que era demo:
  `project()` deriva `leader_name` de `profiles` e `members_count` de `ministry_members` (a contagem
  nunca é campo digitado), `guardPerson()` reproduz a 0021 na ordem das mensagens (referência antes de
  audiência) e `canReach()` a política de leitura. Os líderes do mock (`m1..m5`) foram ajustados para
  vínculos **ativos** da própria igreja: se o fixture espelha a 0021, líder `invited` no mock derrubaria
  o próprio espelho.

Medido: **512 testes unitários** (39 de ministérios), `tsc -b` limpo, lint sem erros, build de produção
ok, suíte de RLS **1035 declarações, grupos A–U, PASSOU**. O bundle não carrega mais os ministérios
fictícios — sobrou só o placeholder "Ex.: Ministério de Louvor" do formulário. A cerca de allowlist em
`tests/unit/schemaSecurity.test.ts` encolheu de 4 para 3 páginas e foi mutacionada: devolver uma tela ao
mock quebra o teste.

**Limites desta entrega.** As migrações 0015..0021 **ainda não foram aplicadas** no projeto real
(`dlucvyjxidrfyjwuouvp`) — enquanto isso, `/app/ministerios` no ar cai na mensagem de falha de leitura
da tela (o banco responde `42P01`), e a tela nova não foi medida no browser: nada foi escrito no banco
que está no ar. Aplicar 0015..0021 + rodar a suíte no projeto real é o passo M7.

### M3b — perfis de rede escrevendo o banco, e o TikTok fora

`/app/redes` saiu de `@/data/mock` e passou a ler/escrever `church_social_accounts` (0015). As peças:

- [src/services/data/socialAccountService.ts](src/services/data/socialAccountService.ts) —
  `SOCIAL_COLUMNS` é a projeção da tabela, comparada coluna a coluna com o texto da migração;
  `SOCIAL_INSERT_COLUMNS = ['church_id','network','handle']` é o recorte do insert. Leituras:
  `fetchSocialAccounts` (membro com `.eq('church_id')`, SuperAdmin sem recorte, sem igreja na sessão
  **não sai consulta**). Escritas: `createSocialAccount` / `updateSocialHandle` / `deleteSocialAccount`,
  todas gateadas por `can(role, 'church.manage')` **antes** de consultar.
- [src/hooks/useSocialAccounts.ts](src/hooks/useSocialAccounts.ts) e a tela reescrita: uma linha por
  rede (Instagram, Facebook, WhatsApp, YouTube), @handle editável no lugar, apagar com confirmação
  armada, e o selo "Conectada" que **só aparece** se o banco devolver `connected = true`.
- [tests/fixtures/socialMirror.ts](tests/fixtures/socialMirror.ts) — o espelho que era demo: vínculo
  ativo (`current_church_ids`, convidada não lê), índice único `(church_id, network, lower(handle))`
  respondendo `23505`, `canReach()` para a linha fora do alcance e `demoSetSocialConnected` /
  `demoInsertConnected` reproduzindo o trigger nos dois sentidos.
- TikTok varrido do aplicativo: `SOCIAL_NETWORKS` nunca o teve (o CHECK da 0015 já não aceitava) e
  `CAMPAIGN_NETWORKS` perdeu a opção (0020 troca o CHECK de `marketing_campaigns.networks`). Saiu
  também do formulário de campanha, do perfil da igreja, das telas de Integrações/Monitoramento/Logs do
  SuperAdmin e da promessa comercial da home.

**Revisão de risco.** Mexer nesta tela mexe em quem escreve a identidade pública da igreja:

| # | Risco | O que fecha isso |
|---|---|---|
| 1 | A tela poder **fingir conexão** — um `connected: true` no payload (ou num default de insert) faria o app afirmar ao administrador que o perfil está ligado ao provedor, que é exatamente o que a 0015 proíbe | o payload é literal: insert só manda `church_id/network/handle`, update só manda `handle`. `SOCIAL_INSERT_COLUMNS` não lista a coluna, `tests/unit/socialAccounts.test.ts` compara **as chaves exatas** do que saiu, e o trigger `enforce_social_connection` (42501, inclusive para linha nascendo conectada) é a 2ª camada para qualquer escrevente — inclusive este app |
| 2 | Quem **entra** na rota não é quem **escreve**: `/app/redes` é guardada por `marketing.manage` (superadmin, church_admin, gerente, comunicador), mas a escrita da 0015 é `church.manage` (superadmin e church_admin) | o gate é `can(role,'church.manage')`, antes de consultar; gerente e comunicador veem a tela em **modo leitura-ativada** com o motivo na tela, sem botão de gravar. O teste afirma os dois `can(...)` para a fronteira não derivar sozinha |
| 3 | Unificar as redes em um tipo só — o caminho óbvio, e o que gerou o defeito que estamos tirando | são **dois conjuntos porque o banco tem dois CHECKs**: perfil = 4 redes com `youtube` (0015), campanha = 3 sem `tiktok` (0014+0020). Cada lista é comparada ao texto do CHECK correspondente, e um teste separado afirma que `tiktok` não está em nenhum e `youtube` só no perfil |
| 4 | Vazar @handle de outra igreja, ou servir de **oráculo de existência** ("essa linha não existe" vs "você não pode") | leitura sempre com `.eq('church_id')` (sem recorte só SuperAdmin), escrita por id com a linha relida pelo mesmo recorte, e uma mensagem só — `SOCIAL_NOT_FOUND` — tanto para linha inexistente quanto para linha fora do alcance, no serviço real e no espelho |

**Prova por mutação** — 10 de 10 mortas (arquivo corrompido, suíte rodando, restaurado no `finally`;
nenhum `git checkout`, porque havia trabalho não commitado na faixa):

| Mutação | Pegou em |
|---|---|
| M1 — `connected` de volta no payload do insert | `nem o insert nem o update levam a coluna em nenhum payload` + `a criação manda o recorte da sessão e devolve a linha confirmada` |
| M2 — `connected` de volta no payload do update | as mesmas duas |
| M3 — gate `church.manage` removido do serviço | `quem entra na rota mas não gerencia a igreja não escreve, e nenhuma consulta sai` + `a porta vem antes da validação: papel errado recebe a mensagem de permissão` |
| M4 — `.eq('church_id')` a menos na leitura | `membro pede a tabela, a projeção, a ordem e o recorte por igreja` |
| M5 — espelho deixando o app marcar como conectada | `o espelho recusa conectar e desconectar pelo app, e aceita pelo backend` |
| M6 — `tiktok` de volta em `CAMPAIGN_NETWORKS` | marketing `recusa rede fora do conjunto suportado` + `CAMPAIGN_NETWORKS é exatamente o CHECK recriado pela 0020` + `tiktok saiu do app inteiro...` |
| M7 — `tiktok` de volta em `SOCIAL_NETWORKS` | `SOCIAL_NETWORKS é exatamente o CHECK de church_social_accounts.network` + `rede fora do CHECK do banco é recusada antes de consultar` |
| M8 — `canReach()` do espelho sempre `true` | `perfil da igreja vizinha dá a mesma mensagem de não-existente` |
| M9 — `church_id` enviado no patch de edição | `nem o insert nem o update levam a coluna em nenhum payload` + `a edição só manda o handle e aponta para a linha pelo id` |
| M10 — `/app/redes` voltando a importar `@/data/mock` | `as únicas páginas que ainda leem a loja de mocks são as que faltam no M3` |

M10 é a cerca estrutural de `tests/unit/schemaSecurity.test.ts`: a allowlist encolheu de **3 para 2**
páginas e continua sendo uma lista que só diminui.

Medido: **548 testes unitários** em 22 arquivos (36 de perfis de rede), `tsc -b` limpo, lint sem erros,
build de produção ok e o bundle **sem** `TikTok`, sem a string `tiktok` e sem o ícone da rede. A suíte de
RLS local rodou com a 0020 aplicada: **1035 declarações, grupos A–U, PASSOU** (a 0020 entra como 2
declarações; P9 e os CHECKs de Q8/R5 provam o novo conjunto de redes).

**Limites desta entrega.** Vale o mesmo do M3a: as 0015..0021 ainda não estão no projeto real, então
no ar `/app/redes` cai na mensagem de falha de leitura (`42P01`) — a tela nova não foi medida no browser
e nada foi escrito no banco que está no ar. A 0020 sobe **junto** deste deploy (M7), para a tela nunca
oferecer uma rede que o banco recusa. E o @handle continua sendo o que o administrador digitou: "o que
cada rede realmente é" só passa a ter valor quando um backend com OAuth confirmar (M5/integrações).

### M3c — cadastro institucional e perfil pessoal salvando de verdade

`/app/igreja` e `/app/perfil` saíram de `@/data/mock`. **Nenhuma migração nova**: as tabelas
(`churches`/`profiles`, 0001), as políticas de escrita (`churches_update` e `profiles_self_update`, 0002)
e a guarda de `approval_status` (0004) já existiam — o que faltava era o aplicativo usá-las. As peças:

- [src/services/data/churchProfileService.ts](src/services/data/churchProfileService.ts) — três listas
  que se costuram sozinhas: `CHURCH_PROFILE_COLUMNS` (18, o que a tela lê), `CHURCH_EDITABLE_COLUMNS`
  (13, o que o formulário pode mandar) e `CHURCH_LOCKED_COLUMNS` (`id`, `slug`, `status`,
  `approval_status`, `created_by`, `created_at`, `updated_at`). `fetchChurchProfile` com `.eq('id')`;
  `updateChurchProfile(draft, actor)` gateado por `can(role, 'church.manage')` **antes** de consultar;
  `buildChurchPatch` literal coluna por coluna (nunca `...draft`); `parseCoordinate` aceitando vírgula
  brasileira; texto em branco virando `null`, para "limpar" funcionar de verdade.
- [src/services/data/myProfileService.ts](src/services/data/myProfileService.ts) —
  `MY_PROFILE_EDITABLE_COLUMNS = ['full_name','phone']`; `email`, `id` e `avatar_url` estão na lista de
  travadas, e o update vai por `.eq('id', actor.userId)`. Aqui **não há exceção de SuperAdmin**: a
  política é só a própria conta, e o espelho/`it.each` não deixam inventar uma.
- [src/hooks/useChurchProfile.ts](src/hooks/useChurchProfile.ts) e as duas telas reescritas:
  [src/pages/church/ChurchProfilePage.tsx](src/pages/church/ChurchProfilePage.tsx) em três cards
  (básicas / contato / endereço+coordenadas), com "Nada para salvar: os campos estão iguais ao que o
  banco tem.", barra Salvar/Descartar, card "Situação" **somente leitura** (aprovação, status e `slug`
  são do SuperAdmin) e link para `/app/redes`;
  [src/pages/church/UserProfilePage.tsx](src/pages/church/UserProfilePage.tsx) gravando nome e telefone,
  e-mail de login `readOnly` com o motivo, troca de senha real pelo `AuthContext`, MFA intacto e os três
  botões sem backend (sessões ativas, exportar, excluir) desabilitados **com o que faltaria** no título.
- O que saiu da tela: o CNPJ inventado, o "Responsável: Pr. Marcos Lima" e os campos mortos de
  Instagram/Facebook/YouTube — rede social tem tabela (`church_social_accounts`, 0015) e se edita em
  `/app/redes`; campo que não grava em lugar nenhum é o que não se mostra. O botão de upload de capa que
  não enviava arquivo algum também saiu.
- [src/utils/ufs.ts](src/utils/ufs.ts) (`UF_LIST`) virou a única fonte do seletor de estado, agora
  usado pela tela de igreja e pelo onboarding; e `AuthContext.refresh()` relê a sessão depois de gravar
  em `profiles`, porque `onAuthStateChange` **não** dispara em update de coluna — sem isto o nome novo
  só aparecia depois de sair e voltar.

**Revisão de risco.** Mexer aqui é mexer na identidade pública da igreja e no que uma pessoa afirma ser.

| # | Risco | O que fecha isso |
|---|---|---|
| 1 | A tela afirmar algo que o banco não gravou — um `...draft` no update, ou um "salvo" quando o `update` não devolve linha | patch literal e `.update(patch).eq(...).select(COLUMNS).maybeSingle()`: linha que não volta é `*_NOT_FOUND`, nunca sucesso. `tests/unit/profiles.test.ts` compara **as chaves exatas** do patch com a lista e afirma que nenhuma coluna travada entra, nem com valor válido |
| 2 | `slug`, `status` e `approval_status` — endereço público, ativação e aprovação — mudarem pelas mãos de um `church_admin` | **a RLS é por linha, não por coluna**: `churches_update` (0002) deixa qualquer coluna para quem tem `church.manage`. `approval_status` tem guarda no banco (0004, `42501`, conferida no texto da migração); `slug` e `status` **não têm** — a fronteira deles é o patch do app mais as três listas, e C18 confere que o update da tela não os mudou. Guarda de coluna no banco = migration 0022, **não feita** (veja Limites) |
| 3 | O perfil pessoal virar porta para trocar o e-mail de login, que é a identidade da conta no Auth | `email` está fora das editáveis, fora do patch, e na tela é `readOnly` com a frase de que trocar o login exige confirmar a posse do novo endereço — é fluxo próprio, não campo de formulário |
| 4 | Escrita cruzada: um `church_admin` editar a igreja vizinha, ou alguém editar o perfil de outra pessoa | leitura e escrita sempre com `.eq('id', ...)` vindo da sessão, `can(...)` antes de consultar, e **nenhuma exceção** no perfil pessoal — medido em SQL por C17/C19, com as sondas S1/S2 provando que as políticas afrouxadas derrubam os casos |

**Prova por mutação** — 12 de 12 mortas (`tools/mutate-profiles.cjs`: arquivo corrompido, suíte rodando,
restaurado no `finally`; nenhum `git checkout`, porque havia trabalho não commitado na faixa):

| Mutação | Pegou em |
|---|---|
| M1 — `slug: 'invasao'` de volta no patch da igreja | `nenhuma coluna travada entra no payload, nem com valor válido` |
| M2 — `status` listado como editável | `as chaves do patch são exatamente as colunas editáveis, na ordem da lista` + `editáveis + travadas cobrem a tabela inteira, menos as duas de arquivo` |
| M3 — gate `church.manage` removido do serviço | `quem não gerencia a igreja recebe a recusa, e nada sai pela rede` + `a recusa de papel vem antes da validação: papel errado não recebe "nome curto"` |
| M4 — `.eq('id', churchId)` a menos na escrita | `a escrita manda o patch pelo id da própria igreja e devolve a linha confirmada` |
| M5 — guarda de "sessão sem igreja" removida | `SuperAdmin tem a porta, mas sem igreja ativa não escreve` |
| M6 — `blankToNull` devolvendo o texto cru | `campo de texto em branco vira null: limpar funciona` |
| M7 — erro de leitura virando `null` (tela vazia em vez de falha) | `erro na leitura não recorre a cadastro fictício` |
| M8 — `42501` deixando vazar a mensagem do banco | `erro do banco — policy recusando — vira mensagem legível` |
| M9 — `logo_url` de volta na projeção | `a tela não oferece logo nem capa: as duas também não estão na projeção` |
| M10 — `email` no patch do perfil pessoal | `e-mail, id e avatar nunca saem do app` |
| M11 — `.eq('id', actor.userId)` a menos no perfil pessoal | `pede a tabela profiles, o recorte pelo próprio id e devolve a linha confirmada` |
| M12 — validação de nome removida | `nome vazio é recusado antes de consultar: é assim que a pessoa aparece` |

Sondas no banco (`tools/mutate-rls-profiles.cjs`, `0002` restaurada no `finally`): acrescentar
`or public.is_superadmin()` em `profiles_self_update` derruba **C19**, e trocar `church.manage` por
`events.manage` — que o gerente **tem** — em `churches_update` derruba **C17**. As duas morreram dizendo
o número. Os casos novos: **C17** (o gerente da igreja lê o cadastro e não altera nome, descrição nem
endereço), **C18** (o caminho legítimo: church_admin grava as 13 colunas da tela, elas chegam ao banco, e
`slug`/`status`/`approval_status` não se movem — anti-no-op, porque uma política que aceitasse update
genérico não passaria por aqui) e **C19** (SuperAdmin edita o próprio perfil, não o do colega).

Medido: **585 testes unitários** em 23 arquivos (37 de perfis), `tsc -b` limpo, lint sem erros, build de
produção ok. A suíte de RLS recontada: **1052 declarações, grupos A–U, PASSOU** (+17 no grupo C). A cerca
de allowlist em `tests/unit/schemaSecurity.test.ts` encolheu de **2 para 1** página e continua sendo uma
lista que só diminui — sobrou `src/pages/public/VisitorProfilePage.tsx` (M3d).

**Limites desta entrega.** Como em M3a/M3b, nada foi escrito no banco que está no ar: conferir a gravação
no browser exigiria criar conta e igreja reais no projeto de produção (`dlucvyjxidrfyjwuouvp`), e os dados
do piloto foram apagados — com as 0015..0021 ainda pendentes (M7), `/app/ministerios` e `/app/redes`
seguem em `42P01` no ar. **Não existe guarda de coluna no banco para `slug` e `status`**: um `church_admin`
chamando a API direta trocaria o endereço público da igreja ou a desativaria. Fechar isso é uma migração
nova (0022, `BEFORE UPDATE` comparando as duas colunas, mesma técnica da 0004) — **não feita aqui**,
porque apertar política de escrita de `churches` é mudança de audiência de dados e pede a sua autorização
antes. `logo_url`/`cover_url` ficaram fora da projeção e do patch: nenhuma tela renderiza a imagem hoje e
mandar campo vazio apagaria o valor que existe — voltam no M4 com o upload real no Storage.

### M3d — favoritos, preferências e histórico do visitante salvando de verdade

`/visitante/perfil` e o coração da página de evento saíram de `@/data/mock` — e com isso **nenhuma tela do
aplicativo lê a loja de mocks**. **Nenhuma migração nova**: a 0016 (`visitor_favorites` +
`visitor_preferences`) foi escrita no M2 e os casos SQL dela (grupo R) já rodavam no Postgres embarcado; o
que faltava era o aplicativo usá-la. As peças:

- [src/services/data/visitorFavoriteService.ts](src/services/data/visitorFavoriteService.ts) —
  `VISITOR_FAVORITE_COLUMNS` (as três da tabela) e `VISITOR_FAVORITE_INSERT_COLUMNS` (`user_id`,
  `event_id`). Leitura com `.eq('user_id', ...)` e `.order('created_at', { ascending: false })`, insert
  literal, delete **pelos dois campos** — a PK é o par, não existe `id`. Não há UPDATE: o grant da 0016 é
  `select, insert, delete` (medido em R5), então a lista muda tirando e pondo o par. `23505` é "já está nos
  seus favoritos" (apertar duas vezes é caminho normal), `42501` é "entre na sua conta", `23503` é "o
  evento não está mais disponível".
- [src/services/data/visitorPreferenceService.ts](src/services/data/visitorPreferenceService.ts) —
  `VISITOR_INTERESTS` é o mesmo array do CHECK `<@ array['jovens','familia','mulheres','homens','acao_social']`,
  na mesma ordem, e `VISITOR_CITY_MAX = 80` é o `char_length(btrim(city)) <= 80`: os dois são comparados ao
  texto da migração, então afrouxar a lista na tela sem mexer no banco quebra o teste. A escrita é
  `upsert(patch, { onConflict: 'user_id' })` — a tabela tem insert **e** update e não tem delete, e um round
  trip dispensa o "existe? então update" correndo contra si mesmo. `updated_at` não entra no patch: é
  trigger (`trg_visitor_preferences_updated`).
- [src/hooks/useVisitorProfile.ts](src/hooks/useVisitorProfile.ts)
  (`useVisitorFavorites` + `useVisitorPreferences`) e `useMyRegistrations` em
  [src/hooks/useRegistrations.ts](src/hooks/useRegistrations.ts) — os três sobre `useKeyedList` com a
  identidade sendo o **id da sessão**: trocar de conta descarta a leitura anterior, em vez de deixar o
  favorito de quem acabou de sair na tela de quem entrou.
- [src/pages/public/VisitorProfilePage.tsx](src/pages/public/VisitorProfilePage.tsx) reescrita e o
  `FavoriteButton` de [src/pages/public/EventDetailPage.tsx](src/pages/public/EventDetailPage.tsx). O que a
  tela faz com o que volta: favorito é unido ao diretório público (`usePublicEvents`) pelo id — evento que
  saiu do ar **some da lista** e é contado na nota, porque a 0016 não confere publicação na RLS (decisão 4,
  escrita na migração) e a única leitura de `events` que o visitante tem é a `events_public_read`.
  Preferências: cidade + os cinco interesses, "Nada para salvar: os campos estão iguais ao que o banco
  tem.", e depois do salvar o que aparece nos campos é a linha que o banco devolveu, não o pedido.
  Histórico: `event_registrations` pelo `user_id` (a `event_registrations_read` da 0012) e, como o link da
  rota pública é `/eventos/:slug`, `toRegistration` passou a trazer também `event_slug` do embed que já era
  pedido — linha sem embed vira texto, não link quebrado.
- O que saiu da tela: os dois eventos fictícios listados como "favoritos", o `useState` do botão "Salvar
  preferências" (que só acendia uma bandeirinha "salvo (demo)") e os campos de nome/e-mail/telefone —
  identidade é `profiles` e se edita em `/app/perfil` (M3c); a 0016 guarda preferência, não cadastro.

**Revisão de risco.** O dado aqui é de uma pessoa só, visto numa rota pública.

| # | Risco | O que fecha isso |
|---|---|---|
| 1 | Favorito ou preferência de outra conta aparecer na tela | nenhuma consulta sai sem `userId`: as leituras devolvem `[]`/`null` e as escritas recusam com "entre na sua conta" **antes** de tocar no banco; o recorte `.eq('user_id', ...)` está nos três caminhos — provado por M2/M12/M13/M14, e a recusa de audiência em si é do grupo R da suíte SQL |
| 2 | Escrever na linha alheia mandando `user_id` no corpo | `visitor_favorites_self` e as três `visitor_preferences_self_*` (0016) têm `user_id = auth.uid()` em USING **e** em WITH CHECK, e o `user_id` do patch vem da sessão: `buildVisitorPreferencePatch(draft, userId)` nem recebe id pelo formulário. O teste confere as chaves exatas do patch e do insert |
| 3 | A tela dizer "salvo" quando o banco não gravou nada | insert/upsert com `.select(COLUMNS).maybeSingle()`: linha que não volta é recusa, nunca sucesso (M4/M6). No delete, zero linhas é a mesma frase da policy USING — "não estava na lista" — então a tela não vira oráculo de "essa linha existe" |
| 4 | Favorito de evento fora do ar virar linha inventada | união client-side com o diretório público: o que não está no ar sai da lista e entra na contagem da nota, e a preferência não oferece interesse que o CHECK recusa |
| 5 | A UI reintroduzir um interesse que o banco não aceita (TikTok, por exemplo) | `VISITOR_INTERESTS` comparado elemento a elemento ao array escrito na 0016 e `normalizeInterests` devolvendo na ordem do CHECK, sem repetição — M9 (injetar `tiktok` na lista) e M11 morrem aqui |

**Prova por mutação** — 16 de 16 mortas (`tools/mutate-visitor.cjs`: arquivo corrompido, suíte rodando,
restaurado no `finally` e conferido depois; nenhum `git checkout`, porque há trabalho não commitado):

| Mutação | Pegou em |
|---|---|
| M1 — `created_at` junto no insert do favorito | `salvar insere o par literal e devolve a linha confirmada` |
| M2 — gate de sessão fora da leitura de favoritos | `sem sessão não sai consulta nenhuma — e o retorno é lista vazia, não erro` |
| M3 — delete só por `event_id` (a menos o `user_id`) | `remover pelo par (conta, evento): a PK composta dispensa o id` |
| M4 — delete sem linha afirmando sucesso | `linha que não voltou no delete diz "não estava na lista", sem dizer se existe` |
| M5 — `23505` deixando vazar a mensagem do banco | `erro do banco — par duplicado — vira mensagem legível` |
| M6 — insert sem linha virando `{ ok: true }` | `inserir sem linha de volta não é sucesso silencioso` |
| M7 — `updated_at` no patch da preferência | `o patch tem exatamente as três colunas do formulário — updated_at é trigger` |
| M8 — `upsert` sem `onConflict: 'user_id'` | `a escrita é upsert pela chave da conta: um round trip, sem "existe? então update"` |
| M9 — `tiktok` de volta na lista de interesses | `os interesses da tela são os do CHECK, na mesma ordem e sem tiktok` |
| M10 — cidade aceita até 200 caracteres | `o limite de cidade é o do CHECK da tabela` |
| M11 — `normalizeInterests` passando o array cru | `interesse repetido sai uma vez, na ordem do CHECK` |
| M12 — validação da preferência removida | `cidade comprida e interesse fora do CHECK são recusados antes do banco` |
| M13 — `42501` deixando vazar a mensagem do banco | `linha que não volta e policy que recusa dizem a mesma coisa` |
| M14 — histórico sem `.eq('user_id', ...)` | `a leitura é recortada pelo user_id da sessão, com o embed que dá nome e slug` |
| M15 — `event_slug` fora da projeção | o mesmo teste, pelo `toMatchObject` do embed — o link da rota pública não tem mais de onde sair |
| M16 — `VisitorProfilePage` voltando a importar `@/data/mock` | `nenhum arquivo do aplicativo importa a loja de mocks` (a cerca de `schemaSecurity`) |

M16 é a sonda da cerca: a allowlist de páginas presas no mock encolheu de 2 → 1 (M3c) → **0** (M3d) e
virou proibição seca — importar a loja de mocks de dentro de `src/` não é mais um estado conhecido, é teste
vermelho.

Medido: **613 testes unitários** em 24 arquivos (28 em `visitorProfile.test.ts`), `tsc -b` limpo, lint sem
erro novo (as 4 advertências são as mesmas de antes: `new Date()` no rodapé, `react-refresh` nos contexts e
o `setTimeout` do mapa), build de produção ok. No `dist/` gerado **não há dado fictício** — os padrões da
loja de mocks (`Camila Torres`, `Congresso de Jovens 2026`) não aparecem em nenhum dos 4 arquivos, e a
única ocorrência de `sb_secret_` no bundle é o validador de formato do próprio `supabase-js`, não uma
chave. Suíte de RLS recontada, sem SQL alterado: **1052 declarações, grupos A–U, PASSOU**. Browser (dev
server, sem conta): `/visitante/perfil` mostra o card "Nada salvo ainda" com Entrar/Criar conta, as duas
listas com a frase de quem não entrou, console limpo, e `/eventos/:slug` inexistente continua renderizando
sem erro — que é o caminho do `FavoriteButton` para anon.

**Limites desta entrega.** A **gravação** no browser não foi medida: favoritar e salvar preferência exigem
uma conta de visitante confirmada **e** um evento publicado, e o banco que está no ar não tem nenhum — os
dados do piloto foram apagados. É o mesmo bloqueio do M3c, com a mesma saída de antes: fixture pelo SQL
Editor (procedimento documentado acima) + a conta, e eu conduzo a medição e depois apago. Com as
0015..0021 ainda pendentes no projeto real (M7), `/visitante/perfil` e o coração no ar caem na falha de
leitura (`42P01`) em vez de gravar. E `visitor_favorites` não tem como saber se o evento favorecido ainda
está publicado — é decisão registrada na própria 0016, e o custo na tela é o que está escrito acima: o
evento some da lista e é contado na nota, nunca inventado.

## Testes de RLS e isolamento entre igrejas

**1052 declarações (grupos A–U)** em `supabase/tests/database/rls_isolation.sql`, executados contra
um Postgres 18.6 real. Rodam **agora, sem projeto Supabase e sem Docker**:

```bash
npm run test:rls      # sobe Postgres embarcado, aplica shim + migrações + seed e roda a suíte
```

O que é verificado:

| Grupo | Cenário |
|-------|---------|
| A | visitante anônimo não vê roster, perfis, logs, config — nem igreja pendente |
| B | membro da igreja A lê só A (igrejas, membros, perfis, auditoria, permissões); SuperAdmin lê tudo |
| C | escrita cruzada e escalada: convite em outra igreja, renomear/alvará de terceiros, autoaprovação, forjar auditoria, editar perfil alheio, excluir membros de fora, mexer em config, **se promover SuperAdmin** e remover o SuperAdmin real — e, desde o M3c, **o gerente não edita o cadastro institucional** (C17), o `church_admin` grava exatamente as colunas da tela sem tocar em `slug`/`status`/`approval_status` (C18, anti-no-op) e em `profiles` não há exceção de SuperAdmin: ele edita o próprio, não o do colega (C19) |
| D | storage: leitura/upload por pasta da igreja (públicos x privados) |
| E | guardas estruturais: toda tabela de `public` com RLS, nenhuma política aberta (`USING (true)` **ou sem USING**) em tabela que não seja catálogo (`roles`/`permissions`/`role_permissions`/`event_categories`), toda função `SECURITY DEFINER` de `public` com `search_path` fixo, e a porta de publicação de eventos no lugar (função **INVOKER** com `search_path` fixo + trigger `BEFORE INSERT OR UPDATE OF status`) — cada guarda tem uma **sonda** que prova que ela ainda enxerga o problema |
| F | view `church_roster`: nomes da própria igreja visíveis, contatos só para quem tem `members.manage`, anon bloqueado, nada cruzando igrejas |
| G | onboarding de quem cadastra a igreja: vira `church_admin` da própria, consegue ler/editar a pending, e não ganha nada além disso |
| H | convites (0008): criar só na própria igreja, cancelar, mudar papel, e as recusas — sem `members.manage`, em igreja alheia, `invited_by` forjado, convite para `superadmin`, aceite por quem não é o destinatário, convite expirado, segundo aceite, convite trocando de igreja, e anon sem acesso à tabela nem às RPCs |
| I | listas de igrejas (`churchService`): as duas projeções escritas por extenso (a do público e a de gestão), o diretório medido **com e sem** o WHERE do app, a fila do SuperAdmin, e o vínculo `invited` que não dá leitura da igreja nem pelo embed |
| J | efeito de audiência da escrita de aprovação (`churchApprovalService`): aprovar põe no diretório anônimo (com `get diagnostics row_count` provando a escrita), suspender e rejeitar tiram **sem cegar a própria igreja**, e o J4 grava que a RLS é por linha — coluna protegida é projeção do app, não política |
| K | trilha da aprovação: gerada pelo update (sem insert manual), embeds confirmados, membro lê apenas a própria igreja, update/delete recusados inclusive ao SuperAdmin, nenhuma trilha de aprovação recusada; K5 mede a recusa do insert manual pela API (0010), com sonda de que o trigger continua escrevendo |
| L | atomicidade (0009/0010): trigger `SECURITY INVOKER` com `search_path` fixo e `AFTER UPDATE` por linha, política de insert amarrada à marca do trigger, seis transições com ator/nome/de/para vindos da sessão e da linha, nenhuma trilha em status repetido ou rename, rollback de igreja **e** trilha quando a auditoria falha, insert descartado silenciosamente aborta o update, e backend sem usuário deixa ator nulo |
| M | eventos (0011): diretório do visitante medido **com e sem** o WHERE do app (rascunho, privado, não listado, agendado e igreja não aprovada invisíveis), catálogo de categorias público na leitura e fechado na escrita, membro lê os próprios em qualquer status e nada da vizinha, suspender/rejeitar a igreja tira os eventos do ar **sem cegar a própria igreja**, `visibility` gravado como intenção de produto e não como controle de acesso, publicar sem `events.publish` recusado (comunicador edita mas não publica; gerente publica), escrita cruzada entre igrejas recusada, e as projeções do app escritas por extenso — M8 é o avesso, como J4: a RLS não esconde coluna, quem limita é a projeção |
| N | inscrições (0012): `anon` sem grant nenhum na tabela, membro da A lê só as inscrições da A, comunicador não lê nem faz check-in (falta `registrations.manage`), inscrição do visitante por RPC com igreja derivada e código gerado, recusas por evento fora do ar / encerrado / dados inválidos / e-mail repetido, capacidade virando lista de espera, cancelamento promovendo o mais antigo da fila, `sem_permissao` para linha alheia **e** para id inexistente (permissão antes de existência), check-in repetido e de inscrição cancelada, escrita direta recusada inclusive para `authenticated`, `church_id` forjado barrado pelo trigger com `42501`, a view de agregados medida para anon (só eventos no ar) e para membro (rascunho próprio sim, o da vizinha não), usuário logado lendo só a própria linha, e o `information_schema` provando que a view não expõe nome, e-mail, telefone nem código |
| O | filiais e localização (0013): `church_branches` sem grant de `anon` (recusa antes da RLS, O1), membro ativo lê só as filiais da própria igreja e `invited` não lê nada (O2/O3), escrita exige `church.manage` — gerente e comunicador leem mas não inserem nem editam (O4) —, church_admin cadastra/edita e transferir a filial de igreja é recusado (O5), SuperAdmin atravessa igrejas (O6), **excluir não existe** nem para o SuperAdmin (O7), `events.branch_id` de outra igreja recusado com a mesma mensagem e SQLSTATE de filial inexistente (O8, sem oráculo), coordenada fora do intervalo barrada nas três origens e NULL aceito (O9), e guardas estruturais — trigger DEFINER com `search_path` fixo e sem EXECUTE público, ausência de delete, WITH CHECK real e as colunas que o app projeta (O10). **M11** mede a localização gravada no evento |
| P | campanhas de divulgação (0014): `marketing_campaigns` sem grant de `anon` (recusa antes da RLS, P1), leitura e escrita exigem `marketing.manage` na igreja da campanha — pastor e visitante não leem nada e `invited` também não (P3), membro lê só as da própria igreja e nada da vizinha (P2), SuperAdmin atravessa (P6) —, insert na igreja alheia recusado (P4) e transferência de igreja barrada no update (P5), **publicar é impossível pelo app**: o trigger `enforce_campaign_publish` recusa `published`/`failed` de `authenticated` com `42501` e a mensagem casada, e só `service_role` marca publicada (P7), transições legítimas (agendar/cancelar/voltar a rascunho) permitidas, **excluir não existe** nem para o SuperAdmin (P8), CHECK de `networks` e `status` comportamental (P9), e guardas estruturais — trigger de publicação INVOKER com `search_path` fixo, ausência de delete e de grant de `anon`, WITH CHECK real no insert e no update, as três políticas citando `marketing.manage` e as colunas projetadas (P9b) |
| Q | ministérios e perfis de rede (0015) + a guarda de audiência da 0021: `anon` sem grant nenhum (Q1), membro ativo lê os ministérios da própria igreja com **líder pelo nome e contagem vinda de `ministry_members`** (Q2), `invited` não lê e quem não tem `members.manage` lê mas não escreve (Q3), cruzar igreja não vale nem lendo nem escrevendo (Q4), quem gerencia escreve na própria (Q5), @handle de rede é gravado por `church.manage` (Q6) e **marcar `connected` é impossível pelo app** — `enforce_social_connection` recusa `authenticated` com `42501`, inclusive nascendo conectada (Q7) —, estrutura anti-deriva com políticas, grants, view e o CHECK de rede sem `tiktok` (Q8). Q9/Q9b/Q9c são a 0021: líder ou participante de outra igreja **e de vínculo `invited`** recusados, a mesma escrita correta aceita (sonda anti-no-op) e os dois triggers conferidos no catálogo |
| R | favoritos e preferências do visitante (0016): `anon` não lê nenhuma das duas (R1), cada um vê só a própria lista — inclusive quem não tem vínculo nenhum (R2), escrever na lista do outro cai no `WITH CHECK` (R3), o caminho honesto funciona: salvar na própria lista e trocar as próprias preferências (R4), estrutura com uma política `for all` por tabela, sem update de favorito, e o CHECK de interesses **sem** `tiktok` (R5) |
| S | redes de igrejas / organizações (0017): só o SuperAdmin cria rede e associa igreja (S1), o membro vê apenas as redes das próprias igrejas — a estrutura inteira da plataforma não aparece (S2), membro não cria, não se autoassocia e não desassocia (S3), anônimo e sem vínculo não veem nada (S4), estrutura: escrita exclusiva de SuperAdmin nas duas tabelas e `slug` único (S5) |
| T | suporte (0018): quem abriu vê o chamado, o vizinho de outra igreja não, SuperAdmin vê tudo (T1), **gerente da mesma igreja não lê** ticket que não é dele — audiência apertada de propósito, porque print de chamado traz terceiro (T2), abrir registrado com o autor da sessão e a igreja do assunto própria (T3), responder só dentro do direito (T4), fechar por quem abriu e **sem delete nenhum** (T5), estrutura: sem grant de `anon` e `can_read_ticket` `DEFINER` com `search_path` fixo (T6) |
| U | eventos de segurança (0019): a RPC `log_security_event` é a única porta de entrada, grava `actor_id = auth.uid()` e recusa tipo fora dos dois (U1), o SuperAdmin lê o que a RPC gravou com o nome de quem tentou e as duas views agregam o resumo do painel (U2), sem vínculo não se lê e anônimo nem executa a RPC (U3), estrutura: uma política de leitura e **nenhum grant de escrita** para ninguém (U4) |

Detalhes que valem a leitura:

- O arquivo inteiro vive em **uma transação que termina em `rollback`** — fixtures e testes não
  deixam rastro, nem no projeto real. Cada caso abre um `savepoint` e desfaz, então a ordem não importa.
- Troca de usuário é feita com `set local role authenticated` + `request.jwt.claims` (o mesmo GUC
  que o PostgREST preenche), e não com dados de teste no frontend.
- `supabase/tests/local/shim_supabase.sql` **não deve ser aplicado num projeto Supabase real**:
  ele só cria os papéis `anon`/`authenticated`/`service_role` e os esquemas `auth`/`storage` que o
  provedor já traz. Os casos de storage se pulam sozinhos quando `storage.objects` não existe.
- Dois furos encontrados ao escrever os testes e corrigidos em `0004_rls_hardening.sql`:
  **autoaprovação** (membro com `church.manage` alterava o próprio `approval_status`, porque o RLS
  não controla colunas — hoje um trigger `BEFORE UPDATE` bloqueia com `42501`) e **forjamento de
  auditoria** (`audit_logs` aceitava insert com `church_id` de outra igreja).
- Um terceiro, mais grave, fechado em `0005_superadmin_role_guard.sql`: **autopromoção a
  SuperAdmin**. `is_superadmin()` é global e `church_members_manage` autoriza quem tem
  `members.manage` na própria igreja — então um Administrador de igreja promovia a si mesmo (ou um
  laranja) ao papel `superadmin` e virava admin da plataforma inteira; e ainda podia apagar o
  vínculo do SuperAdmin de verdade. O trigger agora só deixa atribuir/alterar/remover o papel
  `superadmin` para quem já é SuperAdmin.
- A suíte falha se qualquer uma das guardas voltar — conferido por mutação, uma execução por
  variação: sem a 0004 cai em C6; sem a 0005 cai em C13 ("a1 promoveu a si mesmo a superadmin");
  sem a 0006 cai em G1 ("criador ficou sem vínculo na própria igreja"); sem a 0007 o grupo F nem
  começa (`relation "public.church_roster" does not exist`); e uma política `USING (true)` injetada
  em `church_members` derruba A2 ("roster vazado"). Trocar `security definer` da 0006 por
  `security invoker` derruba C10 — o criador não tem `members.manage` ainda, então só um trigger
  DEFINER consegue anexá-lo à própria igreja. Da 0008, sete mutações: sem o trigger de papel
  cai H4 ("a1 criou convite para o papel superadmin"); sem a checagem de e-mail no aceite cai H8
  ("aceite de terceiros retornou aceito"); sem `invited_by = auth.uid()` no WITH CHECK cai H5;
  sem a segunda trava da RPC cai H10; com `disable row level security` na tabela nova cai E1; e
  tirar `security definer` das RPCs cai em E3 (as duas entraram na lista `wanted` da guarda).
  A última foi a que o próprio H descobriu: `revoke execute ... from anon` **não** fecha função
  nenhuma, porque função nova em `public` nasce com EXECUTE também para `PUBLIC` — o revoke tem
  que ser `from public, anon`, e H6 (anon chamando `pending_invitations_for_me`) só passou depois
  disso.
- Das listas de igrejas, cinco mutações, uma execução por variação: tirar
  `or id in (select public.current_church_ids())` de `churches_public_read` cai em **B1** (I2 e I3
  também cairiam; o primeiro a falar é o grupo mais antigo — defesa em profundidade, não coincidência);
  tirar `and status = 'active'` de `current_church_ids()` cai em **I6** ("convite não aceito mudou a
  leitura de igrejas de 3"); renomear a coluna `whatsapp` na 0001 cai em **I1** com
  `column "whatsapp" does not exist`; acrescentar uma coluna em `MANAGED_COLUMNS` derruba o teste
  unitário que exige cada nome dentro do texto do grupo I; e tirar `&& c.status === 'active'` do
  diretório demo derruba "esconde a aprovada com conta inativa".
- Da escrita de aprovação, cinco mutações, uma execução por variação, cada arquivo com backup e
  `md5sum` conferido na restauração: sem o trigger da 0004 cai em **C6** ("a1 autoaprovou a própria
  igreja pendente (escalada de privilegio)"); com `churches_public_read` afrouxada para
  `approval_status = 'approved' or status = 'active'` cai em **I1** (3 igrejas no diretório em vez de
  2), e numa afrouxada mais cirúrgica — `in ('approved','suspended')`, que deixa o I1 verde — cai em
  **J2** ("anon le a igreja suspensa A"), que é o caso que importa aqui; sem o gate de papel do
  espelho demo cai "recusa quem não é SuperAdmin"; e com `email` dentro de `APPROVAL_COLUMNS` caem
  "devolve só a projeção de gestão" e os dois anti-deriva.
- Da auditoria, na versão de duas escritas (antes da 0009), **oito mutações isoladas** com backup,
  comparação de hash e execução verde após cada restauração: liberar insert derrubou **C9**;
  permitir update derrubou **K3** (2 linhas alteradas); permitir delete derrubou **K3** (2 linhas
  apagadas); antecipar o insert derrubou os três testes de ordem/recusa; acrescentar `profiles` à
  projeção derrubou o anti-deriva de K1; aceitar retorno nulo do insert derrubou o teste de
  confirmação; retirar a recusa de papel demo derrubou o teste de escrita direta; retirar o filtro
  do estado anterior derrubou o contrato do update. As três últimas guardas deixaram de existir
  com a 0009 — o insert, o estado anterior e o ator saíram do frontend.
- Da atomicidade (0009), **oito mutações**, cada uma com backup e `md5sum` conferido na restauração
  e suíte verde entre variações: remover o trigger derrubou **K1** ("o superadmin nao le a propria
  trilha"); engolir a exceção da auditoria derrubou **L3** ("falha da auditoria nao abortou a
  aprovacao"); tirar o `STRICT` derrubou **L4** ("auditoria descartada silenciosamente permitiu
  alterar aprovacao"); ator nulo derrubou **K1** pelo embed, e atribuindo a trilha a *outra conta*
  (embed válido) derrubou **L2** ("transicao 1 sem trilha unica com ator/nome/de/para corretos") —
  é o caso que mede autoria; remover o `WHEN ... is distinct from` derrubou **L2** ("status repetido
  ou mudanca de nome gerou auditoria de aprovacao"); trocar para `security definer` derrubou **L1**;
  no app, reintroduzir um `await` entre a trilha e a mudança da igreja derrubou o teste de ordem do
  demo; e mandar `updated_at` junto no update real derrubou 15 testes do contrato de escrita única.
  Nenhuma mutação ficou no código ou nas migrações.
- Do fechamento do insert manual (0010), **seis mutações**: tirar a exigência da marca da política
  derrubou **K5** ("superadmin inseriu trilha manual atribuindo a outra conta"); não limpar a marca
  depois do insert também derrubou K5, e numa versão cirúrgica — limpar só quando a ação não é
  `igreja.reativada`, que deixa as duas primeiras recusas verdes — caiu exatamente na terceira
  asserção ("a marca do trigger vazou para outro insert da mesma transacao"); renomear a marca só
  na 0010 derrubou o anti-deriva unitário **e** a suíte (a trilha automática para de passar); tirar
  o `is_superadmin()` da política deixou a **suíte SQL verde** e só o unitário caiu — é camada
  redundante, e o teste é a única rede para ela; e desligar a marca dentro do trigger derrubou a
  suíte com `new row violates row-level security policy for table "audit_logs"`, provando que a
  marca é o que autoriza a escrita legítima (não uma guarda decorativa).
- Dos eventos (0011), **onze mutações**, cada uma com backup, `md5sum` conferido na restauração e
  suíte verde entre variações: trocar `enforce_event_publish` para `SECURITY DEFINER` cai em **E4**
  (o `current_user` do backend deixaria de ser `service_role`, e a publicação passaria a ser decidida
  por quem criou a função) e remover `trg_events_publish` também cai em **E4** — as duas eram pegadas
  pela fixture antes, e o M6 foi reduzido ao comportamento depois que a guarda estrutural passou a
  rodar antes das fixtures; remover `status = 'published'` ou `visibility = 'public'` de
  `events_public_read` cai em **M1**; remover o `exists` da igreja aprovada e ativa cai em **M1** (o
  evento da igreja pendente aparece para anon); afrouxar `events_church_read` cai em **M3**; política
  de escrita aberta (`using (true) with check (true)`) cai em **E2**, e a versão cirúrgica que o E2
  não vê — `has_church_permission(church_id,'events.manage') or church_id is not null` — cai em
  **M7**; e a sonda do E2 continua provando que a guarda enxerga política aberta em tabela nova. Do
  passo 3, mais uma: `with check (true)` em `events_update` cai em **M10** — e só *remover* a cláusula
  não é mutação, porque o Postgres reusa o `USING` como `WITH CHECK` quando ela falta.
- Uma mutação dos eventos **não foi pega**, e é o achado mais útil do grupo: remover só
  `c.approval_status = 'approved'` do `exists` de `events_public_read` deixa a suíte inteira verde.
  A subconsulta roda como anon e portanto atravessa a RLS de `churches` — a igreja suspensa já
  desapareceu do `exists` por `churches_public_read`, sem depender da condição. A audiência é
  garantida duas vezes, e nenhuma das camadas é decorativa. Para provar que o **M4** tem dentes foi
  preciso uma mutação composta ("audiência cega"): remover o `exists` inteiro **e** tornar o fixture
  `event_c_pub` rascunho, para o M1 continuar verde. Aí o M4 falha exatamente com "com a igreja A
  suspensa o diretorio tem 2 eventos, esperava so o da igreja B".
- Do `eventService`, **quatro mutações** no aplicativo, cada uma com backup e `md5sum` conferido na
  restauração: tirar `.filter((e) => churchIsOnAir(e.church_id))` do espelho demo derruba "suspender
  a igreja tira os eventos dela do ar"; tirar `e.visibility === 'public'` derruba o caso
  `private`/`unlisted` ("o ramo visibility=… tem dentes"); acrescentar `created_at` em
  `EVENTS_PUBLIC_COLUMNS` derruba três testes — a coluna proibida, as chaves da linha demo **e** o
  anti-deriva contra M1/M3; e fazer a agenda usar a projeção pública derruba o contrato do `select`
  de gestão. Nenhuma mutação ficou no código.
- Das inscrições (0012), **sete mutações**, cada uma com backup, `md5sum -c` na restauração e suíte
  verde entre variações: trocar a porta de `check_in_registration` por `true` (permission gate
  removido, linha alheia liberada) cai em **N3** ("check-in do comunicador devolveu *presente* em vez
  de sem_permissao", declaração 587/669); desligar a comparação do trigger (`if new.church_id <>
  event_church` por `if false`) cai em **N12** ("inscricao com church_id de outra igreja foi aceita",
  647/669); acrescentar `max(r.visitor_email)` à view de agregados cai em **N15** ("a view de
  estatisticas expoe 1 coluna(s) com dado pessoal", 666/669) **e** em dois unitários — a coluna fora
  da projeção e o dado pessoal na view; no app, tirar `.eq('church_id', churchId)` da lista da equipe
  derruba "a lista da equipe seleciona a projeção e resolve o nome do evento pelo embed", e trocar o
  filtro do espelho demo por `.filter(() => true)` derruba "a lista da equipe traz só os eventos da
  própria igreja", e tirar `!can(role, 'registrations.manage')` do recorte da leitura derruba "papel
  sem `registrations.manage` não pede a lista" — o espelho demo voltaria a mostrar nomes e códigos
  que o banco recusa.
- Uma mutação das inscrições **só a suíte SQL pegou**, e é o achado útil do grupo N: trocar
  `occupied < ev.capacity` por `when true` (ninguém nunca vai para a lista de espera) cai em **N7**
  ("a terceira inscricao devolveu *confirmed*, esperava waitlist", 614/669) e deixa os 40 unitários
  verdes. O teste de contrato lê a **forma** da migração — RLS, grants, projeção, `search_path`,
  ordem entre permissão e existência, e cada código de retorno amarrado a uma mensagem —, não a
  aritmética da capacidade. É divisão de trabalho, não buraco: regra de negócio se mede rodando o
  banco, e é para isso que o `npm run test:rls` existe.
- O **anti-deriva do grupo J também não tinha dentes**, e a mutação que provou isso foi a mais
  interessante: a asserção verificava que cada coluna de `APPROVAL_COLUMNS` *aparece no texto* do
  grupo J. Como o J4 escreve `email`, `zip` e `website` de propósito, acrescentar `email` à projeção
  do app continuava verde — exatamente o vazamento que o teste jurava pegar. Reescrita, a asserção
  agora varre as linhas do `select ... from public.churches where ...` do grupo J e compara **como
  conjunto**, nos dois sentidos. Provado com uma mutação só de texto (tira `slug` do read-back do
  J1): a suíte SQL fica verde, porque a query continua válida, e só o teste unitário cai — ou seja,
  ele é a única rede para esse tipo de deriva, e é por isso que existe. (Detalhe: a primeira versão
  da varredura era uma regex, e o `from` de uma projeção caía dentro do alcance da outra; a
  varredura é por linha. Ela também filtrava `cols[0] === 'id'` *depois* de ordenar, o que fazia os
  três casos falharem no schema limpo — verde falso ao contrário.)
- O caso **I6 não tinha dentes** na primeira versão, e foi a mutação de `current_church_ids()` que
  descobriu: ele contava os vínculos com `cm.status = 'active'` no próprio `church_members`, então a
  igreja que a mutação abriu nunca entrava na conta — verde com a guarda quebrada. Reescrito para
  contar `churches` (as 2 aprovadas, nunca a C) e o `count(c.id)` de um `left join` (exatamente o que
  o embed do PostgREST devolve), ele falha na mutação e passa no schema limpo.
- Outro defeito de teste, este achado ao rodar o grupo H: buscar o id do convite **dentro** do caso
  com `select … from church_invitations where email = …` devolve 0 linhas para quem não é a
  administração (nenhuma política de select atende o convidado), a RPC recebia `NULL` e a asserção
  `if r <> 'aceito'` é `NULL` — verde com o convite nunca aceito. Os casos H8..H11 agora pegam o id
  como dono, num GUC (`app.inv_h8`, …), e comparam com `is distinct from`, que não engole NULL.
- Um defeito **do próprio teste** apareceu ao escrever a guarda E3: `proconfig` é `NULL` quando a
  função não tem `SET`, e `NULL not like '%…%'` nunca é verdadeiro — a asserção ficava verde com a
  função desprotegida. Confirmado por mutação (0006 sem `search_path` não derrubava nada; com o
  `coalesce` derruba em E3). Para isso não se repetir, E2 e E3 agora têm **sondas**: cada uma cria
  de propósito uma política aberta / uma função `SECURITY DEFINER` sem `SET` e exige que o mesmo
  predicate as detecte antes de checar o schema real. O predicate fica num `create temp view`, então
  a sonda e a guarda não podem divergir; tudo é desfeito pelo `rollback to savepoint` seguinte.
- Cobertura comportamental: tabelas das fases 1/2, `events`/`event_categories` (grupo M) e
  `event_registrations` (grupo N) — inclusive inscrever-se num evento de igreja que saiu do ar (N5,
  pela RPC e pela view). As guardas estruturais do grupo E varrem o schema inteiro, então a 0012 já
  entrou sendo medida por elas: RLS ligado na tabela nova (E1), nenhuma política aberta (E2) e as
  funções `SECURITY DEFINER` novas com `search_path` fixo (E3). Foi o que aconteceu com
  `event_categories`, que entrou na lista de catálogos do E2 — com a sonda provando que a exceção não
  cegou a guarda.
- Cobertura comportamental já inclui, além das tabelas das fases 1/2, `events`/`event_categories`
  (grupo M), `event_registrations` (grupo N), `church_branches` + localização (grupo O) e
  `marketing_campaigns` (grupo P). **Automações (Fase 7) e IA/gerador de texto (Fase 6) não têm tabela
  própria** — são motores locais que rodam no navegador sobre leituras já guardadas (eventos e
  inscrições), então não há política nova para a suíte medir; a rede deles são os testes unitários e a
  asserção "nenhum segredo na fonte". Na versão atual também a leitura **global** de eventos no painel
  do SuperAdmin é real (`fetchAllEvents` pelo `useAdminEvents`); o `—` só aparece enquanto consulta.

Para rodar a suíte no projeto real: aplique as migrações 0001→0021 e o `seed.sql`, cole o conteúdo de
`rls_isolation.sql` no **SQL Editor** e execute — ou, com a CLI:

```bash
supabase db query --linked -f supabase/tests/database/rls_isolation.sql
```

Há ainda um teste estático (`tests/unit/schemaSecurity.test.ts`) que falha se alguma chave
privilegiada aparecer no bundle do navegador: nenhuma leitura de `SERVICE_ROLE`, `createClient`
restrito a `src/services/supabase/client.ts` com a anon key, e nenhuma credencial literal em `src/`.

## Mapa das fases

| Fase | Escopo | Estado neste esqueleto |
|------|--------|------------------------|
| 1 | Fundação, auth, RBAC, banco, RLS | Schema + RLS prontos; telas auth em demo |
| 2 | Igrejas, filiais, usuários, equipes, aprovação | **Onboarding de igreja pelo app** (`/app/onboarding` + `createChurch`: insert `pending` com `created_by` da sessão, criador virando `church_admin` pelo trigger 0006); usuários lendo **e escrevendo** no banco (view 0007 + convites 0008); listas de igrejas lendo o real (`churchService`) e a aprovação escrevendo o real (`churchApprovalService`, grupo J), com trilha atômica no banco e leitura de auditoria (`auditService`, grupos K e L, migração 0009); **filiais lendo e escrevendo** (0013 + `branchService`, grupo O — sem delete); **equipes/ministérios lendo e escrevendo** (0015 + a guarda de audiência 0021 + `ministryService`, grupo Q — aqui delete **existe**, por decisão da 0015; 0015..0021 ainda só no Postgres embarcado, não no projeto no ar) |
| 3 | Eventos, calendário, inscrições, check-in, portal | Eventos **lendo e escrevendo** (0011 + `eventService`, grupo M) e inscrições **lendo e escrevendo** (0012 + `registrationService`, grupo N): criação/edição/transição de status com a porta `events.publish`, inscrição pública com lista de espera, contagem real de inscritos, lista/CSV da equipe, check-in por código — quem está na lista de espera só entra com clique explícito — e cancelamento com promoção da fila. **Filial e localização no evento gravam** (0013, M11). Falta upload de capa no Storage e o QR Code impresso |
| 4 | Google Maps, GPS, localização | **Mapa público real**: Leaflet + OpenStreetMap (decisão sua, sem chave), GPS do navegador **sem geocodificador**, distância por haversine, ordenação por proximidade e botão Rota. Só é plotada igreja com coordenada real; sem coordenada a lista avisa e o pino não é inventado; sem rede os tiles falham com aviso honesto. Coordenadas também são digitáveis nos formulários de igreja, filial e evento |
| 5 | Divulgação social (Meta/WhatsApp) | Campanhas **lendo e escrevendo** no banco (0014 + `marketingService`, grupo P) com RLS por `marketing.manage` e o trigger que **só deixa `service_role` publicar** — o botão Publicar devolve aviso honesto e não marca nada. Distribuição **sem chave** real (WhatsApp/wa.me, copiar link com UTM, Web Share) no painel e na página pública do evento. `/app/redes` **lê e escreve** `church_social_accounts` (0015 + `socialAccountService`, grupo Q): @handle editável, escrita só de quem gerencia a igreja, e o selo "Conectada" que não sai do banco não aparece na tela — sem botão de conectar de mentira. Postagem real em rede fica de fora (exige OAuth + backend com tokens). **TikTok saiu do app** (0020 no CHECK de campanha) |
| 6 | IgrejaConecta AI | **Gerador de texto de campanha local** (`utils/campaignText.ts`, sem IA e sem chave): monta nome, mensagem e hashtags com os dados reais do evento, roda no navegador e salva como rascunho pela mesma porta `marketing.manage` + RLS da 0014. Ligado ao formulário de campanha (**Gerar sugestão**) e à página `/app/ia` (**Gerar texto** + **Criar rascunho**). Artes, vídeos e IA de provedor seguem **Não conectado** — exigem backend que guarde `OPENAI_API_KEY` (a chave nunca vai ao frontend); nada é fingido |
| 7 | Automações e notificações | **Automações em simulação local** (`utils/automationEngine.ts`, sem provedor e sem chave): motor puro calcula **o que cada regra dispararia agora** com os eventos e inscrições reais da igreja e mostra a mensagem que *seria* enviada. `/app/automacoes` liga/desliga cada regra (interruptor funcional que muda o dry-run na hora) e traz contadores honestos — **Envios reais = 0 · não conectado**. Canais (SMTP/WhatsApp/Push/Interno) e execução/agendamento ficam **Não conectado**: disparar de verdade exige scheduler no servidor + provedor de envio + backend com as chaves, e nada disso existe aqui. Regras em estado local/sessão (sem tabela). Nada envia, agenda ou executa; nada é fingido |
| 8 | SuperAdmin, relatórios, segurança avançada | Painel do SuperAdmin **lendo o que a RLS já devolve** (`is_superadmin()`), sem migração nem política nova: diretório global de usuários (`adminService`, projeção congelada que não vaza `role_id`), eventos de todas as igrejas (`eventService.fetchAllEvents`), relatórios agregados + CSV (`utils/reports.ts`) e dashboard com contagens reais — tudo gateado em `superadmin` antes de consultar (defesa em profundidade; a política no banco é a 2ª camada). Organizações, Suporte, Integrações, Monitoramento, exportar PDF e receita/IA seguem **"não conectado"/"não existe ainda"**, sem número nem botão morto. "Segurança avançada" (alertas de tentativas suspeitas) não existe aqui e diz "Não conectado" |
| 9 | Testes gerais, SEO, PWA, publicação | **SEO + PWA completos, preparados sem publicar**: `index.html` com OG/Twitter/canonical/theme-color/JSON-LD (Organization+WebSite) crawler-visible; `robots.txt`, `sitemap.xml` (só rotas fixas) e `manifest.webmanifest` reais; ícones PWA + `og-image.png` derivados do favicon (`scripts/make-pwa-icons.ps1`); `useDocumentMeta` aplica title/canonical/robots/JSON-LD por rota (schema.org/Event no detalhe, `noindex` em login e painéis); `sw.js` pré-cacheia o shell e só registra em produção, sem cachear dado de provedor nem `/app`/`/admin`. Testes unitários (`tests/unit/seo.test.ts`) + prova por mutação M1–M7 + verificação no build de produção. **Publicar** fica atrás do seu "publica": falta host estático + projeto Supabase real + `VITE_SITE_URL`/domínio (passo a passo na seção da Fase 9) |

## Próximos passos

1. Repetir a suíte de isolamento no projeto Supabase real (`npm run test:rls` já cobre o local). As
   migrações 0001→0014 e o `seed.sql` **já foram aplicados** lá (`dlucvyjxidrfyjwuouvp`); faltam as
   0015..0021 — sem elas os grupos Q..U não têm o que medir e as telas novas falham com `42P01` no ar.
   A 0020 (TikTok fora do CHECK) sobe nesse mesmo deploy: o app já não oferece a rede em lugar nenhum,
   então banco e tela entram concordando. Depois disso é só rodar a suíte contra o projeto real.
2. Trocar mocks por consultas via `supabase` tela a tela. **Feito: roster e convites/Usuários
   (Fase 2, passos 1 e 2) — leitura e escrita —, as listas de igrejas (passo 3) — leitura —, a
   aprovação do SuperAdmin (passo 4) — escrita —, sua auditoria (passo 5) — escrita e leitura —,
   eventos (Fase 3, passos 1 e 3) — leitura e escrita —, inscrições (passo 2) — leitura e escrita —,
   filiais e localização (Fase 4) — leitura e escrita —, campanhas (Fase 5) — leitura e escrita, com a
   publicação bloqueada no banco —, as leituras globais do SuperAdmin (Fase 8) — diretório de usuários,
   eventos de todas as igrejas e relatórios agregados, gateadas em `superadmin` — e **ministérios e
   equipe (passo M3a) — leitura e escrita, com a audiência de líder/participante fechada no banco pela
   0021 — e perfis de rede social (passo M3b) — leitura e escrita do @handle em
   `church_social_accounts` (0015), com `connected` travado no banco e o TikTok fora das duas
   superfícies** e **o cadastro institucional e o perfil pessoal (passo M3c) — leitura e escrita em
   `churches` e `profiles`, com as colunas travadas fora do patch e o e-mail de login de fora** e
   **o perfil do visitante (passo M3d) — favoritos, preferências e histórico lendo e escrevendo na 0016,
   com o coração da página de evento gravando de verdade**. **Nenhum arquivo de `src/` importa a loja de
   mocks** — a cerca que era uma allowlist que só encolhia virou proibição seca, e a mutação M16 prova que
   ela ainda morre quando uma tela volta ao mock. O onboarding de igreja
   (cadastro pelo `/app/onboarding`, com o criador virando `church_admin` pelo trigger 0006) também
   escreve de verdade — veja a seção própria.**
   Só falta o M3e, que não é tela: mover `src/data/mock.ts` para `tests/fixtures/` (ele já não é
   importado por nada em `src/`, então já não chega ao navegador — é limpeza de casa, não de risco).
   o padrão de leitura está em `services/data/churchService.ts`, `eventService.ts`,
   `registrationService.ts`, `branchService.ts`, `marketingService.ts`, `ministryService.ts` e
   `adminService.ts` (e em `rosterService.ts`), o de escrita em `memberService.ts`, `churchApprovalService.ts`, `eventService.ts`,
   `branchService.ts`, `ministryService.ts`, `marketingService.ts` e os dois do visitante
   (`visitorFavoriteService.ts`, `visitorPreferenceService.ts`), e o de escrita que **só** existe por RPC em
   `registrationService.ts`.
3. Falta de produto real na tela de Usuários: **enviar o convite por e-mail**. Hoje a linha fica
   `pending` e quem tem a conta vê o banner "Convites para você"; sem um e-mail de verdade, quem
   ainda não tem conta não descobre que foi convidado. Isso depende de SMTP/Projeto Supabase real,
   então não dá para simular honestamente no local.
4. Dentro da aprovação: dar um motivo à rejeição que a igreja consiga ler — hoje ela só vê o status.
   A trilha já é atômica, com ator derivado da sessão no banco (0009) e sem insert manual pela API
   (0010, medido por K5).
5. Fase 3, o que falta: o **QR Code impresso** do ingresso (precisa de uma biblioteca de geração de
   QR; hoje o check-in é pelo código digitado ou bipado) e o **upload da capa para o Storage** (hoje é
   URL colada). Filial e latitude/longitude no evento foram entregues na Fase 4, e a leitura global de
   eventos no painel do SuperAdmin, na Fase 8. Confirmar a inscrição por e-mail/WhatsApp depende do
   mesmo provedor real do item 3. A decisão do balcão sobre a lista de espera está tomada e entregue:
   o check-in promovia `waitlist` sem ter consumido vaga (medido em produção); hoje a tela avisa que não
   havia vaga garantida e exige um clique explícito antes de gravar. A decisão, o risco e a prova por
   mutação estão em [Lista de espera no balcão: avisar e confirmar](#lista-de-espera-no-balcão-avisar-e-confirmar-2026-11-13);
   a medição que levantou a pergunta, em
   [Check-in medido no ar e o painel de duas fontes](#check-in-medido-no-ar-e-o-painel-de-duas-fontes-2026-11-13).
6. **Decisão pendente de segurança:** sair de `published` (voltar a rascunho ou cancelar) exige hoje só
   `events.manage` — é o que a 0011 faz, e o app reproduz. Se tirar um evento do ar deve exigir
   `events.publish`, é mudança de política: precisa de revisão de risco escrita e de caso novo na suíte
   antes de mexer.
7. Fase 6, o que falta: **IA de provedor** (texto de modelo, artes e vídeos) exige um backend que
   guarde `OPENAI_API_KEY` com segurança — a chave nunca pode ir ao frontend. Hoje só o gerador local
   de texto existe e funciona (`utils/campaignText.ts`); o resto fica "Não conectado" de propósito, sem
   botão de mentira. Conectar isso é decisão de produto + infra, não de frontend.
8. Fase 7, o que falta: **enviar e agendar de verdade**. Hoje as automações são simulação local
   (`utils/automationEngine.ts`) — o dry-run mostra o que cada regra dispararia agora, mas nada sai.
   Executar exigiria um **scheduler** no servidor (pg_cron, fila ou Edge Function) que detecte o gatilho,
   um **provedor de envio** (SMTP, WhatsApp Cloud ou Web Push) e um **backend** que guarde as chaves, com
   idempotência/logs para não enviar duas vezes. É a mesma infra que destrava o convite por e-mail (item 3)
   e a confirmação de inscrição por e-mail/WhatsApp (item 5). Se um dia as regras precisarem persistir,
   aí sim uma tabela `automation_rules` com RLS por `automation.manage` — e, por mudar audiência de dado,
   com revisão de risco escrita e prova por mutação antes de ligar. Conectar envio é decisão de produto +
   infra, não de frontend.
9. Fase 8, o que falta: **organizações/redes de igrejas, suporte (chamados), integrações de provedor e
   segurança avançada (alertas de tentativas suspeitas)**. Nada disso existe nesta versão — cada um
   exigiria uma **migração nova** (tabelas `organizations`, `support_tickets`, logs de provedor) e, no
   caso das integrações e dos alertas, um **backend com as chaves**. Por isso as telas dizem "não existe
   ainda"/"Não conectado", sem número nem botão morto. O relatório também não tem recorte por período
   (reflete o estado atual) e não exporta PDF (exige geração no servidor). Tudo isso é decisão de
   produto + infra; o que a Fase 8 entrega é a leitura global real do que a RLS já devolve, gateada em
   `superadmin` e com projeção congelada.
10. Fase 9 (SEO, PWA, publicação) está **no ar**: https://igrejaconecta.vercel.app, com o Supabase
    real e o endereço canônico coerente nos quatro lugares (`site.ts`, `index.html`, `robots.txt`,
    `sitemap.xml`) desde 2026-11-12. O fluxo ponta a ponta (cadastro → onboarding → MFA → aprovação →
    evento publicado → campanha) foi validado no ar em 2026-11-13, depois de dois bloqueios corrigidos
    — ver [Dois bloqueios reais achados no ar](#dois-bloqueios-reais-achados-no-ar-2026-11-13). O que
    continua em aberto: um **domínio próprio** (trocar o
    endereço nos quatro lugares quando existir) e duas evoluções honestas como limites hoje — um
    **gerador de sitemap dinâmico** no build/servidor (para listar `/eventos/:slug` e `/igrejas/:slug`
    consultando o banco) e **OG por página via prerender/SSR** (para o cartão de rede por rota, que
    hoje é site-level). Nada disso é fingido como existente.
11. Rotação da chave `sb_secret_` antiga no painel do Supabase (ela nunca foi ao frontend nem ao
    Vercel, mas vale trocar por higiene).
