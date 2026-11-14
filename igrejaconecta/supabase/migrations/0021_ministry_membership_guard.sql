-- ============================================================================
-- 0021 — Líder e participante de ministério têm de ser da igreja
--
-- A 0015 criou `ministries.leader_id` e `ministry_members.user_id` apontando para
-- `profiles` sem conferir **de que igreja** é a pessoa. Sozinha, essa falta já
-- seria um problema de coerência (ministério com líder de fora). Aqui ela é de
-- **audiência**:
--
--   * `ministry_list` é `security_invoker = false` (decisão registrada na 0015),
--     então o `left join public.profiles l` roda com o privilégio do dono da view
--     e **não passa pela RLS de profiles**;
--   * a 0002 só deixa cada um ler o próprio perfil (`profiles_self_read`:
--     `id = auth.uid() or is_superadmin()`) — o nome dos colegas chega à tela
--     pela view `church_roster` (0007), com os contatos mascarados, e foi decisão
--     explícita não afrouxar `profiles`;
--   * consequência: quem tem `members.manage` podia escrever `leader_id` de
--     qualquer uuid e receber o `full_name` daquela pessoa na tela de ministérios
--     — um oráculo "uuid para nome" sobre contas de outras igrejas e de qualquer
--     usuário da plataforma.
--
-- A guarda fecha a **escrita**, não a leitura: a view continua como a 0015 a
-- deixou (mesmo caminho do `church_roster`), e passa a ser segura porque o que
-- entra em `leader_id` é, obrigatoriamente, membro **ativo** da igreja do
-- ministério — exatamente o conjunto de pessoas que a própria view já mostraria
-- a essa igreja. Nada é ampliado: `ministries_read` continua por vínculo ativo,
-- `ministry_members` continua sem update, e `anon` continua sem grant nenhum.
--
-- Por que trigger e não política: a checagem precisa olhar **duas** tabelas
-- (a igreja do ministério e o vínculo da pessoa) e vale tanto para
-- `ministries.leader_id` quanto para `ministry_members.user_id`. Em política, o
-- `WITH CHECK` com subquery em `church_members` é possível, mas deixaria o
-- `UPDATE leader_id` sem par (a política de update já tem outra regra) e não
-- cobre o caminho de quem escreve por fora do RLS. O padrão da casa é a função
-- `SECURITY DEFINER` com `search_path` fixo, como `enforce_event_branch` (0013).
--
-- Mensagens e códigos, iguais aos dos outros guardas: `42501` quando a pessoa
-- existe mas não é da igreja (recusa de permissão/audiência) e `23503` quando o
-- uuid não é nem um perfil (referência quebrada).
-- ============================================================================

-- O líder tem de ser membro ativo da igreja do ministério ---------------------
create or replace function public.enforce_ministry_leader()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_exists boolean;
  is_active_member boolean;
begin
  if new.leader_id is null then
    return new;
  end if;

  select exists (select 1 from public.profiles p where p.id = new.leader_id) into profile_exists;
  if not profile_exists then
    raise exception 'o lider indicado nao e uma conta desta plataforma'
      using errcode = '23503';
  end if;

  select exists (
    select 1 from public.church_members cm
    where cm.church_id = new.church_id
      and cm.user_id = new.leader_id
      and cm.status = 'active'
  ) into is_active_member;

  if not is_active_member then
    raise exception 'o lider do ministerio precisa ser membro ativo da mesma igreja'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ministries_leader on public.ministries;
create trigger trg_ministries_leader
  before insert or update of leader_id, church_id on public.ministries
  for each row execute function public.enforce_ministry_leader();

-- O participante também ------------------------------------------------------
-- Sem update aqui: a tabela só tem política de insert e delete (0015), e o par
-- (ministério, pessoa) é a chave primária — trocar pessoa é apagar e inserir.
create or replace function public.enforce_ministry_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ministry_church uuid;
  is_active_member boolean;
begin
  select church_id into ministry_church from public.ministries where id = new.ministry_id;
  if ministry_church is null then
    raise exception 'o ministerio indicado nao existe'
      using errcode = '23503';
  end if;

  select exists (
    select 1 from public.church_members cm
    where cm.church_id = ministry_church
      and cm.user_id = new.user_id
      and cm.status = 'active'
  ) into is_active_member;

  if not is_active_member then
    raise exception 'o participante do ministerio precisa ser membro ativo da igreja do ministerio'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ministry_members_member on public.ministry_members;
create trigger trg_ministry_members_member
  before insert on public.ministry_members
  for each row execute function public.enforce_ministry_member();

-- `from public` sozinho não basta: o Supabase (e o shim local) concedem EXECUTE
-- por default privileges a anon/authenticated/service_role. Listar os papéis é o
-- que fecha de verdade — e é higiene, não barreira: função de trigger não pode
-- ser chamada diretamente por quem escreve SQL pela API.
revoke execute on function public.enforce_ministry_leader() from public, anon, authenticated;
revoke execute on function public.enforce_ministry_member() from public, anon, authenticated;
