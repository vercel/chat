-- Copy this file into your declarative schema folder.
--
-- By default it creates a `chat_state` schema that exposes RPC functions only.
--
-- Important:
-- 1. Add the schema to your Supabase API exposed schemas.
-- 2. The grants below intentionally allow only `service_role` to execute the RPCs.
--    If you want to use another PostgREST role, adjust the grants explicitly.

create schema if not exists chat_state;

revoke all on schema chat_state from public, anon, authenticated;
grant usage on schema chat_state to service_role;

create table if not exists chat_state.chat_state_subscriptions (
  key_prefix text not null,
  thread_id text not null,
  created_at timestamptz not null default now(),
  primary key (key_prefix, thread_id)
);

create table if not exists chat_state.chat_state_locks (
  key_prefix text not null,
  thread_id text not null,
  token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (key_prefix, thread_id)
);

create index if not exists chat_state_locks_expires_idx
  on chat_state.chat_state_locks (expires_at);

create table if not exists chat_state.chat_state_cache (
  key_prefix text not null,
  cache_key text not null,
  value jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (key_prefix, cache_key)
);

create index if not exists chat_state_cache_expires_idx
  on chat_state.chat_state_cache (expires_at);

create table if not exists chat_state.chat_state_lists (
  key_prefix text not null,
  list_key text not null,
  seq bigint generated always as identity,
  value jsonb not null,
  expires_at timestamptz,
  primary key (key_prefix, list_key, seq)
);

create index if not exists chat_state_lists_expires_idx
  on chat_state.chat_state_lists (expires_at);

alter table chat_state.chat_state_subscriptions enable row level security;
alter table chat_state.chat_state_locks enable row level security;
alter table chat_state.chat_state_cache enable row level security;
alter table chat_state.chat_state_lists enable row level security;

create or replace function chat_state.chat_state_connect()
returns boolean
language sql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
  select true;
$$;

