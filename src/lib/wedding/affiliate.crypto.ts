import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

export function sealJson(value: Record<string, string>, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { cipher: Buffer.concat([body, tag]).toString("base64"), nonce: iv.toString("base64") };
}

export function openJson(payload: { cipher: string; nonce: string }, key: string) {
  const iv = Buffer.from(payload.nonce, "base64");
  const packed = Buffer.from(payload.cipher, "base64");
  if (iv.length !== 12 || packed.length < 17) throw new Error("unreadable");
  const tag = packed.subarray(packed.length - 16);
  const body = packed.subarray(0, packed.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), iv);
  decipher.setAuthTag(tag);
  const text = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("unreadable");
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value === "string") fields[name] = value;
  }
  return fields;
}

export function signAmazonSearch(input: { accessKey: string; secretKey: string; partnerTag: string; now?: Date }) {
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const host = "webservices.amazon.in";
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems";
  const payload = JSON.stringify({
    Keywords: "bridal lehenga",
    SearchIndex: "All",
    ItemCount: 1,
    PartnerTag: input.partnerTag,
    PartnerType: "Associates",
    Marketplace: "www.amazon.in",
    Resources: ["ItemInfo.Title"],
  });
  const canonicalHeaders = `content-encoding:amz-1.0\ncontent-type:application/json; charset=utf-8\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`;
  const signedHeaders = "content-encoding;content-type;host;x-amz-date;x-amz-target";
  const canonical = ["POST", "/paapi5/searchitems", "", canonicalHeaders, signedHeaders, createHash("sha256").update(payload).digest("hex")].join("\n");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/eu-west-1/ProductAdvertisingAPI/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
  const signature = createHmac("sha256", hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, day), "eu-west-1"), "ProductAdvertisingAPI"), "aws4_request"))
    .update(stringToSign)
    .digest("hex");
  return {
    url: `https://${host}/paapi5/searchitems`,
    payload,
    headers: {
      Host: host,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "amz-1.0",
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
