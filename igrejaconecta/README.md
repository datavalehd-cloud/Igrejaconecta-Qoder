# IgrejaConecta

Plataforma que conecta igrejas e visitantes: gestão de eventos, localização, divulgação
digital e inteligência artificial. **Sem cobrança, assinaturas ou faturamento** nesta versão.

> Status atual: **Fase 1 fechada (Auth real plugável + isolamento verificado), Fase 2 escrevendo
> no banco, Fase 3 com eventos e inscrições reais, Fase 4 com filiais, localização e mapa real,
> Fase 5 com campanhas de divulgação no banco + distribuição sem chave, Fase 6 com o gerador
> local de texto de campanha (sem IA e sem chave), Fase 7 com automações em simulação local
> (liga/desliga + dry-run, nada envia) e Fase 8 com o painel do SuperAdmin lendo o que a RLS já
> devolve — diretório global de usuários, eventos de todas as igrejas, relatórios agregados e CSV,
> sem migração nem política nova, e o que não existe diz "não conectado"** —
> Supabase Auth (login, cadastro, recuperação,
> confirmação, redefinição e MFA TOTP) ligado por uma camada única (`AuthBackend`); a suíte de RLS
> roda num Postgres real com `npm run test:rls` (827 declarações, grupos A–P, sem Docker e sem projeto).
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
> mesmo interruptor
> demo/real. Sem chaves no `.env.local` o app roda em **modo demo** com dados fictícios; com as
> chaves, usa o provedor real sem mudar uma linha de tela.

## Stack

- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4
- React Router 7
- Supabase (Auth + PostgreSQL + Storage) — plugável via `.env.local`
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
npm test           # 381 testes unitários (Vitest): RBAC, utils, serviços, motores locais e o contrato das migrações
npm run test:rls   # suíte de isolamento num Postgres embarcado (sem Docker, sem projeto Supabase)
```

### Contas de demonstração (senha: `demo1234`)

| E-mail | Papel | Acesso |
|--------|-------|--------|
| `admin@igrejaconecta.app` | SuperAdmin | `/admin` (exige MFA — qualquer código de 6 dígitos no demo) |
| `marcos@ibcentral.org.br` | Administrador da igreja | `/app` (exige MFA) |
| `ana@ibcentral.org.br` | Gerente | `/app` |
| `paula@ibcentral.org.br` | Comunicador | `/app` — cria e edita evento, **não** publica; sem inscrições |
| `visitante@email.com` | Visitante | portal público |

No painel, o menu do usuário permite **trocar de papel** para explorar as telas e validar RBAC.

## Conectando o Supabase (sair do modo demo)

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
   - `supabase/seed.sql` (papéis, permissões e matriz RBAC)
4. No painel do Supabase, em **Authentication → URL Configuration**, adicione:
   - Site URL: `http://localhost:5173`
   - Redirect URLs: `http://localhost:5173/login` e `http://localhost:5173/redefinir-senha`
     (confirmação de e-mail volta para `/login`; recuperação de senha volta para `/redefinir-senha`).
5. Em **Authentication → MFA Factors**, habilite **TOTP** (o app usa `factorType: 'totp'`).
6. Crie o primeiro usuário (SuperAdmin) — pelo cadastro do app ou manualmente no painel — e
   registre a associação em `church_members` com o `role_id` correspondente ao papel. Sem
   associação ativa, o usuário entra como **visitante**.
7. Reinicie o dev server. `src/services/supabase/client.ts` detecta as chaves e o
   `AuthContext` troca automaticamente para o backend real.

### O que muda do demo para o real

| Fluxo | Modo demo | Modo Supabase |
|-------|-----------|---------------|
| Login | contas fixas + qualquer código de 6 dígitos | `signInWithPassword`; MFA real via `challengeAndVerify` |
| Papel / igreja | tabela fixa | lido de `profiles` + `church_members`/`roles` (sob RLS) |
| Cadastro | sempre "envia e-mail" | `signUp`; pula a confirmação se o projeto não exige |
| Recuperação | simulada | `resetPasswordForEmail` + página `/redefinir-senha` (`updateUser`) |
| MFA | sempre "ativo" para admin | QR Code + segredo reais em `/app/perfil`; sem fator ativo o painel fica bloqueado |
| Trocar papel | menu no topo | oculto (não faz sentido com contas reais) |
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
| Quem pode escrever | checado na loja demo (`members.manage`) | decidido pelo RLS e pelos triggers; o erro do banco é o que aparece |

