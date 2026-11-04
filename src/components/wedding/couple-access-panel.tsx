import { useState } from "react";
import { toast } from "sonner";
import { CeremonyInviteButton } from "@/components/wedding/ceremony-invite";
import { Button, fieldClass } from "@/components/wedding/ui";
import { circleKey } from "@/lib/wedding/circle-key";
import { assignCoupleSeat, codeStatusLabel, issueCoupleCode, revokeCoupleCode, selfCoupleRole } from "@/lib/wedding/couple-access";
import { accountSenderId, isSenderId } from "@/lib/wedding/identity";
import { useWeddingStore } from "@/lib/wedding/store";
import type { CoupleAccess, CoupleCodeRecord, CoupleRoleName, CoupleSeat, Wedding } from "@/lib/wedding/types";

function freshCode(role: CoupleRoleName) {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${role === "bride" ? "BRIDE" : "GROOM"}-${hex}`;
}

function roleStatus(seat: CoupleSeat | undefined, record: CoupleCodeRecord | undefined) {
  if (!seat?.accountId && record?.status === "revoked") return "Revoked";
  if (!seat?.accountId) return "Not assigned";
  if (record?.status === "claimed") return "Claimed";
  return "Active";
}

export function CoupleAccessPanel({ wedding }: { wedding: Wedding }) {
  const account = useWeddingStore((s) => s.account);
  const memberships = useWeddingStore((s) => s.memberships);
  const setCoupleAccess = useWeddingStore((s) => s.setCoupleAccess);
  const me = accountSenderId(account);
  const mine = selfCoupleRole(wedding.coupleAccess, me);
  const published = Boolean(circleKey(wedding.slug));
  const [pending, setPending] = useState<{ role: CoupleRoleName; seat: CoupleSeat | null; label: string } | null>(null);
  const [codeAsk, setCodeAsk] = useState<{ role: CoupleRoleName; kind: "regenerate" | "revoke" } | null>(null);

  const people = (memberships ?? [])
    .filter((item) => item.slug === wedding.slug && item.email.includes("@"))
    .map((item) => ({
      id: `email:${item.email.trim().toLowerCase()}`,
      label: `${item.name || item.email} · ${item.email}`,
    }))
    .filter((item) => isSenderId(item.id));
  if (me && account && !people.some((item) => item.id === me)) {
    people.unshift({ id: me, label: `${account.name} · you` });
  }

  async function save(access: CoupleAccess, quiet = false) {
    const result = await setCoupleAccess(wedding.id, access);
    if (!result.ok) {
      toast(result.error);
      return;
    }
    if (!quiet) {
      toast(result.local ? "Saved on this phone. Publish the wedding before the code works on another phone." : "Saved for this wedding.");
    }
  }

  function commit(role: CoupleRoleName, seat: CoupleSeat | null) {
    const result = assignCoupleSeat(wedding.coupleAccess, role, seat);
    if (!result.ok) {
      toast(result.error === "both" ? "One account cannot be both the bride and the groom." : "Choose a signed-in member. A display name is not an account.");
      return;
    }
    const current = role === "bride" ? wedding.coupleAccess?.bride : wedding.coupleAccess?.groom;
    const other = role === "bride" ? wedding.coupleAccess?.groom : wedding.coupleAccess?.bride;
    if (seat && current?.accountId && current.accountId !== seat.accountId) {
      setPending({ role, seat, label: current.name || "the current person" });
      return;
    }
    if (!seat && current?.accountId) {
      setPending({ role, seat: null, label: current.name || "the current person" });
      return;
    }
    void save(result.access);
    if (other?.accountId && seat && other.accountId === seat.accountId) return;
  }

  function confirmPending() {
    if (!pending) return;
    const result = assignCoupleSeat(wedding.coupleAccess, pending.role, pending.seat);
    setPending(null);
    if (!result.ok) {
      toast(result.error === "both" ? "One account cannot be both the bride and the groom." : "That assignment was not saved.");
      return;
    }
    void save(result.access);
  }

  function assignSelf(role: CoupleRoleName | "neither") {
    if (!me || !account) {
      toast("Sign in before assigning yourself. A display name is not enough.");
      return;
    }
    if (role === "neither") {
      if (wedding.coupleAccess?.bride?.accountId === me) commit("bride", null);
      else if (wedding.coupleAccess?.groom?.accountId === me) commit("groom", null);
      return;
    }
    commit(role, { accountId: me, name: account.name });
  }

  function issue(role: CoupleRoleName) {
    const next = issueCoupleCode(wedding.coupleAccess, role, freshCode(role));
    if (!next) {
      toast("Could not create a code.");
      return;
    }
    void save(next);
  }

  function confirmCode() {
    if (!codeAsk) return;
    const { role, kind } = codeAsk;
    setCodeAsk(null);
    if (kind === "revoke") {
      void save(revokeCoupleCode(wedding.coupleAccess, role));
      return;
    }
    issue(role);
  }

  return (
    <div data-couple-access="">
      <p className="text-sm text-muted">
        Assign the bride and groom by account, or give each person a private code for Enter Wedding Code. These roles do not make someone a host.
      </p>
      {!published ? (
        <p className="mt-2 text-sm text-maroon" role="status">
          These codes stay on this phone until the wedding is published.
        </p>
      ) : null}
      <fieldset className="mt-3">
        <legend className="text-sm font-medium">Host self-assignment</legend>
        <div className="mt-2 flex flex-col gap-1">
          {([
            ["bride", "I am the Bride"],
            ["groom", "I am the Groom"],
            ["neither", "I am neither"],
          ] as const).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name="couple-self" checked={mine === value} onChange={() => assignSelf(value)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 grid gap-3">
        <RoleCard
          role="bride"
          title="BRIDE ACCESS"
          wedding={wedding}
          people={people}
          onAssign={(id) => {
            const person = people.find((item) => item.id === id);
            if (!person) return;
            commit("bride", { accountId: person.id, name: person.label.split(" · ")[0] || "Bride" });
          }}
          onRemove={() => commit("bride", null)}
          onGenerate={() => {
            const record = wedding.coupleAccess?.brideCode;
            if (record?.code && record.status !== "revoked") setCodeAsk({ role: "bride", kind: "regenerate" });
            else issue("bride");
          }}
          onRevoke={() => setCodeAsk({ role: "bride", kind: "revoke" })}
        />
        <RoleCard
          role="groom"
          title="GROOM ACCESS"
          wedding={wedding}
          people={people}
          onAssign={(id) => {
            const person = people.find((item) => item.id === id);
            if (!person) return;
            commit("groom", { accountId: person.id, name: person.label.split(" · ")[0] || "Groom" });
          }}
          onRemove={() => commit("groom", null)}
          onGenerate={() => {
            const record = wedding.coupleAccess?.groomCode;
            if (record?.code && record.status !== "revoked") setCodeAsk({ role: "groom", kind: "regenerate" });
            else issue("groom");
          }}
          onRevoke={() => setCodeAsk({ role: "groom", kind: "revoke" })}
        />
      </div>
      {pending ? (
        <div className="host-confirm" role="dialog" aria-modal="true" aria-labelledby="couple-replace-title" data-couple-confirm="">
          <div className="host-confirm-card">
            <h3 id="couple-replace-title" className="font-serif text-2xl">Replace this assignment?</h3>
            <p className="mt-2 text-sm text-muted">
              {pending.seat
                ? `This replaces ${pending.label}. The other role is left as it is.`
                : `This removes ${pending.label} from this role only.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="line" onClick={() => setPending(null)}>Cancel</Button>
              <Button type="button" onClick={confirmPending}>Confirm</Button>
            </div>
          </div>
        </div>
      ) : null}
      {codeAsk ? (
        <div className="host-confirm" role="dialog" aria-modal="true" data-code-confirm={codeAsk.kind}>
          <div className="host-confirm-card">
            <h3 className="font-serif text-2xl">{codeAsk.kind === "revoke" ? "Revoke this code?" : "Regenerate this code?"}</h3>
            <p className="mt-2 text-sm text-muted">The previous code will stop working. The other role is not changed.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="line" onClick={() => setCodeAsk(null)}>Cancel</Button>
              <Button type="button" onClick={confirmCode}>{codeAsk.kind === "revoke" ? "Revoke code" : "Regenerate code"}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RoleCard({
  role,
  title,
  wedding,
  people,
  onAssign,
  onRemove,
  onGenerate,
  onRevoke,
}: {
  role: CoupleRoleName;
  title: string;
  wedding: Wedding;
  people: { id: string; label: string }[];
  onAssign: (id: string) => void;
  onRemove: () => void;
  onGenerate: () => void;
  onRevoke: () => void;
}) {
  const access = wedding.coupleAccess;
  const seat = role === "bride" ? access?.bride : access?.groom;
  const record = role === "bride" ? access?.brideCode : access?.groomCode;
  const secret = record?.code?.trim() ?? "";
  const status = roleStatus(seat, record);
  async function copyCode() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast("Code copied.");
    } catch {
      toast("Could not copy the code.");
    }
  }
  async function shareCode() {
    if (!secret) return;
    if (navigator.share) {
      try {
        await navigator.share({ text: secret });
        return;
      } catch {
        /* The share sheet can be cancelled. Copy is the fallback. */
      }
    }
    await copyCode();
  }
  return (
    <article className="rounded-2xl border border-line bg-paper p-3" data-couple-role={role}>
      <h3 className="font-medium tracking-wide">{title}</h3>
      <p className="mt-2 text-sm">Assignment: {seat?.accountId ? seat.name || "Signed-in member" : "Not assigned"}</p>
      <p className="text-sm">Role status: {status}</p>
      <p className="text-sm">Access code: {secret ? codeStatusLabel(record) : record?.status === "claimed" || record?.status === "revoked" ? codeStatusLabel(record) : "No code"}</p>
      {!secret && record?.status === "active" ? <p className="mt-1 text-xs text-muted">A code is active, but the secret is only on the phone that created it.</p> : null}
      {secret ? (
        <p className="mt-2 break-all rounded-xl border border-line bg-card px-3 py-2 font-medium tracking-wide" data-couple-code={role}>{secret}</p>
      ) : null}
      {record && record.status !== "revoked" && (secret || record.status === "active" || record.status === "claimed") ? (
        <div className="mt-2">
          <CeremonyInviteButton wedding={wedding} codeId={role} kind={role} />
        </div>
      ) : null}
      <label className="mt-3 block text-sm">
        Assign a signed-in member
        <select className={`${fieldClass} mt-1`} value="" aria-label={`Assign ${role}`} onChange={(event) => { if (event.target.value) onAssign(event.target.value); }}>
          <option value="">Choose a member</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{person.label}</option>
          ))}
        </select>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {seat?.accountId ? <Button type="button" variant="line" onClick={onRemove}>Remove assignment</Button> : null}
        <Button type="button" variant="line" onClick={onGenerate}>{secret && record?.status !== "revoked" ? "Regenerate code" : "Generate code"}</Button>
        {secret ? <Button type="button" variant="line" onClick={() => void copyCode()}>Copy code</Button> : null}
        {secret ? <Button type="button" variant="line" onClick={() => void shareCode()}>Share code</Button> : null}
        {record && record.status !== "revoked" ? <Button type="button" variant="line" onClick={onRevoke}>Revoke code</Button> : null}
      </div>
    </article>
  );
}
