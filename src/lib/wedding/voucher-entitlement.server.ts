import type { Sql } from '../db';

type StoredWedding = { id: string; slug: string; payment?: { verified?: boolean; status?: string } };
/** Repair a lost entitlement only from an already-redeemed voucher bound to this exact wedding. */
export async function restoreVoucherEntitlement<T extends StoredWedding>(core: Sql, ledger: Sql, wedding: T): Promise<T> {
  // An explicit verified failure/revocation is never undone by a read.
  if (wedding.payment?.verified === true) return wedding;
  const proof = (await ledger<{ code_hint: string; wedding_id: string }>`
    select code_hint, wedding_id from wedding_vouchers
    where wedding_slug = ${wedding.slug} and wedding_id = ${wedding.id}
      and status = 'redeemed' and redeemed_at is not null and revoked_at is null
    limit 1
  `)[0];
  if (!proof) return wedding;
  const [restored] = await core<{ payload: T }>`
    update circles
    set payload = jsonb_set(payload, '{payment}',
      (case when jsonb_typeof(payload->'payment') = 'object' then payload->'payment' else '{}'::jsonb end)
      || jsonb_build_object('status','paid','verified',true,'reference',${'VOUCHER-' + proof.code_hint}::text,'provider','preview'))
      || jsonb_build_object('rev',coalesce((payload->>'rev')::int,0)+1),
      updated_at = now()
    where slug = ${wedding.slug} and coalesce(payload->>'id',slug) = ${proof.wedding_id}
      and (payload #> '{payment,verified}') is distinct from 'true'::jsonb
    returning payload
  `;
  return restored?.payload || wedding;
}
