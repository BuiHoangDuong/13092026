import { z } from "zod";

export const assetSchema = z.string().trim().min(1).max(16).transform((value) => value.toUpperCase());
export const decimalStringSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/, "Must be a decimal string");
export const rateSchema = z.string()
  .regex(/^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/, "Rate must be between 0 and 1 with at most 4 decimal places");
export const moneySchema = z.object({ amount: decimalStringSchema, asset: assetSchema });
export type Money = z.infer<typeof moneySchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() })
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

const localeKeySchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);
export const localeSchema = localeKeySchema.default("en");
export const publishStatusSchema = z.enum(["DRAFT", "PUBLISHED"]);
export const slugSchema = z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");
export const localizedExchangeSchema = z.record(localeKeySchema, z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(4000)
})).refine((value) => Boolean(value.en), "English content is required");
export const localizedGuideSchema = z.record(localeKeySchema, z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50000)
})).refine((value) => Boolean(value.en), "English content is required");
export const localizedTextSchema = z.record(localeKeySchema, z.string().trim().min(1).max(4000))
  .refine((value) => Boolean(value.en), "English content is required");

export const adminExchangeCreateSchema = z.object({
  slug: slugSchema, name: z.string().trim().min(1).max(120), status: publishStatusSchema.default("DRAFT"),
  defaultCashbackRate: rateSchema.nullable().default(null), i18n: localizedExchangeSchema
});
export const adminExchangeUpdateSchema = adminExchangeCreateSchema.partial().extend({ id: z.string().min(1) });
export const adminOfferCreateSchema = z.object({
  exchangeId: z.string().min(1), status: publishStatusSchema.default("DRAFT"), cashbackRate: rateSchema,
  conditions: localizedTextSchema, verifiedAt: z.iso.datetime().nullable().optional()
});
export const adminOfferUpdateSchema = adminOfferCreateSchema.partial().extend({ id: z.string().min(1) });
export const adminLinkCreateSchema = z.object({
  exchangeId: z.string().min(1), offerId: z.string().min(1).nullable().default(null),
  destination: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Only HTTP(S) destinations are allowed"),
  active: z.boolean().default(true)
});
export const adminLinkUpdateSchema = adminLinkCreateSchema.partial().extend({ id: z.string().min(1) });
export const adminGuideCreateSchema = z.object({
  slug: slugSchema, exchangeId: z.string().min(1).nullable().default(null), status: publishStatusSchema.default("DRAFT"),
  i18n: localizedGuideSchema
});
export const adminGuideUpdateSchema = adminGuideCreateSchema.partial().extend({ id: z.string().min(1) });

export type AdminExchangeCreate = z.infer<typeof adminExchangeCreateSchema>;
export type AdminExchangeUpdate = z.infer<typeof adminExchangeUpdateSchema>;
export type AdminOfferCreate = z.infer<typeof adminOfferCreateSchema>;
export type AdminOfferUpdate = z.infer<typeof adminOfferUpdateSchema>;
export type AdminLinkCreate = z.infer<typeof adminLinkCreateSchema>;
export type AdminLinkUpdate = z.infer<typeof adminLinkUpdateSchema>;
export type AdminGuideCreate = z.infer<typeof adminGuideCreateSchema>;
export type AdminGuideUpdate = z.infer<typeof adminGuideUpdateSchema>;

export const exchangeSchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(), status: publishStatusSchema,
  logoUrl: z.string().regex(/^\/exchange-logos\/[a-z0-9]+(?:-[a-z0-9]+)*\.png$/).nullable(),
  defaultCashbackRate: decimalStringSchema.nullable(), locale: localeSchema,
  offers: z.array(z.object({ id: z.string(), cashbackRate: decimalStringSchema, conditions: z.unknown().nullable() }))
});
export const exchangesResponseSchema = z.object({ exchanges: z.array(exchangeSchema) });

export const registerSchema = z.object({ email: z.email(), password: z.string().min(10).max(200), locale: localeSchema.optional() });
export const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export const uidLinkCreateSchema = z.object({
  exchangeId: z.string().min(1), uid: z.string().trim().min(1).max(128), referralLinkId: z.string().optional()
});

export const walletResponseSchema = z.object({
  balances: z.array(z.object({
    asset: assetSchema,
    pending: decimalStringSchema,
    available: decimalStringSchema,
    reserved: decimalStringSchema,
    withdrawn: decimalStringSchema,
    receivable: decimalStringSchema
  })),
  lastImportAt: z.iso.datetime().nullable(),
  sourceAsOf: z.iso.datetime().nullable(),
  hasData: z.boolean()
});

export const withdrawalCreateSchema = z.object({
  asset: assetSchema, amount: decimalStringSchema.refine((v) => !v.startsWith("-") && v !== "0"),
  network: z.string().trim().min(1).max(32), address: z.string().trim().min(8).max(256)
});
export const withdrawalDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "MARK_PAID"]), note: z.string().max(1000).optional(), payoutRef: z.string().max(256).optional()
});

export const importMetadataSchema = z.object({
  exchangeId: z.string().min(1), rootAccount: z.string().trim().min(1).max(200), reportType: z.enum(["TRANSACTION", "AGGREGATE"]),
  periodStart: z.iso.datetime(), periodEnd: z.iso.datetime(), sourceTz: z.string().trim().min(1).max(100)
});
export type ImportMetadata = z.infer<typeof importMetadataSchema>;
export const importAcceptedSchema = z.object({ batchId: z.string(), status: z.literal("UPLOADED") });
export const importPreviewSchema = z.object({
  batch: z.object({
    id: z.string(), exchangeId: z.string(), rootAccount: z.string(), reportType: z.enum(["TRANSACTION", "AGGREGATE"]),
    status: z.enum(["UPLOADED", "PARSING", "PREVIEW", "COMMITTING", "PUBLISHED", "FAILED"]),
    periodStart: z.iso.datetime(), periodEnd: z.iso.datetime(), sourceTz: z.string(), sourceAsOf: z.iso.datetime().nullable(),
    totals: z.unknown().nullable(), createdAt: z.iso.datetime()
  }),
  preview: z.object({ totalRows: z.number().int().nonnegative(), flaggedRows: z.number().int().nonnegative(), rows: z.array(z.object({ id: z.string(), raw: z.unknown(), normalized: z.unknown().nullable(), flags: z.unknown().nullable() })) })
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const jobPayloadSchema = z.object({ type: z.string(), payload: z.record(z.string(), z.unknown()) });