create or replace function chat_state.chat_state_subscribe(
  p_key_prefix text,
  p_thread_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
begin
  insert into chat_state_subscriptions (key_prefix, thread_id)
  values (p_key_prefix, p_thread_id)
  on conflict do nothing;

  return true;
end;
$$;

create or replace function chat_state.chat_state_unsubscribe(
  p_key_prefix text,
  p_thread_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
begin
  delete from chat_state_subscriptions
  where key_prefix = p_key_prefix
    and thread_id = p_thread_id;

  return found;
end;
$$;

create or replace function chat_state.chat_state_is_subscribed(
  p_key_prefix text,
  p_thread_id text
)
returns boolean
language sql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
  select exists(
    select 1
    from chat_state_subscriptions
    where key_prefix = p_key_prefix
      and thread_id = p_thread_id
  );
$$;

create or replace function chat_state.chat_state_acquire_lock(
  p_key_prefix text,
  p_thread_id text,
  p_token text,
  p_ttl_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
declare
  v_expires_at timestamptz;
  v_lock chat_state_locks%rowtype;
begin
  v_expires_at := now() + (p_ttl_ms * interval '1 millisecond');

  insert into chat_state_locks (key_prefix, thread_id, token, expires_at)
  values (p_key_prefix, p_thread_id, p_token, v_expires_at)
  on conflict (key_prefix, thread_id) do update
    set token = excluded.token,
        expires_at = excluded.expires_at,
        updated_at = now()
    where chat_state_locks.expires_at <= now()
  returning * into v_lock;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'threadId', v_lock.thread_id,
    'token', v_lock.token,
    'expiresAt', floor(extract(epoch from v_lock.expires_at) * 1000)::bigint
  );
end;
$$;

create or replace function chat_state.chat_state_force_release_lock(
  p_key_prefix text,
  p_thread_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
begin
  delete from chat_state_locks
  where key_prefix = p_key_prefix
    and thread_id = p_thread_id;

  return found;
end;
$$;

create or replace function chat_state.chat_state_release_lock(
  p_key_prefix text,
  p_thread_id text,
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
begin
  delete from chat_state_locks
  where key_prefix = p_key_prefix
    and thread_id = p_thread_id
    and token = p_token;

  return found;
end;
$$;

create or replace function chat_state.chat_state_extend_lock(
  p_key_prefix text,
  p_thread_id text,
  p_token text,
  p_ttl_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
begin
  update chat_state_locks
  set expires_at = now() + (p_ttl_ms * interval '1 millisecond'),
      updated_at = now()
  where key_prefix = p_key_prefix
    and thread_id = p_thread_id
    and token = p_token
    and expires_at > now();

  return found;
end;
$$;

create or replace function chat_state.chat_state_get(
  p_key_prefix text,
  p_cache_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
declare
  v_value jsonb;
begin
  select value
  into v_value
  from chat_state_cache
  where key_prefix = p_key_prefix
    and cache_key = p_cache_key
    and (expires_at is null or expires_at > now())
  limit 1;

  if found then
    return v_value;
  end if;

  delete from chat_state_cache
  where key_prefix = p_key_prefix
    and cache_key = p_cache_key
    and expires_at is not null
    and expires_at <= now();

  return null;
end;
$$;

create or replace function chat_state.chat_state_set(
  p_key_prefix text,
  p_cache_key text,
  p_value jsonb,
  p_ttl_ms bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
declare
  v_expires_at timestamptz;
begin
  v_expires_at := case
    when p_ttl_ms is null then null
    else now() + (p_ttl_ms * interval '1 millisecond')
  end;

  insert into chat_state_cache (key_prefix, cache_key, value, expires_at)
  values (p_key_prefix, p_cache_key, p_value, v_expires_at)
  on conflict (key_prefix, cache_key) do update
    set value = excluded.value,
        expires_at = excluded.expires_at,
        updated_at = now();

  return true;
end;
$$;

create or replace function chat_state.chat_state_set_if_not_exists(
  p_key_prefix text,
  p_cache_key text,
  p_value jsonb,
  p_ttl_ms bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
declare
  v_cache_key text;
  v_expires_at timestamptz;
begin
  v_expires_at := case
    when p_ttl_ms is null then null
    else now() + (p_ttl_ms * interval '1 millisecond')
  end;

  insert into chat_state_cache (key_prefix, cache_key, value, expires_at)
  values (p_key_prefix, p_cache_key, p_value, v_expires_at)
  on conflict (key_prefix, cache_key) do update
    set value = excluded.value,
        expires_at = excluded.expires_at,
        updated_at = now()
    where chat_state_cache.expires_at is not null
      and chat_state_cache.expires_at <= now()
  returning cache_key into v_cache_key;

  return v_cache_key is not null;
end;
$$;

create or replace function chat_state.chat_state_delete(
  p_key_prefix text,
  p_cache_key text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
begin
  delete from chat_state_cache
  where key_prefix = p_key_prefix
    and cache_key = p_cache_key;

  return found;
end;
$$;

create or replace function chat_state.chat_state_append_to_list(
  p_key_prefix text,
  p_list_key text,
  p_value jsonb,
  p_max_length bigint default null,
  p_ttl_ms bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
declare
  v_expires_at timestamptz;
  v_lock_key bigint;
begin
  -- Serialize concurrent appends for the same list so trim + TTL stay correct.
  /* Separator must not appear in key_prefix/list_key; chr(1) is ASCII SOH, safe for wire protocol. */
  v_lock_key := pg_catalog.hashtext(p_key_prefix || chr(1) || p_list_key);
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  v_expires_at := case
    when p_ttl_ms is null then null
    else now() + (p_ttl_ms * interval '1 millisecond')
  end;

  delete from chat_state_lists
  where key_prefix = p_key_prefix
    and list_key = p_list_key
    and expires_at is not null
    and expires_at <= now();

  insert into chat_state_lists (key_prefix, list_key, value, expires_at)
  values (p_key_prefix, p_list_key, p_value, v_expires_at);

  if p_max_length is not null and p_max_length > 0 then
    delete from chat_state_lists
    where key_prefix = p_key_prefix
      and list_key = p_list_key
      and seq in (
        select seq
        from chat_state_lists
        where key_prefix = p_key_prefix
          and list_key = p_list_key
        order by seq desc
        offset p_max_length
      );
  end if;

  update chat_state_lists
  set expires_at = v_expires_at
  where key_prefix = p_key_prefix
    and list_key = p_list_key;

  return true;
end;
$$;

create or replace function chat_state.chat_state_get_list(
  p_key_prefix text,
  p_list_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
declare
  v_values jsonb;
begin
  delete from chat_state_lists
  where key_prefix = p_key_prefix
    and list_key = p_list_key
    and expires_at is not null
    and expires_at <= now();

  select coalesce(jsonb_agg(value order by seq), '[]'::jsonb)
  into v_values
  from chat_state_lists
  where key_prefix = p_key_prefix
    and list_key = p_list_key;

  return v_values;
end;
$$;

create or replace function chat_state.chat_state_cleanup_expired(
  p_key_prefix text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, chat_state, pg_temp
as $$
declare
  v_deleted_cache integer := 0;
  v_deleted_lists integer := 0;
  v_deleted_locks integer := 0;
begin
  delete from chat_state_locks
  where expires_at <= now()
    and (p_key_prefix is null or key_prefix = p_key_prefix);
  get diagnostics v_deleted_locks = row_count;

  delete from chat_state_cache
  where expires_at is not null
    and expires_at <= now()
    and (p_key_prefix is null or key_prefix = p_key_prefix);
  get diagnostics v_deleted_cache = row_count;

  delete from chat_state_lists
  where expires_at is not null
    and expires_at <= now()
    and (p_key_prefix is null or key_prefix = p_key_prefix);
  get diagnostics v_deleted_lists = row_count;

  return jsonb_build_object(
    'cache', v_deleted_cache,
    'lists', v_deleted_lists,
    'locks', v_deleted_locks
  );
end;
$$;

revoke all on all tables in schema chat_state from public, anon, authenticated, service_role;
revoke all on all sequences in schema chat_state from public, anon, authenticated, service_role;
revoke all on all functions in schema chat_state from public, anon, authenticated;

grant execute on all functions in schema chat_state to service_role;

alter default privileges in schema chat_state
  revoke all on tables from public, anon, authenticated, service_role;

alter default privileges in schema chat_state
  revoke all on sequences from public, anon, authenticated, service_role;

alter default privileges in schema chat_state
  revoke execute on functions from public, anon, authenticated;

alter default privileges in schema chat_state
  grant execute on functions to service_role;
