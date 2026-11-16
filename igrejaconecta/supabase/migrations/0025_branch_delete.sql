-- ============================================================================
-- 0025 — Excluir filial (church_branches: grant + política de delete)
--
-- A 0013 (decisão 3) fechou o delete de propósito e escreveu o contrato para
-- reabri-lo: "se um dia a tela oferecer 'excluir filial', as duas camadas têm
-- de ser abertas de propósito, com caso na suíte". É o que acontece aqui, a
-- pedido da auditoria de lacunas (grupo 4).
--
-- Decisões, e o porquê:
--
-- 1) **`church.manage`, a mesma régua de quem cadastra e edita.** Filial é
--    dado de cadastro da igreja (decisão 2 da 0013); excluir não é uma
--    operação de poder diferente de editar. Nenhuma permissão nova nasce aqui,
--    e `has_church_permission` já traz o SuperAdmin no bojo (0001) — a mesma
--    razão pela qual insert/update não precisam de ramo `is_superadmin()`.
--
-- 2) **`using` sem `with check`.** Delete não produz valor novo; a única
--    pergunta é se a linha alcançável é administrável por quem pede. Quem é de
--    fora não alcança a linha pela política e o comando devolve **zero linhas**
--    — sem erro e sem oráculo de existência, o mesmo comportamento do UPDATE
--    cruzado medido no caso O5.
--
-- 3) **Excluir filial não apaga nada junto**, e isso não é uma promessa vazia:
--    são as FKs que já existem. `events.branch_id` (0013) e
--    `church_service_times.branch_id` (0023) são `on delete set null` — os
--    eventos e horários sobrevivem como "sem filial". O caminho contrário
--    (apagar os eventos junto) destruiria inscrições reais para corrigir um
--    cadastro, e por isso a 0013 escolheu set null na origem. A UI avisa isso
--    antes de confirmar; o caso O11 da suíte mede.
--
-- 4) **Grant re-declarado por inteiro** (`select, insert, update, delete`)
--    porque `grant` é aditivo e idempotente — reescrever a lista deixa a
--    migração relável em uma leitura só, sem depender do estado anterior.
--
-- 5) O `church_id in (select current_church_ids())` da política de leitura não
--    serve de guarda de delete: quem é **membro** lê filiais, quem **administra**
--    apaga. São conjuntos diferentes de propósito (O4 mede a leitura sem
--    escrita), e a política de delete usa só o segundo.
-- ============================================================================

revoke all on public.church_branches from anon, authenticated;
grant select, insert, update, delete on public.church_branches to authenticated;

drop policy if exists church_branches_delete on public.church_branches;
create policy church_branches_delete on public.church_branches
  for delete to authenticated
  using (public.has_church_permission(church_id, 'church.manage'));
