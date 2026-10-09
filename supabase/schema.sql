-- Run this file in the SQL Editor of a dedicated Supabase project.
-- Tables are private: anonymous callers can use only the four token-checked RPCs.
create schema if not exists checklist_private;
revoke all on schema checklist_private from public, anon, authenticated;

create table if not exists checklist_private.checklists (
  id uuid primary key,
  admin_hash text not null,
  edit_hash text not null,
  document jsonb not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table checklist_private.checklists enable row level security;
revoke all on checklist_private.checklists from public, anon, authenticated;

create or replace function checklist_private.token_hash(value text)
returns text language sql immutable strict set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(value, 'UTF8')), 'hex');
$$;

create or replace function checklist_private.valid_document(doc jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  section jsonb;
  task jsonb;
  section_ids text[] := '{}';
  task_ids text[];
  task_count integer := 0;
begin
  if doc is null or jsonb_typeof(doc) <> 'object' or octet_length(doc::text) > 262144
    or jsonb_typeof(doc->'title') is distinct from 'string'
    or length(btrim(doc->>'title')) = 0 or length(doc->>'title') > 120
    or jsonb_typeof(doc->'sections') is distinct from 'array' then return false; end if;
  if jsonb_array_length(doc->'sections') > 100 then return false; end if;
  for section in select value from jsonb_array_elements(doc->'sections') loop
    if jsonb_typeof(section) <> 'object'
      or jsonb_typeof(section->'id') is distinct from 'string'
      or length(btrim(section->>'id')) = 0 or length(section->>'id') > 100
      or (section->>'id') = any(section_ids)
      or jsonb_typeof(section->'title') is distinct from 'string'
      or length(btrim(section->>'title')) = 0 or length(section->>'title') > 120
      or jsonb_typeof(section->'tasks') is distinct from 'array' then return false; end if;
    section_ids := array_append(section_ids, section->>'id');
    if jsonb_array_length(section->'tasks') > 500 then return false; end if;
    task_ids := '{}';
    for task in select value from jsonb_array_elements(section->'tasks') loop
      task_count := task_count + 1;
      if task_count > 2000 or jsonb_typeof(task) <> 'object'
        or jsonb_typeof(task->'id') is distinct from 'string'
        or length(btrim(task->>'id')) = 0 or length(task->>'id') > 100
        or (task->>'id') = any(task_ids)
        or jsonb_typeof(task->'text') is distinct from 'string'
        or length(btrim(task->>'text')) = 0 or length(task->>'text') > 2000
        or jsonb_typeof(task->'done') is distinct from 'boolean'
        or jsonb_typeof(task->'comment') is distinct from 'string'
        or length(task->>'comment') > 10000 then return false; end if;
      task_ids := array_append(task_ids, task->>'id');
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function checklist_private.snapshot(c checklist_private.checklists, token text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('document', c.document, 'revision', c.revision,
    'updatedAt', c.updated_at,
    'role', case when c.admin_hash = checklist_private.token_hash(token) then 'admin' else 'edit' end);
$$;

create or replace function public.pro_create(p_id uuid, p_admin_token text, p_edit_token text, p_document jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c checklist_private.checklists;
begin
  if p_id is null or p_admin_token is null or p_edit_token is null
    or p_admin_token !~ '^[a-f0-9]{64}$' or p_edit_token !~ '^[a-f0-9]{64}$'
    or p_admin_token = p_edit_token or not checklist_private.valid_document(p_document)
    then raise exception 'INVALID_DOCUMENT'; end if;
  insert into checklist_private.checklists (id, admin_hash, edit_hash, document)
    values (p_id, checklist_private.token_hash(p_admin_token), checklist_private.token_hash(p_edit_token), p_document)
    on conflict (id) do nothing;
  select * into c from checklist_private.checklists where id = p_id;
  if c.admin_hash <> checklist_private.token_hash(p_admin_token) then raise exception 'ACCESS_DENIED'; end if;
  return checklist_private.snapshot(c, p_admin_token);
end;
$$;

create or replace function public.pro_read(p_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c checklist_private.checklists;
begin
  select * into c from checklist_private.checklists where id = p_id;
  if not found or p_token is null or length(p_token) <> 64
    or checklist_private.token_hash(p_token) not in (c.admin_hash, c.edit_hash)
    then raise exception 'ACCESS_DENIED'; end if;
  return checklist_private.snapshot(c, p_token);
end;
$$;

create or replace function public.pro_apply(p_id uuid, p_token text, p_operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c checklist_private.checklists;
  doc jsonb;
  section jsonb;
  task jsonb;
  si integer;
  ti integer;
  kind text;
  field text;
  value jsonb;
  items jsonb;
  moved jsonb;
  ordered jsonb;
  source_order jsonb;
  target_order jsonb;
  target_section jsonb;
  target_si integer;
  before_id text;
  inserted boolean;
begin
  -- Serialize modifications to one document; compare only the fields being changed.
  select * into c from checklist_private.checklists where id = p_id for update;
  if not found or p_token is null or length(p_token) <> 64
    or checklist_private.token_hash(p_token) not in (c.admin_hash, c.edit_hash)
    then raise exception 'ACCESS_DENIED'; end if;
  if p_operation is null or jsonb_typeof(p_operation) <> 'object'
    or octet_length(p_operation::text) > 262144 then raise exception 'INVALID_OPERATION'; end if;
  doc := c.document;
  kind := p_operation->>'type';
  if kind = 'rename' then
    if doc->'title' is distinct from p_operation->'expected' then raise exception 'CONFLICT'; end if;
    doc := jsonb_set(doc, '{title}', p_operation->'title');
  elsif kind = 'add_section' then
    if exists (select 1 from jsonb_array_elements(doc->'sections') item where item->>'id' = p_operation->'section'->>'id')
      then raise exception 'CONFLICT'; end if;
    doc := jsonb_set(doc, '{sections}', (doc->'sections') || jsonb_build_array(p_operation->'section'));
  elsif kind = 'move_section' then
    select coalesce(jsonb_agg(item->'id' order by ordinality), '[]'::jsonb) into source_order
      from jsonb_array_elements(doc->'sections') with ordinality as sections(item, ordinality);
    if source_order is distinct from p_operation->'expectedOrder' then raise exception 'CONFLICT'; end if;
    select item into moved from jsonb_array_elements(doc->'sections') item where item->>'id' = p_operation->>'sectionId';
    if moved is null or not (p_operation ? 'beforeId') or (jsonb_typeof(p_operation->'beforeId') not in ('string', 'null'))
      then raise exception 'INVALID_OPERATION'; end if;
    before_id := p_operation->>'beforeId';
    if before_id = moved->>'id' then raise exception 'CONFLICT'; end if;
    ordered := '[]'::jsonb;
    inserted := false;
    for section in select item from jsonb_array_elements(doc->'sections') item loop
      if section->>'id' = moved->>'id' then continue; end if;
      if section->>'id' = before_id then
        ordered := ordered || jsonb_build_array(moved);
        inserted := true;
      end if;
      ordered := ordered || jsonb_build_array(section);
    end loop;
    if before_id is null then ordered := ordered || jsonb_build_array(moved);
    elsif not inserted then raise exception 'CONFLICT'; end if;
    doc := jsonb_set(doc, '{sections}', ordered);
  elsif kind = 'move_task' then
    select (ordinality - 1)::integer, item into si, section
      from jsonb_array_elements(doc->'sections') with ordinality as sections(item, ordinality)
      where item->>'id' = p_operation->>'sectionId';
    select (ordinality - 1)::integer, item into target_si, target_section
      from jsonb_array_elements(doc->'sections') with ordinality as sections(item, ordinality)
      where item->>'id' = p_operation->>'toSectionId';
    if section is null or target_section is null then raise exception 'CONFLICT'; end if;
    select coalesce(jsonb_agg(item->'id' order by ordinality), '[]'::jsonb) into source_order
      from jsonb_array_elements(section->'tasks') with ordinality as tasks(item, ordinality);
    select coalesce(jsonb_agg(item->'id' order by ordinality), '[]'::jsonb) into target_order
      from jsonb_array_elements(target_section->'tasks') with ordinality as tasks(item, ordinality);
    if source_order is distinct from p_operation->'expectedSourceOrder' or target_order is distinct from p_operation->'expectedTargetOrder'
      then raise exception 'CONFLICT'; end if;
    select item into moved from jsonb_array_elements(section->'tasks') item where item->>'id' = p_operation->>'taskId';
    if moved is null then raise exception 'CONFLICT'; end if;
    if not (p_operation ? 'beforeId') or jsonb_typeof(p_operation->'beforeId') not in ('string', 'null')
      then raise exception 'INVALID_OPERATION'; end if;
    before_id := p_operation->>'beforeId';
    if si = target_si and before_id = moved->>'id' then raise exception 'CONFLICT'; end if;
    if si <> target_si and exists (select 1 from jsonb_array_elements(target_section->'tasks') item where item->>'id' = moved->>'id')
      then raise exception 'CONFLICT'; end if;
    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) into items
      from jsonb_array_elements(section->'tasks') with ordinality as tasks(item, ordinality)
      where item->>'id' <> moved->>'id';
    doc := jsonb_set(doc, array['sections', si::text, 'tasks'], items);
    if si = target_si then target_section := jsonb_set(target_section, '{tasks}', items); end if;
    ordered := '[]'::jsonb;
    inserted := false;
    for task in select item from jsonb_array_elements(target_section->'tasks') item loop
      if task->>'id' = before_id then
        ordered := ordered || jsonb_build_array(moved);
        inserted := true;
      end if;
      ordered := ordered || jsonb_build_array(task);
    end loop;
    if before_id is null then ordered := ordered || jsonb_build_array(moved);
    elsif not inserted then raise exception 'CONFLICT'; end if;
    doc := jsonb_set(doc, array['sections', target_si::text, 'tasks'], ordered);
  else
    select (ordinality - 1)::integer, item into si, section
      from jsonb_array_elements(doc->'sections') with ordinality as sections(item, ordinality)
      where item->>'id' = p_operation->>'sectionId';
    if section is null then raise exception 'CONFLICT'; end if;
    if kind = 'update_section' then
      if section->'title' is distinct from p_operation->'expected' then raise exception 'CONFLICT'; end if;
      doc := jsonb_set(doc, array['sections', si::text, 'title'], p_operation->'title');
    elsif kind = 'delete_section' then
      if section is distinct from p_operation->'expected' then raise exception 'CONFLICT'; end if;
      doc := doc #- array['sections', si::text];
    elsif kind = 'add_task' then
      if exists (select 1 from jsonb_array_elements(section->'tasks') item where item->>'id' = p_operation->'task'->>'id')
        then raise exception 'CONFLICT'; end if;
      doc := jsonb_set(doc, array['sections', si::text, 'tasks'], (section->'tasks') || jsonb_build_array(p_operation->'task'));
    elsif kind in ('update_task', 'delete_task') then
      select (ordinality - 1)::integer, item into ti, task
        from jsonb_array_elements(section->'tasks') with ordinality as tasks(item, ordinality)
        where item->>'id' = p_operation->>'taskId';
      if task is null then raise exception 'CONFLICT'; end if;
      if kind = 'delete_task' then
        if task is distinct from p_operation->'expected' then raise exception 'CONFLICT'; end if;
        doc := doc #- array['sections', si::text, 'tasks', ti::text];
      else
        if jsonb_typeof(p_operation->'patch') is distinct from 'object'
          or jsonb_typeof(p_operation->'expected') is distinct from 'object'
          or p_operation->'patch' = '{}'::jsonb then raise exception 'INVALID_OPERATION'; end if;
        for field, value in select pair.key, pair.value from jsonb_each(p_operation->'patch') as pair loop
          if field not in ('text', 'done', 'comment') then raise exception 'INVALID_OPERATION'; end if;
          if task->field is distinct from p_operation->'expected'->field then raise exception 'CONFLICT'; end if;
          task := jsonb_set(task, array[field], value);
        end loop;
        doc := jsonb_set(doc, array['sections', si::text, 'tasks', ti::text], task);
      end if;
    else raise exception 'INVALID_OPERATION'; end if;
  end if;
  if not checklist_private.valid_document(doc) then raise exception 'INVALID_DOCUMENT'; end if;
  update checklist_private.checklists set document = doc, revision = revision + 1, updated_at = clock_timestamp()
    where id = p_id returning * into c;
  return checklist_private.snapshot(c, p_token);
end;
$$;

create or replace function public.pro_manage(p_id uuid, p_token text, p_action text, p_edit_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c checklist_private.checklists;
begin
  select * into c from checklist_private.checklists where id = p_id for update;
  if not found or p_token is null or checklist_private.token_hash(p_token) <> c.admin_hash
    then raise exception 'ACCESS_DENIED'; end if;
  if p_action = 'delete' then
    delete from checklist_private.checklists where id = p_id;
    return jsonb_build_object('deleted', true);
  elsif p_action = 'rotate' and p_edit_token is not null and p_edit_token ~ '^[a-f0-9]{64}$'
    and checklist_private.token_hash(p_edit_token) <> c.admin_hash then
    update checklist_private.checklists set edit_hash = checklist_private.token_hash(p_edit_token),
      revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
    return jsonb_build_object('rotated', true);
  end if;
  raise exception 'INVALID_OPERATION';
end;
$$;

revoke execute on all functions in schema checklist_private from public, anon, authenticated;
revoke execute on function public.pro_create(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pro_read(uuid, text) from public, anon, authenticated;
revoke execute on function public.pro_apply(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.pro_manage(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.pro_create(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.pro_read(uuid, text) to anon, authenticated;
grant execute on function public.pro_apply(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.pro_manage(uuid, text, text, text) to anon, authenticated;

-- No direct table access and no Realtime publication. The client reads through
-- pro_read every 3 seconds, with the same token authorization as writes.
notify pgrst, 'reload schema';
