-- Generated together with schema.sql. Apply in the SQL Editor once.
begin;
create table if not exists checklist_private.trash (
  id uuid primary key, checklist_id uuid not null references checklist_private.checklists(id) on delete cascade,
  kind text not null, section_id text, payload jsonb not null, position integer not null,
  expires_at timestamptz not null default (clock_timestamp() + interval '30 seconds')
);
create table if not exists checklist_private.files (
  id uuid primary key, checklist_id uuid not null, section_id text not null, task_id text not null,
  name text not null, size bigint not null check(size > 0 and size <= 10485760), mime text not null,
  state text not null default 'pending' check(state in ('pending','ready','deleted')),
  created_at timestamptz not null default clock_timestamp(), deleted_at timestamptz, deleted_by uuid
);
create index if not exists files_checklist on checklist_private.files(checklist_id);
alter table checklist_private.trash enable row level security;
alter table checklist_private.files enable row level security;
revoke all on checklist_private.trash, checklist_private.files from public, anon, authenticated;

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
        or length(task->>'comment') > 10000
        or (task ? 'priority' and (jsonb_typeof(task->'priority') <> 'string' or task->>'priority' not in ('none','low','medium','high'))) then return false; end if;
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
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'sectionId',f.section_id,'taskId',f.task_id,'name',f.name,'size',f.size,'mime',f.mime) order by f.created_at)
      from checklist_private.files f where f.checklist_id=c.id and f.state='ready'), '[]'::jsonb),
    'role', case when c.admin_hash = checklist_private.token_hash(token) then 'admin' else 'edit' end);
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
  undo_id uuid;
  deleted_record checklist_private.trash;
  undo_result jsonb;
  pos integer;
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
  elsif kind = 'restore' then
    select * into deleted_record from checklist_private.trash where id=(p_operation->>'undoId')::uuid and checklist_id=p_id for update;
    if not found or deleted_record.expires_at <= clock_timestamp() then raise exception 'UNDO_EXPIRED'; end if;
    if deleted_record.kind='delete_section' then
      if exists(select 1 from jsonb_array_elements(doc->'sections') s where s->>'id'=deleted_record.payload->>'id') then raise exception 'CONFLICT'; end if;
      pos := least(deleted_record.position,jsonb_array_length(doc->'sections'));
      doc := jsonb_insert(doc,array['sections',pos::text],deleted_record.payload);
    else
      select (ordinality-1)::integer,item into si,section from jsonb_array_elements(doc->'sections') with ordinality as sections(item,ordinality)
        where item->>'id'=deleted_record.section_id;
      if section is null or exists(select 1 from jsonb_array_elements(section->'tasks') t where t->>'id'=deleted_record.payload->>'id') then raise exception 'CONFLICT'; end if;
      pos := least(deleted_record.position,jsonb_array_length(section->'tasks'));
      doc := jsonb_insert(doc,array['sections',si::text,'tasks',pos::text],deleted_record.payload);
    end if;
    update checklist_private.files set state='ready',deleted_at=null,deleted_by=null where deleted_by=deleted_record.id and checklist_id=p_id;
    delete from checklist_private.trash where id=deleted_record.id;
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
    update checklist_private.files set section_id=p_operation->>'toSectionId' where checklist_id=p_id and section_id=p_operation->>'sectionId' and task_id=p_operation->>'taskId' and state in ('pending','ready');
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
      undo_id := coalesce((p_operation->>'undoId')::uuid,md5(random()::text || clock_timestamp()::text)::uuid);
      insert into checklist_private.trash(id,checklist_id,kind,section_id,payload,position) values(undo_id,p_id,kind,section->>'id',section,si) returning * into deleted_record;
      update checklist_private.files set state='deleted',deleted_at=clock_timestamp(),deleted_by=undo_id where checklist_id=p_id and section_id=section->>'id' and state='ready';
      doc := doc #- array['sections', si::text];
    elsif kind = 'add_tasks' then
      if jsonb_typeof(p_operation->'tasks') is distinct from 'array' or jsonb_array_length(p_operation->'tasks') not between 1 and 100 then raise exception 'INVALID_OPERATION'; end if;
      for task in select item from jsonb_array_elements(p_operation->'tasks') item loop
        if exists(select 1 from jsonb_array_elements(section->'tasks') t where t->>'id'=task->>'id') then raise exception 'CONFLICT'; end if;
        section := jsonb_set(section,'{tasks}',(section->'tasks') || jsonb_build_array(task));
      end loop;
      doc := jsonb_set(doc,array['sections',si::text],section);
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
        undo_id := coalesce((p_operation->>'undoId')::uuid,md5(random()::text || clock_timestamp()::text)::uuid);
        insert into checklist_private.trash(id,checklist_id,kind,section_id,payload,position) values(undo_id,p_id,kind,section->>'id',task,ti) returning * into deleted_record;
        update checklist_private.files set state='deleted',deleted_at=clock_timestamp(),deleted_by=undo_id where checklist_id=p_id and section_id=section->>'id' and task_id=task->>'id' and state='ready';
        doc := doc #- array['sections', si::text, 'tasks', ti::text];
      else
        if jsonb_typeof(p_operation->'patch') is distinct from 'object'
          or jsonb_typeof(p_operation->'expected') is distinct from 'object'
          or p_operation->'patch' = '{}'::jsonb then raise exception 'INVALID_OPERATION'; end if;
        for field, value in select pair.key, pair.value from jsonb_each(p_operation->'patch') as pair loop
          if field not in ('text', 'done', 'comment', 'priority') then raise exception 'INVALID_OPERATION'; end if;
          if (case when field='priority' then coalesce(task->field,'"none"'::jsonb) else task->field end) is distinct from p_operation->'expected'->field then raise exception 'CONFLICT'; end if;
          task := jsonb_set(task, array[field], value);
        end loop;
        doc := jsonb_set(doc, array['sections', si::text, 'tasks', ti::text], task);
      end if;
    else raise exception 'INVALID_OPERATION'; end if;
  end if;
  if not checklist_private.valid_document(doc) then raise exception 'INVALID_DOCUMENT'; end if;
  update checklist_private.checklists set document = doc, revision = revision + 1, updated_at = clock_timestamp()
    where id = p_id returning * into c;
  if undo_id is not null then
    undo_result := jsonb_build_object('id',undo_id,'expiresAt',deleted_record.expires_at,'label',case when kind='delete_section' then 'Seção excluída' else 'Item excluído' end);
    return checklist_private.snapshot(c,p_token) || jsonb_build_object('undo',undo_result);
  end if;
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
    update checklist_private.files set state='deleted',deleted_at=clock_timestamp(),deleted_by=null where checklist_id=p_id;
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

