-- =====================================================================
-- Dutch Blitz ledger — Supabase schema
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run
-- =====================================================================

create table if not exists public.dutch_blitz_games (
  id            uuid primary key default gen_random_uuid(),
  played_at     timestamptz not null default now(),
  target_score  integer     not null,
  players       text[]      not null,
  winner        text        not null,
  final_scores  jsonb       not null,
  rounds        jsonb       not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists dutch_blitz_games_played_at_idx
  on public.dutch_blitz_games (played_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
-- This is a small private-ish site for friends, so anyone with the page
-- can read and add games, but nobody can edit an existing row.
-- ---------------------------------------------------------------------
alter table public.dutch_blitz_games enable row level security;

drop policy if exists "anyone can read games"   on public.dutch_blitz_games;
drop policy if exists "anyone can add games"    on public.dutch_blitz_games;
drop policy if exists "anyone can delete games" on public.dutch_blitz_games;

create policy "anyone can read games"
  on public.dutch_blitz_games for select
  using (true);

create policy "anyone can add games"
  on public.dutch_blitz_games for insert
  with check (true);

-- Remove this last policy if you'd rather nobody could delete history.
create policy "anyone can delete games"
  on public.dutch_blitz_games for delete
  using (true);