Em modo demo as escritas vivem **só enquanto a página estiver aberta** (memória do módulo, sem
`localStorage`): o recarregar volta aos mocks. O caminho real é o que a suíte de RLS prova.

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
    church/      # painel da igreja (fases 2, 3, 5, 6, 7)
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
  contexts/      # AuthContext (sessão + RBAC, backend plugável demo/Supabase)
  services/
    supabase/    # client plugável
    auth/        # authTypes (contrato) + demoBackend + supabaseBackend + authService
    data/        # rosterService (view church_roster), memberService (convites, papéis, aceite),
                 # churchService (diretório público, lista de gestão, igrejas da conta),
                 # churchApprovalService (escrita de approval_status pelo SuperAdmin),
                 # auditService (verbos e leitura da trilha; a escrita real é do trigger 0009),
                 # eventService (diretório público, evento por slug, agenda da igreja, categorias e a
                 # agenda global do SuperAdmin), registrationService (inscrição do visitante, lista da
                 # equipe, contagens, check-in e cancelamento — toda escrita por RPC) e adminService
                 # (diretório global de vínculos do SuperAdmin, Fase 8 — gate + projeção congelada)
  types/         # modelo de domínio
  utils/         # rbac, format, cn, geo (haversine/distância), share (distribuição sem chave),
                 # campaignText (gerador local de texto, Fase 6), automationEngine (motor local de
                 # simulação de automações, Fase 7) e reports (agregação + CSV do relatório global do
                 # SuperAdmin, Fase 8) e seo (canonical, OG/Twitter, robots e JSON-LD puros, Fase 9)
                 # — os quatro últimos sem chave, sem provedor e sem fetch
  data/          # mocks
  routes/        # AppRoutes + guards (ProtectedRoute)
supabase/
  migrations/    # schema + RLS + storage + hardening + guards (0004..0012)
  functions/     # Edge Functions (fases 5-8, a implementar)
  tests/
    database/    # rls_isolation.sql — suíte de isolamento (roda local e no projeto)
    local/       # shim_supabase.sql — emula auth.*/storage.* só para o Postgres local
  seed.sql
scripts/
  rls-local.mjs  # sobe Postgres embarcado (sem Docker) e roda a suíte
  make-pwa-icons.ps1  # gera icon-192/512, maskable-512, apple-touch-icon e og-image
                      # a partir da geometria do favicon (System.Drawing; Fase 9)
public/
  favicon.svg + icon-192/512.png, maskable-512.png, apple-touch-icon.png, og-image.png  # marca (Fase 9)
  robots.txt, sitemap.xml, manifest.webmanifest, sw.js  # SEO/PWA crawler-visible (Fase 9)
tests/           # unit / integration / e2e
  unit/          # rbac, format, roster, memberWrites, churchLists, events (paridade demo x RLS,
                 # projeções e anti-deriva contra os grupos I/M), registrations (contrato da 0012,
                 # projeção, RPCs e loja demo contra o grupo N), churchApproval, auditTrail,
                 # geo (haversine/distância) e branches (Fase 4, grupo O), marketing (Fase 5, grupo P)
                 # e share (distribuição sem chave), campaignText (Fase 6, gerador local) e
                 # automationEngine (Fase 7, motor de simulação — inclusive a fronteira "nenhum segredo
                 # na fonte"), admin (Fase 8, leituras globais: gate superadmin, projeção anti-deriva,
                 # políticas reais que amparam a leitura, agregação e CSV) e schemaSecurity (guarda do
                 # service_role) e seo (Fase 9: canonical/OG/robots/JSON-LD puros + presença e
                 # anti-deriva dos estáticos index.html, robots, sitemap, manifest, sw e main)
