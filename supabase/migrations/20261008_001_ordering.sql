-- Checklist Pro: ordenação de etapas e movimentação de atividades.
-- Execute no SQL Editor do banco existente. Preserva todos os checklists e links.
begin;
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

revoke execute on function public.pro_apply(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.pro_apply(uuid, text, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
