import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const PENDING = [
  '0015_ministries_and_social_accounts.sql',
  '0016_visitor_favorites_preferences.sql',
  '0017_church_networks.sql',
  '0018_support_tickets.sql',
  '0019_security_events.sql',
  '0020_drop_tiktok_from_campaigns.sql',
  '0021_ministry_membership_guard.sql',
]

const sources = PENDING.map((file) => ({ file, sql: readFileSync(path.join(root, 'supabase', 'migrations', file), 'utf8') }))

const declared = { policies: [], triggers: [], functions: [], tables: [] }
for (const { sql } of sources) {
  for (const m of sql.matchAll(/create policy\s+(\w+)\s+on\s+(?:public\.)?(\w+)/gi)) {
    declared.policies.push({ name: m[1], table: m[2] })
  }
  // `create trigger trg_x before update on public.y` — o tempo fica entre o nome e
  // a tabela, e a declaração pode quebrar linha: a tabela é o ` on ` mais próximo.
  for (const m of sql.matchAll(/create trigger\s+(\w+)\b[^;]*?\son\s+(?:public\.)?(\w+)/gi)) {
    declared.triggers.push({ name: m[1], table: m[2] })
  }
  for (const m of sql.matchAll(/create or replace function\s+public\.(\w+)/gi)) {
    declared.functions.push(m[1])
  }
  for (const m of sql.matchAll(/create table if not exists public\.(\w+)/gi)) {
    declared.tables.push(m[1])
  }
}

const quote = (values) => values.map((v) => `'${v}'`).join(',')
// Lista de VALUES sem o "(" de fora: entra em `from (values ${rows(...)}) as want(t)`.
const rows = (values) => values.map((v) => `('${v}')`).join(', ')
const pairRows = (list, key) => list.map((i) => `('${i.table}','${i[key]}')`).join(', ')

// Um CHECK por migração sensível: os grants do visitante e o CHECK de campanha são
// a superfície inteira dessas tabelas, e nenhum dos dois aparece em tabela nova.
const guards = `
  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'visitor_favorites'
    and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if n <> 0 then
    raise exception 'M7-FALHA: visitor_favorites recebeu UPDATE (a 0016 nao da update)';
  end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'visitor_preferences'
    and grantee = 'authenticated' and privilege_type = 'DELETE';
  if n <> 0 then
    raise exception 'M7-FALHA: visitor_preferences recebeu DELETE (a 0016 nao da delete)';
  end if;

  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'security_events'
    and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE','DELETE');
  if n <> 0 then
    raise exception 'M7-FALHA: security_events escrevivel pela API (so service_role escreve)';
  end if;

  select pg_get_constraintdef(oid) into v
  from pg_constraint
  where conrelid = 'public.marketing_campaigns'::regclass
    and conname = 'marketing_campaigns_networks_check';
  if v is null then
    raise exception 'M7-FALHA: marketing_campaigns_networks_check nao existe';
  end if;
  if v like '%tiktok%' or v not like '%instagram%' or v not like '%facebook%' or v not like '%whatsapp%' then
    raise exception 'M7-FALHA: CHECK de redes de campanha fora do esperado: %', v;
  end if;

  -- A 0021 so existe de fato se os dois triggers estiverem ATTACHED a uma tabela
  -- real e apontando para a propria funcao de guarda.
  select count(*) into n from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and t.tgname in ('trg_ministries_leader','trg_ministry_members_member')
    and p.proname in ('enforce_ministry_leader','enforce_ministry_member');
  if n <> 2 then
    raise exception 'M7-FALHA: guarda de ministerio (0021) nao esta attachada (% dos 2)', n;
  end if;
`