```

## Rotas principais

- Público: `/`, `/eventos`, `/eventos/:slug`, `/igrejas`, `/mapa`, `/categorias`, `/buscar`, `/visitante/perfil`
- Auth: `/login`, `/cadastro`, `/recuperar-senha`, `/redefinir-senha`, `/confirmar-email`
- Igreja: `/app`, `/app/igreja`, `/app/filiais`, `/app/usuarios`, `/app/ministerios`, `/app/horarios`, `/app/eventos`, `/app/calendario`, `/app/inscricoes`, `/app/checkin`, `/app/marketing`, `/app/redes`, `/app/ia`, `/app/automacoes`, `/app/perfil`
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
`src/services/data/rosterService.ts` — no modo real `select ... from church_roster where church_id =
sessão`, no modo demo `demoRoster()` com a **mesma** regra (só ativos, contatos mascarados sem
`members.manage`), para que a demo não mostre nada que o banco não mostraria. A rota **deixou de exigir
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
`describeDbError`. Em modo demo a loja do módulo espelha as mesmas recusas, e `tests/unit/memberWrites.test.ts`
confere cada espelho contra o caso de RLS correspondente. Reversão: `drop table public.church_invitations;
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

Onde a ligação real teria introduzido uma mentira, a tela agora mostra `—`: a contagem de eventos do mapa,
e os zeros de Eventos/Inscrições/Membros e "2 filiais cadastradas" no painel da igreja, porque essas
tabelas ainda são mock em modo real. (Eventos passou a ler o banco na Fase 3, passo 1, Inscrições a ler
e escrever no passo 2 e o formulário de eventos a escrever no passo 3; Membros, Campanhas e filiais
seguem mock — e é só para elas que o `—` continua valendo.)
Os botões Aprovar/Suspender/Rejeitar do SuperAdmin ficaram
desabilitados com o motivo na tela durante este passo — a escrita deles é o passo 4, logo abaixo.
Reversão: as telas voltam a `import { churches } from '@/data/mock'` (uma linha por tela) e o
`churchService` fica parado sem efeito nenhum; para desfazer só a parte honesta dos `—`, troque
`mode === 'supabase'` por `false` em `pendingWiring` (`ChurchDashboardPage`) e `countEvents`
(`ChurchMapPage`) — o que ela volta a mostrar são números falsos.

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

Em modo demo não há banco, então o serviço espelha as duas guardas: recusa quem não é `superadmin`
com a mesma mensagem do `42501`, e `demoDirectoryChurches()` lê o mesmo array, então aprovar na tela
de gestão aparece no diretório público.

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
`igreja.em_analise` e `igreja.pendente`. `auditService` cuida da leitura e dos verbos do espelho demo.
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
- O demo prepara a trilha e só altera a igreja após adicioná-la, sem `await` entre essas operações;
  falha de preparação não muda a igreja. Tudo fica em memória e reload restaura os exemplos.
