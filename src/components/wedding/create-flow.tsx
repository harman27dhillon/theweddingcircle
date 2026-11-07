import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { WeddingCard } from "@/components/wedding/wedding-card";
import { CeremonyInviteButton } from "@/components/wedding/ceremony-invite";
import { Mark, Button, fieldClass, PickList } from "@/components/wedding/ui";
import { codesOf } from "@/lib/wedding/format";
import { CIRCLE_FEE_PAISE, chargeCircle, type PayMethod } from "@/lib/wedding/payments";
import { FREE_STORAGE_LABEL, PREMIUM_PRICE_LABEL, PREMIUM_STORAGE_LABEL, isPremiumWedding } from "@/lib/wedding/plan";
import { PREMIUM_THEME_COUNT } from "@/lib/wedding/card-themes";
import { useAppRuntime } from "@/lib/developer/runtime";
import { pushCircle } from "@/lib/wedding/publish";
import { circleKey } from "@/lib/wedding/circle-key";
import { registerHostAuthority } from "@/lib/wedding/role-client";
import { useWeddingStore } from "@/lib/wedding/store";
import { redeemWeddingVoucher, validateWeddingVoucher } from "@/lib/wedding/vouchers.functions";
import { REGIONS, RELIGIONS, WEDDING_TYPES, suggestFunctions } from "@/lib/wedding/traditions";
import type { Payment, WeddingDraft } from "@/lib/wedding/types";

type Fn = { name: string; note: string; time: string; date: string };

