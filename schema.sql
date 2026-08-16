-- SHEBAND / Supabase schema
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  bio text default '',
  avatar_url text,
  private_account boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  device_label text default 'SMS',
  notify_emergency boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  caption text default '',
  image_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.emergency_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  created_at timestamptz not null default now(),
  device_label text,
  status text not null default 'created'
);

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.posts enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.emergency_alerts enable row level security;

-- Profiles: a signed-in user can read public profiles and their own private profile.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
using (id = auth.uid() or private_account = false);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

-- Contacts are private to the owner.
drop policy if exists "contacts_owner" on public.contacts;
create policy "contacts_owner" on public.contacts for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Posts: public profiles' posts are visible; own posts are always visible.
drop policy if exists "posts_select" on public.posts;
create policy "posts_select" on public.posts for select to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = posts.user_id and p.private_account = false)
);

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts for delete to authenticated
using (user_id = auth.uid());

-- Conversation membership.
drop policy if exists "members_read_own" on public.conversation_members;
create policy "members_read_own" on public.conversation_members for select to authenticated
using (user_id = auth.uid());

drop policy if exists "members_insert_self" on public.conversation_members;
create policy "members_insert_self" on public.conversation_members for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "conversation_read_member" on public.conversations;
create policy "conversation_read_member" on public.conversations for select to authenticated
using (exists (select 1 from public.conversation_members m where m.conversation_id = conversations.id and m.user_id = auth.uid()));

drop policy if exists "conversation_insert" on public.conversations;
create policy "conversation_insert" on public.conversations for insert to authenticated
with check (true);

-- Messages only in conversations where the user is a member.
drop policy if exists "messages_read_member" on public.messages;
create policy "messages_read_member" on public.messages for select to authenticated
using (exists (select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = auth.uid()));

drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member" on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and exists (select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = auth.uid())
);

-- Emergency alerts: only the owner can read/create from the client. Backend uses service role to insert.
drop policy if exists "alerts_owner_read" on public.emergency_alerts;
create policy "alerts_owner_read" on public.emergency_alerts for select to authenticated
using (user_id = auth.uid());

drop policy if exists "alerts_owner_insert" on public.emergency_alerts;
create policy "alerts_owner_insert" on public.emergency_alerts for insert to authenticated
with check (user_id = auth.uid());

-- Storage buckets.
insert into storage.buckets (id, name, public)
values ('avatars','avatars',true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('posts','posts',true)
on conflict (id) do nothing;

drop policy if exists "avatar_upload_own" on storage.objects;
create policy "avatar_upload_own" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatar_update_own" on storage.objects;
create policy "avatar_update_own" on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "post_upload_own" on storage.objects;
create policy "post_upload_own" on storage.objects for insert to authenticated
with check (bucket_id = 'posts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "post_delete_own" on storage.objects;
create policy "post_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'posts' and (storage.foldername(name))[1] = auth.uid()::text);

-- Realtime for chat.
alter publication supabase_realtime add table public.messages;