- Implementação e execução **somente locais**. Ainda não há projeto Supabase para validar o
  caminho completo no provedor; nenhuma migração foi aplicada remotamente e nada foi publicado.

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
- CHECK de contenção em `networks` (só instagram/facebook/tiktok/whatsapp) e em `status` (draft/
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
- Implementação e execução **somente locais**: a 0014 não foi aplicada em projeto remoto. Aplique-a antes
  de usar este frontend em um projeto real, junto com 0011, 0012 e 0013.

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
  botão morto "Ver logs".
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
rewrites, então cada arquivo continua exato. **Nada disso foi publicado**; o deploy só acontece após
você digitar **"publica"**.

Ordem para ir ao ar (o passo 1 é seu — criar o projeto Supabase e colar as chaves):

1. Criar o projeto no [supabase.com](https://supabase.com), aplicar `supabase/migrations/*` (0001–0014)
   e colar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (a **anon pública**) no `.env.local`. A
   `service_role` **nunca** vai ao frontend nem ao Vercel. Rode `npm run test:rls` contra o projeto
   real antes de qualquer deploy (ver seção de RLS).
2. `npm run build` gera `dist/` (estáticos já incluídos). Confira o build com `npm run preview`.
3. Definir `VITE_SITE_URL` com o domínio real e trocar o domínio hardcoded em `index.html`,
   `public/robots.txt` (linha `Sitemap:`) e `public/sitemap.xml` para concordarem com ele.
4. No projeto Vercel (team data14), configurar **as mesmas variáveis** `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY` e `VITE_SITE_URL` — pelo painel/CLI do Vercel, **por você**, nunca via
   agente (segredos não passam pelo agente). O Vercel injeta no build; não commitamos `.env`.
5. Publicar só após o seu "publica" — até lá o app continua local e em modo demo.

## Testes de RLS e isolamento entre igrejas

**827 declarações (grupos A–P)** em `supabase/tests/database/rls_isolation.sql`, executados contra
um Postgres 18.6 real. Rodam **agora, sem projeto Supabase e sem Docker**:

```bash
npm run test:rls      # sobe Postgres embarcado, aplica shim + migrações + seed e roda a suíte
```

O que é verificado:

| Grupo | Cenário |
|-------|---------|
| A | visitante anônimo não vê roster, perfis, logs, config — nem igreja pendente |
| B | membro da igreja A lê só A (igrejas, membros, perfis, auditoria, permissões); SuperAdmin lê tudo |
| C | escrita cruzada e escalada: convite em outra igreja, renomear/alvará de terceiros, autoaprovação, forjar auditoria, editar perfil alheio, excluir membros de fora, mexer em config, **se promover SuperAdmin** e remover o SuperAdmin real |
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
  asserção "nenhum segredo na fonte". Ainda sem ligar no banco: a leitura **global** de eventos no painel
  do SuperAdmin (hoje `—`).

Para rodar no projeto real, quando ele existir: aplique as migrações 0001→0012 e o seed, cole o
conteúdo de `rls_isolation.sql` no **SQL Editor** e execute — ou, com a CLI:

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
| 2 | Igrejas, filiais, usuários, equipes, aprovação | Usuários lendo **e escrevendo** no banco (view 0007 + convites 0008); listas de igrejas lendo o real (`churchService`) e a aprovação escrevendo o real (`churchApprovalService`, grupo J), com trilha atômica no banco e leitura de auditoria (`auditService`, grupos K e L, migração 0009); **filiais lendo e escrevendo** (0013 + `branchService`, grupo O — sem delete); equipes mockadas |
| 3 | Eventos, calendário, inscrições, check-in, portal | Eventos **lendo e escrevendo** (0011 + `eventService`, grupo M) e inscrições **lendo e escrevendo** (0012 + `registrationService`, grupo N): criação/edição/transição de status com a porta `events.publish`, inscrição pública com lista de espera, contagem real de inscritos, lista/CSV da equipe, check-in por código e cancelamento com promoção da fila. **Filial e localização no evento gravam** (0013, M11). Falta upload de capa no Storage e o QR Code impresso |
| 4 | Google Maps, GPS, localização | **Mapa público real**: Leaflet + OpenStreetMap (decisão sua, sem chave), GPS do navegador **sem geocodificador**, distância por haversine, ordenação por proximidade e botão Rota. Só é plotada igreja com coordenada real; sem coordenada a lista avisa e o pino não é inventado; sem rede os tiles falham com aviso honesto. Coordenadas também são digitáveis nos formulários de igreja, filial e evento |
| 5 | Divulgação social (Meta/TikTok/WhatsApp) | Campanhas **lendo e escrevendo** no banco (0014 + `marketingService`, grupo P) com RLS por `marketing.manage` e o trigger que **só deixa `service_role` publicar** — o botão Publicar devolve aviso honesto e não marca nada. Distribuição **sem chave** real (WhatsApp/wa.me, copiar link com UTM, Web Share) no painel e na página pública do evento. `/app/redes` mostra todas as contas como **Não conectado**, sem botão de conectar de mentira. Postagem real em rede fica de fora (exige OAuth + backend com tokens) |
| 6 | IgrejaConecta AI | **Gerador de texto de campanha local** (`utils/campaignText.ts`, sem IA e sem chave): monta nome, mensagem e hashtags com os dados reais do evento, roda no navegador e salva como rascunho pela mesma porta `marketing.manage` + RLS da 0014. Ligado ao formulário de campanha (**Gerar sugestão**) e à página `/app/ia` (**Gerar texto** + **Criar rascunho**). Artes, vídeos e IA de provedor seguem **Não conectado** — exigem backend que guarde `OPENAI_API_KEY` (a chave nunca vai ao frontend); nada é fingido |
| 7 | Automações e notificações | **Automações em simulação local** (`utils/automationEngine.ts`, sem provedor e sem chave): motor puro calcula **o que cada regra dispararia agora** com os eventos e inscrições reais da igreja e mostra a mensagem que *seria* enviada. `/app/automacoes` liga/desliga cada regra (interruptor funcional que muda o dry-run na hora) e traz contadores honestos — **Envios reais = 0 · não conectado**. Canais (SMTP/WhatsApp/Push/Interno) e execução/agendamento ficam **Não conectado**: disparar de verdade exige scheduler no servidor + provedor de envio + backend com as chaves, e nada disso existe aqui. Regras em estado local/sessão (sem tabela). Nada envia, agenda ou executa; nada é fingido |
| 8 | SuperAdmin, relatórios, segurança avançada | Painel do SuperAdmin **lendo o que a RLS já devolve** (`is_superadmin()`), sem migração nem política nova: diretório global de usuários (`adminService`, projeção congelada que não vaza `role_id`), eventos de todas as igrejas (`eventService.fetchAllEvents`), relatórios agregados + CSV (`utils/reports.ts`) e dashboard com contagens reais — tudo gateado em `superadmin` antes de consultar (defesa em profundidade; a política no banco é a 2ª camada). Organizações, Suporte, Integrações, Monitoramento, exportar PDF e receita/IA seguem **"não conectado"/"não existe ainda"**, sem número nem botão morto. "Segurança avançada" (alertas de tentativas suspeitas) não existe aqui e diz "Não conectado" |
| 9 | Testes gerais, SEO, PWA, publicação | **SEO + PWA completos, preparados sem publicar**: `index.html` com OG/Twitter/canonical/theme-color/JSON-LD (Organization+WebSite) crawler-visible; `robots.txt`, `sitemap.xml` (só rotas fixas) e `manifest.webmanifest` reais; ícones PWA + `og-image.png` derivados do favicon (`scripts/make-pwa-icons.ps1`); `useDocumentMeta` aplica title/canonical/robots/JSON-LD por rota (schema.org/Event no detalhe, `noindex` em login e painéis); `sw.js` pré-cacheia o shell e só registra em produção, sem cachear dado de provedor nem `/app`/`/admin`. Testes unitários (`tests/unit/seo.test.ts`) + prova por mutação M1–M7 + verificação no build de produção. **Publicar** fica atrás do seu "publica": falta host estático + projeto Supabase real + `VITE_SITE_URL`/domínio (passo a passo na seção da Fase 9) |

## Próximos passos

1. Repetir a suíte de isolamento no projeto Supabase real (`npm run test:rls` já cobre o local)
   assim que as migrações 0001→0012 forem aplicadas lá.
2. Trocar mocks por consultas via `supabase` tela a tela. **Feito: roster e convites/Usuários
   (Fase 2, passos 1 e 2) — leitura e escrita —, as listas de igrejas (passo 3) — leitura —, a
   aprovação do SuperAdmin (passo 4) — escrita —, sua auditoria (passo 5) — escrita e leitura —,
   eventos (Fase 3, passos 1 e 3) — leitura e escrita —, inscrições (passo 2) — leitura e escrita —,
   filiais e localização (Fase 4) — leitura e escrita —, campanhas (Fase 5) — leitura e escrita, com a
   publicação bloqueada no banco — e as leituras globais do SuperAdmin (Fase 8) — diretório de usuários,
   eventos de todas as igrejas e relatórios agregados, gateadas em `superadmin`.**
   o padrão de leitura está em `services/data/churchService.ts`, `eventService.ts`,
   `registrationService.ts`, `branchService.ts`, `marketingService.ts` e `adminService.ts` (e em
   `rosterService.ts`), o de escrita em `memberService.ts`, `churchApprovalService.ts`, `eventService.ts`,
   `branchService.ts` e `marketingService.ts`, e o de escrita que **só** existe por RPC em
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
   mesmo provedor real do item 3.
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
10. Fase 9 (SEO, PWA, publicação) está **preparada sem publicar**: falta só o ato de publicar, que é
    seu — host estático com `dist/`, projeto Supabase real com as migrações, e `VITE_SITE_URL` + o
    domínio trocado em `index.html`/`robots.txt`/`sitemap.xml` (passo a passo na seção da Fase 9).
    Duas evoluções possíveis depois, ambas honestas como limites hoje: um **gerador de sitemap
    dinâmico** no build/servidor (para listar `/eventos/:slug` e `/igrejas/:slug` consultando o banco)
    e **OG por página via prerender/SSR** (para o cartão de rede por rota, que hoje é site-level).
    Nada disso é fingido como existente.