const verify = `
-- ---------------------------------------------------------------------------
-- Verificacao, dentro da MESMA transacao do apply: tudo o que os arquivos declaram
-- tem de existir. Faltou um, o RAISE desfaz o apply inteiro e o banco no ar nunca
-- fica num meio-termo que nenhum teste local mediu.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
  n int;
  v text;
begin
  select string_agg(t, ', ') into missing
  from (values ${rows(declared.tables)}) as want(t)
  where to_regclass('public.' || want.t) is null;
  if missing is not null then
    raise exception 'M7-FALHA: tabelas ausentes apos o apply: %', missing;
  end if;

  select string_agg(w.table_name || '.' || w.policy_name, ', ') into missing
  from (values ${pairRows(declared.policies, 'name')}) as w(table_name, policy_name)
  left join pg_policies p
    on p.schemaname = 'public' and p.tablename = w.table_name and p.policyname = w.policy_name
  where p.policyname is null;
  if missing is not null then
    raise exception 'M7-FALHA: politicas ausentes: %', missing;
  end if;

  select string_agg(w.table_name || '.' || w.trigger_name, ', ') into missing
  from (values ${pairRows(declared.triggers, 'name')}) as w(table_name, trigger_name)
  left join pg_trigger t
    on t.tgrelid = ('public.' || w.table_name)::regclass and t.tgname = w.trigger_name and not t.tgisinternal
  where t.tgname is null;
  if missing is not null then
    raise exception 'M7-FALHA: triggers ausentes: %', missing;
  end if;

  select string_agg(f, ', ') into missing
  from (values ${rows(declared.functions)}) as want(f)
  where not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = want.f
  );
  if missing is not null then
    raise exception 'M7-FALHA: funcoes ausentes: %', missing;
  end if;
${guards}
  raise notice 'M7-OK: % tabelas, % politicas, % triggers, % funcoes conferidos',
    ${declared.tables.length}, ${declared.policies.length}, ${declared.triggers.length}, ${declared.functions.length};
end $$;
`

const body = sources
  .map(({ file, sql }) => `-- ===================== ${file} =====================\n${sql.trim()}\n`)
  .join('\n')

const policyTables = [...new Set(declared.policies.map((p) => p.table))]

const out = `-- GERADO POR scripts/m7-bundle.mjs — nao editar a mao.
-- Aplica no projeto Supabase real as migrações que ainda não estão lá (0015..0021)
-- e confere o resultado DENTRO da mesma transação: se faltar qualquer objeto
-- declarado pelos arquivos, ou se algum grant estiver mais aberto do que a migração
-- manda, o apply INTEIRO é desfeito e o banco continua como estava.
--
-- Como rodar: cole este arquivo inteiro no SQL Editor do projeto real e execute.
-- Ele não apaga dado nenhum. Cria tabelas, políticas, triggers e views; o único
-- objeto existente que ele toca é o CHECK de redes de campanha (0020), que passa a
-- aceitar só instagram/facebook/whatsapp. Se existir campanha com 'tiktok', o
-- re-criar do CHECK falha e nada é aplicado — é o comportamento correto.

select current_database() as banco, current_user as usuario, version();

select count(*) as igrejas_no_banco from public.churches;
select count(*) as campanhas_com_tiktok from public.marketing_campaigns where 'tiktok' = any (networks);
select to_regclass('public.ministries') is not null as ministerios_ja_existem,
       to_regclass('public.visitor_favorites') is not null as favoritos_ja_existem,
       to_regclass('public.security_events') is not null as seguranca_ja_existe;

begin;

${body}
${verify}
commit;

-- Inventario depois do commit — é isto que é preciso conferir antes de publicar.
select 'tabela' as objeto, table_name as nome, 'existe' as estado
from information_schema.tables
where table_schema = 'public' and table_name in (${quote(declared.tables)})
order by table_name;

select tablename as tabela, count(*) as politicas
from pg_policies where schemaname = 'public' and tablename in (${quote(policyTables)})
group by tablename order by tablename;

select tgname as trigger, tgrelid::regclass as em_tabela
from pg_trigger
where not tgisinternal and tgname in (${quote(declared.triggers.map((t) => t.name))})
order by tgname;

select conname as constraint, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid in ('public.marketing_campaigns'::regclass, 'public.ministries'::regclass) and contype = 'c'
order by conname;

select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('visitor_favorites','visitor_preferences','security_events','ministries','ministry_members','church_social_accounts')
group by grantee, table_name order by table_name, grantee;

select count(*) as papeis_do_seed from public.roles;
select count(*) as permissoes_do_seed from public.permissions;
`

mkdirSync(path.join(root, 'supabase', 'deploy'), { recursive: true })
const target = path.join(root, 'supabase', 'deploy', 'm7_apply.sql')
// O hash vai no próprio arquivo e no console: é o que amarra o que foi colado no
// editor à versão das migrações que a suíte mediu aqui. Sem ele, ninguém prova
// depois que o banco no ar veio deste texto.
const before = createHash('sha256').update(`${sources.map((s) => s.sql).join('\n')}\n${out}`).digest('hex')
writeFileSync(target, `-- sha256 (conteudo das migrações + corpo): ${before}\n${out}`)
console.log(
  `supabase/deploy/m7_apply.sql — ${sources.length} migrações, ` +
    `${declared.tables.length} tabelas, ${declared.policies.length} políticas, ` +
    `${declared.triggers.length} triggers, ${declared.functions.length} funções conferidas\n` +
    `  sha256: ${before}`,
)
