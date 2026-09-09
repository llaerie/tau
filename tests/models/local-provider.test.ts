import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LocalDeterministicProvider, LOCAL_EMBEDDING_DIMENSIONS, placeholderForSchema } from "@/lib/models/local-provider";

const local = new LocalDeterministicProvider();

describe("LocalDeterministicProvider.complete", () => {
  it("is deterministic: same input yields same output", async () => {
    const req = { messages: [{ role: "user" as const, content: "What is our cash runway?" }] };
    const a = await local.complete(req);
    const b = await local.complete(req);
    expect(a.text).toBe(b.text);
    expect(a.text).toBe("LOCAL_DETERMINISTIC: What is our cash runway?");
    expect(a.stopReason).toBe("end");
    expect(a.model).toEqual({ provider: "local", model: "local-deterministic", version: "1", deterministic: true });
    expect(a.model.deterministic).toBe(true);
  });

  it("truncates the echo to 200 characters of the last user message", async () => {
    const long = "x".repeat(500);
    const res = await local.complete({ messages: [{ role: "user", content: long }] });
    expect(res.text).toBe("LOCAL_DETERMINISTIC: " + "x".repeat(200));
  });

  it("returns a tool call when tools are provided and the message contains a tool JSON block", async () => {
    const res = await local.complete({
      messages: [{ role: "user", content: 'Please run this:\n```json\n{"tool": "trial_balance", "input": {"asOf": "2026-08-31"}}\n```' }],
      tools: [{ name: "trial_balance", description: "TB", inputSchema: { type: "object" } }],
    });
    expect(res.stopReason).toBe("tool_use");
    expect(res.toolCalls).toEqual([{ name: "trial_balance", input: { asOf: "2026-08-31" } }]);
  });

  it("ignores tool JSON naming a tool that was not provided", async () => {
    const res = await local.complete({
      messages: [{ role: "user", content: '{"tool": "pay_vendor", "input": {}}' }],
      tools: [{ name: "trial_balance", description: "TB", inputSchema: { type: "object" } }],
    });
    expect(res.toolCalls).toEqual([]);
    expect(res.stopReason).toBe("end");
  });

  it("returns a minimal JSON object satisfying required fields when jsonSchema is set", async () => {
    const res = await local.complete({
      messages: [{ role: "user", content: "extract" }],
      jsonSchema: {
        type: "object",
        required: ["name", "count", "ok", "items", "status"],
        properties: {
          name: { type: "string" },
          count: { type: "number" },
          ok: { type: "boolean" },
          items: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["OPEN", "CLOSED"] },
          optional: { type: "string" },
        },
      },
    });
    expect(res.json).toEqual({ name: "", count: 0, ok: false, items: [], status: "OPEN" });
    expect(JSON.parse(res.text)).toEqual(res.json);
  });

  it("placeholderForSchema handles nested objects", () => {
    expect(placeholderForSchema({ type: "object", required: ["a"], properties: { a: { type: "object", required: ["b"], properties: { b: { type: "integer" } } } } })).toEqual({ a: { b: 0 } });
  });
});

describe("LocalDeterministicProvider.classify", () => {
  const labels = [
    { key: "software_subscriptions", description: "SaaS tools and software licences" },
    { key: "travel", description: "Flights, hotels and travel expenses" },
    { key: "meals", description: "Restaurants and meals" },
  ];

  it("picks the label with the highest keyword overlap and reports confidence as overlap ratio", async () => {
    const res = await local.classify({ text: "Monthly software subscription for Figma", labels });
    expect(res.label).toBe("software_subscriptions");
    expect(res.confidence).toBeGreaterThan(0);
    expect(res.confidence).toBeLessThanOrEqual(1);
    expect(res.reason).toContain("software");
  });

  it("splits label keys on underscores and matches case-insensitively", async () => {
    const res = await local.classify({ text: "HOTELS booked for the conference", labels });
    expect(res.label).toBe("travel");
  });

  it("returns null with zero confidence when nothing overlaps", async () => {
    const res = await local.classify({ text: "zzz qqq", labels });
    expect(res.label).toBeNull();
    expect(res.confidence).toBe(0);
  });
});

describe("LocalDeterministicProvider.extract", () => {
  it("extracts recognizable fields with regex", async () => {
    const schema = z.object({ vendor: z.string(), invoiceNumber: z.string(), date: z.string(), total: z.string(), email: z.string().optional() });
    const text = "Vendor: Acme Cloud Inc\nInvoice #INV-2041\nDate: 2026-08-15\nSubtotal: $1,200.00\nTax: $96.00\nTotal: $1,296.00\nBilling: ap@acme.example";
    const res = await local.extract(text, schema);
    expect(res.data).toEqual({ vendor: "Acme Cloud Inc", invoiceNumber: "INV-2041", date: "2026-08-15", total: "1296.00", email: "ap@acme.example" });
    expect(res.confidence).toBe(1);
  });

  it("coerces to number when the schema expects a number", async () => {
    const schema = z.object({ amount: z.number() });
    const res = await local.extract("Amount due: $42.50", schema);
    expect(res.data).toEqual({ amount: 42.5 });
  });

  it("returns null with confidence 0 when fields are unrecognizable", async () => {
    const schema = z.object({ frobnicator: z.string() });
    const res = await local.extract("Invoice total $10.00", schema);
    expect(res.data).toBeNull();
    expect(res.confidence).toBe(0);
  });
});

describe("LocalDeterministicProvider.verify", () => {
  const evidence = [{ label: "TB", content: "Cash balance 125,000.00 as of 2026-08-31" }];

  it("returns CONTRADICTED when a claimed number mismatches the computed one", async () => {
    const res = await local.verify({
      claim: "Cash is $130,000",
      evidence,
      numbersToCheck: [{ label: "cash", claimed: "$130,000.00", computed: "125000.00" }],
    });
    expect(res.verdict).toBe("CONTRADICTED");
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]).toContain("cash");
  });

  it("returns SUPPORTED when all numbers match within tolerance and evidence is present", async () => {
    const res = await local.verify({
      claim: "Cash balance is 125,000",
      evidence,
      numbersToCheck: [
        { label: "cash", claimed: "$125,000.00", computed: "125000" },
        { label: "ratio", claimed: "1.2504", computed: "1.25" },
      ],
    });
    expect(res.verdict).toBe("SUPPORTED");
    expect(res.issues).toEqual([]);
  });

  it("returns INSUFFICIENT_EVIDENCE when evidence is empty", async () => {
    const res = await local.verify({ claim: "Cash is 125,000", evidence: [] });
    expect(res.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("treats unparseable numbers as contradictions", async () => {
    const res = await local.verify({ claim: "x", evidence, numbersToCheck: [{ label: "n", claimed: "abc", computed: "1" }] });
    expect(res.verdict).toBe("CONTRADICTED");
  });
});

describe("LocalDeterministicProvider.embed", () => {
  it("returns 256-dim deterministic unit vectors", async () => {
    const [a, b, c] = await local.embed(["accounts payable aging", "accounts payable aging", "quarterly tax estimate"]);
    expect(local.dimensions).toBe(LOCAL_EMBEDDING_DIMENSIONS);
    expect(a).toHaveLength(256);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("returns a zero vector for empty text", async () => {
    const [v] = await local.embed([""]);
    expect(v.every((x) => x === 0)).toBe(true);
  });
});