-- Only the Edge Function may call this RPC. Every action still validates the checklist link.
create or replace function public.pro_file(p_id uuid, p_token text, p_action text, p_file jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c checklist_private.checklists; f checklist_private.files; fid uuid; result jsonb;
begin
  select * into c from checklist_private.checklists where id=p_id for update;
  if not found or p_token is null or length(p_token) <> 64
    or checklist_private.token_hash(p_token) not in (c.admin_hash,c.edit_hash) then raise exception 'ACCESS_DENIED'; end if;
  fid := (p_file->>'id')::uuid;
  if p_action = 'reserve' then
    if not exists(select 1 from jsonb_array_elements(c.document->'sections') s, jsonb_array_elements(s->'tasks') t
      where s->>'id'=p_file->>'sectionId' and t->>'id'=p_file->>'taskId') then raise exception 'CONFLICT'; end if;
    if length(p_file->>'name') not between 1 and 255 or jsonb_typeof(p_file->'name') is distinct from 'string'
      or p_file->>'mime' not in ('image/jpeg','image/png','image/webp','image/gif','application/pdf')
      or (p_file->>'size')::bigint not between 1 and 10485760 then raise exception 'INVALID_FILE'; end if;
    if (select count(*) from checklist_private.files where checklist_id=p_id and section_id=p_file->>'sectionId'
      and task_id=p_file->>'taskId' and state in ('pending','ready')) >= 5
      or (select coalesce(sum(size),0) from checklist_private.files where checklist_id=p_id and state <> 'deleted') + (p_file->>'size')::bigint > 104857600
      then raise exception 'FILE_LIMIT'; end if;
    insert into checklist_private.files(id,checklist_id,section_id,task_id,name,size,mime)
      values(fid,p_id,p_file->>'sectionId',p_file->>'taskId',p_file->>'name',(p_file->>'size')::bigint,p_file->>'mime') returning * into f;
  else
    select * into f from checklist_private.files where id=fid and checklist_id=p_id for update;
    if not found then raise exception 'ACCESS_DENIED'; end if;
    if p_action='cancel' and f.state='pending' then
      update checklist_private.files set state='deleted',deleted_at=clock_timestamp() where id=fid;
    elsif p_action='commit' and f.state in ('pending','ready') and f.created_at > clock_timestamp()-interval '1 hour' then
      if not exists(select 1 from jsonb_array_elements(c.document->'sections') s, jsonb_array_elements(s->'tasks') t
        where s->>'id'=f.section_id and t->>'id'=f.task_id) then raise exception 'CONFLICT'; end if;
      update checklist_private.files set state='ready' where id=fid;
      update checklist_private.checklists set revision=revision+1,updated_at=clock_timestamp() where id=p_id;
    elsif p_action='download' and f.state='ready' then null;
    elsif p_action='delete' and f.state='ready' then
      update checklist_private.files set state='deleted',deleted_at=clock_timestamp(),deleted_by=null where id=fid;
      update checklist_private.checklists set revision=revision+1,updated_at=clock_timestamp() where id=p_id;
    else raise exception 'ACCESS_DENIED'; end if;
  end if;
  return jsonb_build_object('path',p_id::text || '/' || fid::text,'name',f.name,'mime',f.mime,'size',f.size);
end;
$$;

-- Deleting Storage objects must use its API, never SQL against storage.objects.
create or replace function public.pro_file_cleanup(p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_ids is not null then
    delete from checklist_private.files f where f.id=any(p_ids) and (
      not exists(select 1 from checklist_private.checklists c where c.id=f.checklist_id)
      or (f.state='deleted' and f.deleted_at < clock_timestamp()-interval '30 seconds')
      or (f.state='pending' and f.created_at < clock_timestamp()-interval '1 hour'));
  end if;
  delete from checklist_private.trash where expires_at < clock_timestamp();
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',checklist_id::text || '/' || id::text)),'[]'::jsonb)
    into result from (select f.* from checklist_private.files f where
      not exists(select 1 from checklist_private.checklists c where c.id=f.checklist_id)
      or (f.state='deleted' and f.deleted_at < clock_timestamp()-interval '30 seconds')
      or (f.state='pending' and f.created_at < clock_timestamp()-interval '1 hour') limit 100) candidates;
  return result;
end;
$$;
revoke execute on function public.pro_file(uuid,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.pro_file_cleanup(uuid[]) from public,anon,authenticated;
grant execute on function public.pro_file(uuid,text,text,jsonb) to service_role;
grant execute on function public.pro_read(uuid,text) to service_role;
grant execute on function public.pro_file_cleanup(uuid[]) to service_role;
revoke execute on all functions in schema checklist_private from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
