-- 允許已登入用戶新增自己的 profile（用於新增帳號功能）
create policy if not exists "profiles self insert"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);
