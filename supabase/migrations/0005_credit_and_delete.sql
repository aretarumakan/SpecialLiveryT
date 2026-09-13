-- =============================================================================
-- 0005_credit_and_delete.sql … クレジットの追随と、投稿者本人による写真削除
-- 0001_init.sql → 0002_storage.sql → 0003_settings.sql → 0004_hardening.sql の後に実行する。
--
-- 何度実行しても壊れない（create or replace / drop trigger if exists / 冪等な update）。
--
-- 入っているもの
--   1. profiles.display_name を変えたら、その人の写真の credit_name も追随する
--      （これまでは「投稿時点の名前で固定」だったのをやめる。README / terms.html も更新済み）
--   2. 1 の一度きりの遡り反映（既存の写真のクレジットを今の表示名に揃える）
--   3. 代表写真を削除したときに次の代表を決め直す（photos_after_delete）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表示名の変更を写真のクレジットに反映する
--    security definer … photos の RLS（他人の写真は更新できない）を通さずに、
--    本人の写真だけを確実に書き換えるため。更新対象は user_id = new.id に限る。
--    credit_name の変更は 0004 の photos_guard_update に引っかからない
--    （あれは livery_id / storage_path / thumb_path / user_id の付け替えだけを止める）。
-- -----------------------------------------------------------------------------

create or replace function public.profiles_sync_credit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 実際に表示名が変わったときだけ走らせる（他の列の更新では何もしない）
  if new.display_name is distinct from old.display_name then
    update public.photos
       set credit_name = new.display_name
     where user_id = new.id
       and credit_name is distinct from new.display_name;
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_sync_credit_trg on public.profiles;
create trigger profiles_sync_credit_trg
  after update of display_name on public.profiles
  for each row execute function public.profiles_sync_credit();

-- -----------------------------------------------------------------------------
-- 2. 一度きりの遡り反映（既存の写真を今の表示名に揃える）
--    差分がある行だけを触るので、再実行しても 0 行更新で終わる。
-- -----------------------------------------------------------------------------

update public.photos p
   set credit_name = pr.display_name
  from public.profiles pr
 where pr.id = p.user_id
   and p.credit_name is distinct from pr.display_name;

-- -----------------------------------------------------------------------------
-- 3. 代表写真が消えたら次の代表を決め直す
--    0001_init.sql の photos_primary_sync_trg も delete で decide_primary を呼ぶが、
--    こちらは「代表写真だったときだけ」「塗装機の行がまだ残っているときだけ」に絞った
--    念のための 1 本。liveries を消した場合（photos は on delete cascade で消える）に
--    存在しない塗装機へ decide_primary を投げないようにする。
-- -----------------------------------------------------------------------------

create or replace function public.photos_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_primary and exists (select 1 from public.liveries where id = old.livery_id) then
    perform public.decide_primary(old.livery_id);
  end if;
  return null;
end;
$$;

drop trigger if exists photos_after_delete_trg on public.photos;
create trigger photos_after_delete_trg
  after delete on public.photos
  for each row execute function public.photos_after_delete();

-- 実行後の確認（どちらも 0 行が正常）
--   select count(*) from public.photos p join public.profiles pr on pr.id = p.user_id
--    where p.credit_name is distinct from pr.display_name;
--   select l.id from public.liveries l
--    where l.status = 'approved'
--      and exists (select 1 from public.photos where livery_id = l.id and status = 'approved')
--      and not exists (select 1 from public.photos where livery_id = l.id and is_primary);