export function CreateFlow() {
  const navigate = useNavigate();
  const createWedding = useWeddingStore((s) => s.createWedding);
  const account = useWeddingStore((s) => s.account);
  const runtime = useAppRuntime();
  const feeLabel = runtime.feeLabel;
  const [step, setStep] = useState(0);
  const [bride, setBride] = useState("");
  const [groom, setGroom] = useState("");
  const [hostName, setHostName] = useState(account?.name ?? "");
  const [date, setDate] = useState("2026-11-14");
  const [city, setCity] = useState("");
  const [place, setPlace] = useState("");
  const [story, setStory] = useState("");
  const [weddingType, setWeddingType] = useState("Traditional");
  const [contactEmail, setContactEmail] = useState(account?.email ?? "");
  const [contactPhone, setContactPhone] = useState(account?.phone ?? "");
  const [religion, setReligion] = useState("");
  const [region, setRegion] = useState("");
  const [cultureNote, setCultureNote] = useState("");
  const [functions, setFunctions] = useState<Fn[]>([]);
  const [ready, setReady] = useState(false);
  const [pay, setPay] = useState<"idle" | "pending" | "paid" | "failed">("idle");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState<PayMethod>("upi");
  const [upiApp, setUpiApp] = useState("GPay");
  const [madeSlug, setMadeSlug] = useState("");
  const [shareReady, setShareReady] = useState(true);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherNote, setVoucherNote] = useState("");
  const [voucherOk, setVoucherOk] = useState(false);
  const [voucherChecking, setVoucherChecking] = useState(false);
  const voucherDraft = useRef("");
  const creating = useRef(false);
  const wentHome = useRef(false);
  const made = useWeddingStore((s) => s.weddings.find((item) => item.slug === madeSlug));
  const suggestions = useMemo(() => suggestFunctions(religion, region), [religion, region]);

  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const apply = () => {
      const overlap = Math.max(0, window.innerHeight - view.height - view.offsetTop);
      document.documentElement.style.setProperty("--create-keyboard", `${overlap}px`);
    };
    apply();
    view.addEventListener("resize", apply);
    view.addEventListener("scroll", apply);
    return () => {
      view.removeEventListener("resize", apply);
      view.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--create-keyboard");
    };
  }, [step]);

  function loadSuggestions() {
    setFunctions(suggestions.map((s) => ({ name: s.name, note: s.note, time: s.time, date })));
    setReady(true);
  }

  function nextFromCulture() {
    if (!ready) loadSuggestions();
    setStep(2);
  }

  const namesOk = Boolean(account) && Boolean(bride.trim() && groom.trim() && city.trim() && date);

  async function settle(slug: string) {
    const wedding = useWeddingStore.getState().weddings.find((item) => item.slug === slug);
    if (!wedding) return { wedding: null, published: "offline" as const };
    const published = await pushCircle(wedding);
    if (published === "ok") {
      const host = await registerHostAuthority(wedding);
      if (!host.ok) return { wedding, published: "locked" as const };
    }
    setShareReady(published === "ok");
    setMadeSlug(slug);
    return { wedding, published };
  }

  function within(ms: number, work: Promise<unknown>) {
    return new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
      work.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async function goHome() {
    if (wentHome.current) return;
    wentHome.current = true;
    await navigate({ to: "/", replace: true });
  }

  async function finishCreated(slug: string) {
    try {
      const { published } = await within(20000, settle(slug)) as Awaited<ReturnType<typeof settle>>;
      if (published !== "ok") {
        setStep(5);
        toast(published === "locked"
          ? "This wedding is saved on this phone, but it could not be published yet."
          : "This wedding is saved on this phone, but it is not live for other phones yet.");
        return;
      }
      toast("Your Wedding Circle is ready.");
      await goHome();
    } catch {
      setMadeSlug(slug);
      setShareReady(false);
      setStep(5);
      toast("This wedding is saved on this phone, but it could not be confirmed as live.");
    }
  }

  async function openFree() {
    if (creating.current || pay === "pending" || madeSlug) return;
    creating.current = true;
    setPay("pending");
    const slug = createWedding(draftFrom({ status: "pending", reference: "FREE", provider: "preview" }));
    if (!slug) {
      creating.current = false;
      setPay("idle");
      toast("Sign in to create this wedding.");
      return;
    }
    await finishCreated(slug);
    creating.current = false;
    setPay("idle");
  }

  async function openWithVoucher() {
    if (creating.current || pay === "pending" || voucherChecking || !voucherOk || (madeSlug && !voucherDraft.current)) return;
    creating.current = true;
    setPay("pending");
    setVoucherNote("");
    try {
      const slug = voucherDraft.current || createWedding(draftFrom({ status: "pending", reference: "VOUCHER", provider: "preview" }));
      if (!slug) {
        setVoucherNote("Sign in to create this wedding.");
        return;
      }
      voucherDraft.current = slug;
      const { wedding, published } = await within(20000, settle(slug)) as Awaited<ReturnType<typeof settle>>;
      if (!wedding || published !== "ok") {
        setVoucherNote("The draft couldn’t be published. Your voucher is still available. Try again.");
        return;
      }
      const result = await redeemWeddingVoucher({ data: { code: voucherCode, slug, editKey: circleKey(slug) } });
      if (!result.ok) {
        setVoucherNote(result.error);
        return;
      }
      useWeddingStore.getState().applyVoucherPremium(wedding.id, result.reference);
      toast("This premium wedding is covered by your voucher.");
      await goHome();
    } catch {
      setVoucherNote("We couldn’t confirm the upgrade. Try the same code again to finish this wedding.");
    } finally {
      creating.current = false;
      setPay("idle");
    }
  }

  async function applyVoucher() {
    if (voucherChecking || pay === "pending") return;
    setVoucherChecking(true);
    setVoucherOk(false);
    setVoucherNote("");
    try {
      const result = await validateWeddingVoucher({ data: { code: voucherCode } });
      if (!result.ok) {
        setVoucherNote(result.error);
        return;
      }
      setVoucherOk(true);
      setVoucherNote(result.label);
    } catch {
      setVoucherNote("That voucher could not be checked. Try again.");
    } finally {
      setVoucherChecking(false);
    }
  }

  async function payAndOpen(simulate: "paid" | "failed") {
    if (creating.current || pay === "pending" || madeSlug) return;
    creating.current = true;
    setPay("pending");
    const result = await chargeCircle(
      {
        amountInPaise: runtime.feePaise || CIRCLE_FEE_PAISE,
        currency: "INR",
        description: `${groom} & ${bride}`,
        method,
        upiApp: method === "upi" ? upiApp : undefined,
      },
      simulate,
    );
    setPay(result.status === "paid" ? "paid" : "failed");
    setReference(result.reference);
    if (result.status !== "paid") {
      creating.current = false;
      return;
    }
    const slug = createWedding(draftFrom({ status: "pending", reference: result.reference, provider: "preview" }));
    if (!slug) {
      creating.current = false;
      setPay("failed");
      toast("The wedding was not created.");
      return;
    }
    toast("Nothing was charged. Google Play Billing is not connected, so Premium stays locked and this wedding is Free.");
    await settle(slug);
    setStep(5);
    creating.current = false;
  }

  function draftFrom(payment: Payment): WeddingDraft {
    return {
      bride,
      groom,
      hostName: hostName || bride,
      date,
      city,
      place,
      story,
      religion,
      region,
      cultureNote,
      cover: "",
      weddingType,
      contactEmail: account?.email ?? contactEmail,
      contactPhone: account?.phone ?? contactPhone,
      ownerEmail: account?.email ?? contactEmail.trim(),
      payment,
      functions,
    };
  }

  if (!account) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6">
        <p className="text-sm text-muted">Create Wedding Circle</p>
        <h1 className="mt-2 font-serif text-4xl">Create an account, then the wedding</h1>
        <p className="mt-3 text-muted">
          You will enter the couple and preview the circle before choosing Free or Premium. Premium is a one-time {feeLabel} fee, not a subscription. Guests never pay, and they do not need an account.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-full bg-maroon px-4 text-sm text-on-photo"
            onClick={() => {
              sessionStorage.setItem("wc-after-auth", "/create");
              sessionStorage.setItem("wc-auth-mode", "create");
              void navigate({ to: "/account" });
            }}
          >
            Sign up
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm"
            onClick={() => {
              sessionStorage.setItem("wc-after-auth", "/create");
              sessionStorage.setItem("wc-auth-mode", "in");
              void navigate({ to: "/account" });
            }}
          >
            Sign in
          </button>
          <Link to="/" className="inline-flex min-h-11 items-center text-sm text-maroon">
            Back
          </Link>
        </div>
      </main>
    );
  }

  const entryCodes = made ? codesOf(made) : [];
  const busy = pay === "pending" || voucherChecking || Boolean(madeSlug);
  const voucherBusy = pay === "pending" || voucherChecking || Boolean(madeSlug && !voucherDraft.current);

  return (
    <div className="min-h-dvh bg-ivory">
      <header className="mx-auto flex w-full max-w-xl items-center justify-between px-4 py-4 lg:max-w-3xl lg:px-8">
        <Link to="/" className="flex items-center gap-3">
          <Mark className="size-8" />
          <span className="font-serif">Wedding Circle</span>
        </Link>
        <span className="text-sm text-muted tabular-nums">{step < 5 ? `${step + 1} / 5` : "Ready"}</span>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 pb-8 lg:max-w-3xl lg:px-8">
        {step === 0 ? (
          <section>
            <h1 className="font-serif text-4xl">Who is getting married?</h1>
            <p className="mt-2 text-muted">The circle is private. Guests join free. You will preview it, then choose Free or a one-time {feeLabel} Premium.</p>
            <p className="mt-3 text-sm text-muted">
              Signed in as {account.name}
              {account.religion ? ` · ${account.religion}` : ""}
              {account.tradition ? ` · ${account.tradition}` : ""}
            </p>
            <div className="mt-6 grid gap-4">
              <input className={fieldClass} placeholder="Bride's name" value={bride} onChange={(e) => setBride(e.target.value)} />
              <input className={fieldClass} placeholder="Groom's name" value={groom} onChange={(e) => setGroom(e.target.value)} />
              <input className={fieldClass} placeholder="Your name" value={hostName} onChange={(e) => setHostName(e.target.value)} />
              <input className={fieldClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <input className={fieldClass} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
              <input className={fieldClass} placeholder="Ceremony place" value={place} onChange={(e) => setPlace(e.target.value)} />
              <textarea className={fieldClass} rows={3} placeholder="A line about the wedding" value={story} onChange={(e) => setStory(e.target.value)} />
              <PickList
                label="Wedding type"
                value={weddingType}
                onChange={setWeddingType}
                options={WEDDING_TYPES.map((item) => ({ value: item, label: item }))}
              />
              <input className={fieldClass} type="email" placeholder="Contact email" value={account.email ?? contactEmail} readOnly={Boolean(account)} onChange={(e) => setContactEmail(e.target.value)} />
              <input className={fieldClass} placeholder="Contact phone" value={account.phone ?? contactPhone} readOnly={Boolean(account)} onChange={(e) => setContactPhone(e.target.value)} />
            </div>
            {namesOk ? null : <p className="mt-3 text-sm text-muted">Bride, groom, city, and the date are needed before Next.</p>}
            <div className="create-step-nav">
              <Link to="/" className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm">
                Back
              </Link>
              <Button disabled={!namesOk} onClick={() => setStep(1)}>
                Next
              </Button>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <section>
            <h1 className="font-serif text-4xl">Religion, region, culture</h1>
            <p className="mt-2 text-muted">This only suggests a shape. It never locks one in. You can leave it blank.</p>
            <div className="mt-6 grid gap-4">
              <PickList
                label="Religion"
                value={religion}
                onChange={(value) => { setReligion(value); setReady(false); }}
                options={[{ value: "", label: "Choose a religion" }, ...RELIGIONS.map((item) => ({ value: item, label: item }))]}
              />
              <PickList
                label="Tradition"
                value={region}
                onChange={(value) => { setRegion(value); setReady(false); }}
                options={[{ value: "", label: "Choose a tradition" }, ...REGIONS.map((item) => ({ value: item, label: `${item} culture` }))]}
              />
            </div>
            <textarea
              className={`${fieldClass} mt-4`}
              rows={3}
              placeholder="A custom note, if your traditions are not in the list"
              value={cultureNote}
              onChange={(e) => setCultureNote(e.target.value)}
            />
            <div className="create-step-nav">
              <Button variant="line" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={nextFromCulture}>Next</Button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section>
            <h1 className="font-serif text-4xl">Functions</h1>
            <p className="mt-2 text-muted">
              {religion || region
                ? `A starting list for a ${[region, religion].filter(Boolean).join(" ")} wedding. Rename or remove anything.`
                : "Add each gathering. Choose a religion or region on the previous step if you want suggestions."}
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              {functions.map((fn, i) => (
                <li key={`${fn.name}-${i}`} className="rounded-2xl border border-line bg-card p-3">
                  <input className={fieldClass} value={fn.name} onChange={(e) => updateFn(i, { name: e.target.value })} />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input className={fieldClass} type="date" value={fn.date} onChange={(e) => updateFn(i, { date: e.target.value })} />
                    <input className={fieldClass} type="time" value={fn.time} onChange={(e) => updateFn(i, { time: e.target.value })} />
                  </div>
                  <p className="mt-2 text-sm text-muted">{fn.note}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="min-h-11 text-sm text-muted" onClick={() => move(i, -1)}>Up</button>
                    <button type="button" className="min-h-11 text-sm text-muted" onClick={() => move(i, 1)}>Down</button>
                    <button type="button" className="min-h-11 text-sm text-muted" onClick={() => setFunctions(functions.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <Button
              variant="line"
              className="mt-3"
              onClick={() => setFunctions([...functions, { name: "New function", note: "", time: "18:00", date }])}
            >
              Add a function
            </Button>
            {functions.length === 0 ? <p className="mt-3 text-sm text-muted">Add at least one function before Next.</p> : null}
            <div className="create-step-nav">
              <Button variant="line" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={functions.length === 0} onClick={() => setStep(3)}>
                Next
              </Button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section>
            <h1 className="font-serif text-4xl">Preview the circle</h1>
            <p className="mt-2 text-muted">This is what guests will recognise. Nothing is charged, and no wedding is created yet.</p>
            <div className="mt-6 overflow-hidden rounded-card border border-line bg-card">
              <div className="create-circle-stage p-4">
                <WeddingCard wedding={{ bride, groom, date, city, place, cardTheme: "classic-default" }} preview />
              </div>
              <div className="p-4">
                <p className="text-sm text-muted">{[religion, region, weddingType].filter(Boolean).join(" · ") || "Classic Default"}</p>
                <p className="mt-1 font-serif text-3xl">{groom} & {bride}</p>
                <p className="mt-2">{date} · {city}</p>
                <p className="mt-2 text-muted">{place || city}</p>
                {story ? <p className="mt-3">{story}</p> : null}
                {cultureNote ? <p className="mt-2 text-sm text-muted">{cultureNote}</p> : null}
                <p className="mt-3 text-sm text-muted">{functions.length} functions · {contactEmail}</p>
              </div>
            </div>
            <ol className="mt-4 flex flex-col gap-2">
              {functions.map((fn) => (
                <li key={fn.name} className="flex justify-between gap-3 text-sm">
                  <span>{fn.name}</span>
                  <span className="text-muted tabular-nums">{fn.time}</span>
                </li>
              ))}
            </ol>
            <div className="create-step-nav">
              <Button variant="line" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)}>Next</Button>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section>
            <h1 className="font-serif text-4xl">Choose a plan</h1>
            <p className="mt-2 text-muted">Opening this page does not charge you or create the wedding. Guests never pay.</p>
            <div className="mt-6 grid gap-3">
              <article className="rounded-card border border-line bg-card p-4">
                <p className="text-sm text-muted">FREE</p>
                <p className="font-serif text-4xl">₹0</p>
                <p className="mt-1 text-sm text-muted">One-time. Not a subscription.</p>
                <ul className="mt-3 flex flex-col gap-1 text-sm">
                  <li>{FREE_STORAGE_LABEL} Wedding Circle cloud storage</li>
                  <li>One live stream playing at a time</li>
                  <li>Every theme for the host. Guests cannot change it</li>
                  <li>Chat, album, invitations, guest codes, and ceremonies stay included</li>
                </ul>
                <Button className="mt-4" disabled={busy} onClick={() => void openFree()}>
                  {pay === "pending" && !reference ? "Creating" : "Create free wedding"}
                </Button>
              </article>
              <article className="rounded-card border border-maroon/40 bg-card p-4">
                <p className="text-sm text-muted">PREMIUM</p>
                <p className="font-serif text-4xl">{feeLabel}</p>
                <p className="mt-1 text-sm text-muted">One-time for this wedding. Not a subscription.</p>
                <ul className="mt-3 flex flex-col gap-1 text-sm">
                  <li>{PREMIUM_STORAGE_LABEL} Wedding Circle cloud storage</li>
                  <li>{PREMIUM_THEME_COUNT} premium themes</li>
                  <li>One live stream at a time</li>
                  <li>Pin this wedding as your landing page, after a verified purchase</li>
                </ul>
                <div className="mt-4 grid gap-3">
                  <PickList
                    label="How you would pay"
                    value={method}
                    onChange={setMethod}
                    options={[
                      { value: "upi", label: "UPI" },
                      { value: "credit", label: "Credit card" },
                      { value: "debit", label: "Debit card" },
                    ]}
                  />
                  {method === "upi" ? (
                    <PickList
                      label="UPI app"
                      value={upiApp}
                      onChange={setUpiApp}
                      options={["GPay", "PhonePe", "Paytm", "BHIM"].map((app) => ({ value: app, label: app }))}
                    />
                  ) : (
                    <p className="text-sm text-muted">
                      {method === "credit" ? "Credit card" : "Debit card"} details connect with the payment provider. This preview does not ask for a card number.
                    </p>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted">Google Play Billing is not connected. This preview does not charge you and does not unlock Premium.</p>
                <div className="mt-4">
                  <label className="text-sm" htmlFor="voucher-code">Enter your voucher code</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      id="voucher-code"
                      className={fieldClass}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={16}
                      placeholder="12-character code"
                      value={voucherCode}
                      disabled={voucherBusy}
                      onChange={(event) => {
                        setVoucherCode(event.target.value.toUpperCase());
                        setVoucherOk(false);
                        setVoucherNote("");
                      }}
                    />
                    <Button type="button" variant="line" disabled={voucherBusy || voucherCode.trim().length < 12} onClick={() => void applyVoucher()}>
                      {voucherChecking ? "Checking…" : "Apply code"}
                    </Button>
                  </div>
                  {voucherNote ? <p className="mt-2 text-sm text-maroon" role="status">{voucherNote}</p> : null}
                  {voucherOk ? <p className="mt-2 font-serif text-3xl">Amount due ₹0</p> : null}
                </div>
                {pay === "failed" ? (
                  <p className="mt-3 rounded-2xl border border-line bg-paper px-4 py-3 text-sm">Payment failed — your wedding has not been charged or created.</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={voucherBusy || !voucherOk} onClick={() => void openWithVoucher()}>
                    {pay === "pending" && voucherDraft.current ? "Creating Premium wedding…" : "Create Premium wedding with voucher"}
                  </Button>
                  <Button disabled={busy} onClick={() => void payAndOpen("paid")}>
                    {pay === "pending" ? "Processing" : pay === "failed" ? "Try again" : `Pay ${feeLabel} and create`}
                  </Button>
                  {pay === "failed" ? null : (
                    <Button variant="line" disabled={busy} onClick={() => void payAndOpen("failed")}>
                      Preview a failed payment
                    </Button>
                  )}
                </div>
              </article>
            </div>
            <div className="create-step-nav">
              <Button
                variant="line"
                onClick={() => {
                  if (pay === "failed") {
                    setPay("idle");
                    setReference("");
                  }
                  setStep(3);
                }}
                disabled={pay === "pending"}
              >
                Back
              </Button>
            </div>
          </section>
        ) : null}

        {step === 5 ? (
          <section>
            <h1 className="font-serif text-4xl">Your Wedding Circle is ready.</h1>
            <p className="mt-3 text-muted">
              {isPremiumWedding(made) ? `Premium is active. ${PREMIUM_PRICE_LABEL} was verified for this wedding.` : `This wedding is Free. Classic Default, ${FREE_STORAGE_LABEL}, and one live stream at a time.`}
            </p>
            <p className="mt-3 text-muted">
              {shareReady
                ? "The invitation link works on any phone, even for someone who has never opened this site. They do not need an account."
                : "The circle is saved on this phone. The invitation could not be published for other phones yet. Try sharing again in a moment."}
            </p>
            {made && entryCodes.length > 0 ? (
              <div className="mt-4 rounded-card border border-line bg-card p-4 text-sm">
                <p className="font-medium">Give these codes to the right people</p>
                <ul className="mt-2">
                  {entryCodes.filter((item) => item.kind === "family").map((item) => (
                    <li key={item.id} className="mt-2 flex items-center justify-between gap-2">
                      <span className="min-w-0 break-all">Family · {item.code}</span>
                      <CeremonyInviteButton wedding={made} codeId={item.id} kind="family" />
                    </li>
                  ))}
                  {entryCodes.filter((item) => item.kind === "guest").map((item) => (
                    <li key={item.id} className="mt-2 flex items-center justify-between gap-2">
                      <span className="min-w-0 break-all">Guests · {item.code}</span>
                      <CeremonyInviteButton wedding={made} codeId={item.id} kind="guest" />
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-muted">They enter from the home page with Enter Wedding Code.</p>
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={() => void navigate({ to: "/w/$slug/invite", params: { slug: madeSlug } })}>
                Share invitation
              </Button>
              <Button variant="line" onClick={() => void navigate({ to: "/w/$slug", params: { slug: madeSlug } })}>
                Open the wedding
              </Button>
              {shareReady ? null : (
                <Button
                  variant="line"
                  onClick={() => {
                    const wedding = useWeddingStore.getState().weddings.find((item) => item.slug === madeSlug);
                    if (!wedding) return;
                    void pushCircle(wedding).then((result) => setShareReady(result === "ok"));
                  }}
                >
                  Try publishing again
                </Button>
              )}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );

  function updateFn(i: number, partial: Partial<Fn>) {
    setFunctions(functions.map((fn, j) => (j === i ? { ...fn, ...partial } : fn)));
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= functions.length) return;
    const next = functions.slice();
    const [item] = next.splice(i, 1);
    if (!item) return;
    next.splice(j, 0, item);
    setFunctions(next);
  }
}
