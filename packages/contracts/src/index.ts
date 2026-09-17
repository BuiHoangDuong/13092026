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
  hasData: z.boolean(),
  history: z.array(z.object({
    id: z.string(), asset: assetSchema,
    type: z.enum(["CREDIT", "HOLD_RELEASE", "WITHDRAWAL_RESERVE", "WITHDRAWAL_RELEASE", "WITHDRAWAL_SETTLE", "ADJUSTMENT", "REVERSAL", "CLAWBACK"]),
    amount: decimalStringSchema,
    createdAt: z.iso.datetime(), availableAt: z.iso.datetime().nullable()
  })),
  nextCursor: z.string().nullable()
});
export type WalletResponse = z.infer<typeof walletResponseSchema>;
export const lookupRequestSchema = z.object({ exchangeId: z.string().trim().min(1).max(128), uid: z.string().trim().min(1).max(128) }).strict();
export const lookupResponseSchema = z.object({
  balances: z.array(z.object({ asset: assetSchema, pending: decimalStringSchema, available: decimalStringSchema }).strict()),
  hasData: z.boolean(), lastImportAt: z.iso.datetime().nullable(), sourceAsOf: z.iso.datetime().nullable()
}).strict();
export type LookupResponse = z.infer<typeof lookupResponseSchema>;
export const otpRequestSchema = lookupRequestSchema.extend({ email: z.email().max(254).transform(v => v.trim().toLowerCase()) });
export const otpVerifySchema = z.object({ otpId: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }).strict();

export const withdrawalCreateSchema = z.object({
  asset: assetSchema, amount: z.string().regex(/^\d{1,20}(?:\.\d{1,10})?$/),
  network: z.string().trim().min(1).max(32), address: z.string().trim().min(8).max(256)
}).strict();
export const withdrawalDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "MARK_PAID"]), note: z.string().trim().max(1000).optional(), payoutRef: z.string().trim().min(1).max(256).optional()
}).strict().refine(v => v.decision !== "MARK_PAID" || Boolean(v.payoutRef), "Payout reference is required");
export const payoutNetworkSchema = z.enum(["ETHEREUM", "BSC", "ARBITRUM", "OPTIMISM", "BASE", "TRON"]);
export const payoutRoutesSchema = z.record(z.string().regex(/^[A-Z0-9]{1,16}$/), z.array(payoutNetworkSchema).min(1));
export type PayoutRoutes = z.infer<typeof payoutRoutesSchema>;
export const withdrawalSchema = z.object({
  id: z.string(), uidAccountId: z.string(), uid: z.string(), exchangeId: z.string(), email: z.string(),
  asset: assetSchema, amount: decimalStringSchema, network: z.string(), address: z.string(), isFirst: z.boolean(),
  status: z.enum(["REQUESTED", "UNDER_REVIEW", "AUTO_APPROVED", "APPROVED", "PAID", "REJECTED", "CANCELLED"]),
  payoutRef: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime()
});
export const withdrawalsResponseSchema = z.object({ withdrawals: z.array(withdrawalSchema), nextCursor: z.string().nullable() });
export type WithdrawalsResponse = z.infer<typeof withdrawalsResponseSchema>;

export const adminAnalyticsResponseSchema = z.object({
  generatedAt: z.iso.datetime(), rangeDays: z.number().int().min(1).max(90), totalClicks: z.number().int().nonnegative(),
  clicksByDay: z.array(z.object({ day: z.iso.date(), clicks: z.number().int().nonnegative() })),
  links: z.array(z.object({ linkId: z.string(), exchangeId: z.string(), exchange: z.string(), destination: z.string(), clicks: z.number().int().nonnegative() })),
  exchanges: z.array(z.object({ exchangeId: z.string(), exchange: z.string(), clicks: z.number().int().nonnegative() })),
  attribution: z.array(z.object({
    exchangeId: z.string(), exchange: z.string(), attributedRecords: z.number().int().nonnegative(),
    unattributedRecords: z.number().int().nonnegative(), attributedCommission: decimalStringSchema,
    unattributedCommission: decimalStringSchema, creditedCashback: decimalStringSchema
  }))
});
export type AdminAnalyticsResponse = z.infer<typeof adminAnalyticsResponseSchema>;

export const adminSyncStatusResponseSchema = z.object({
  generatedAt: z.iso.datetime(), apiSync: z.object({ enabled: z.boolean(), state: z.enum(["DISABLED", "IDLE", "RUNNING", "FAILED"]) }),
  lastSuccessfulImportAt: z.iso.datetime().nullable(), sourceAsOf: z.iso.datetime().nullable(),
  jobs: z.array(z.object({ state: z.enum(["PENDING", "CLAIMED", "DONE", "FAILED"]), count: z.number().int().nonnegative() })),
  imports: z.array(z.object({
    id: z.string(), exchangeId: z.string(), exchange: z.string(), rootAccount: z.string(),
    status: z.enum(["UPLOADED", "PARSING", "PREVIEW", "COMMITTING", "PUBLISHED", "FAILED"]),
    createdAt: z.iso.datetime(), publishedAt: z.iso.datetime().nullable(), sourceAsOf: z.iso.datetime().nullable()
  }))
});
export type AdminSyncStatusResponse = z.infer<typeof adminSyncStatusResponseSchema>;

export const adminAccountActivityResponseSchema = z.object({
  account: z.object({ id: z.string(), uid: z.string(), exchangeId: z.string(), exchange: z.string(), boundEmail: z.string().nullable(), createdAt: z.iso.datetime() }),
  activity: z.array(z.object({
    id: z.string(), kind: z.enum(["COMMISSION", "WALLET", "WITHDRAWAL"]), occurredAt: z.iso.datetime(),
    asset: z.string(), amount: decimalStringSchema, status: z.string(), detail: z.string().nullable()
  })),
  nextCursor: z.string().nullable()
});
export type AdminAccountActivityResponse = z.infer<typeof adminAccountActivityResponseSchema>;

export const operationalHealthResponseSchema = z.object({
  ok: z.boolean(), status: z.enum(["OK", "DEGRADED"]), service: z.literal("web"), checkedAt: z.iso.datetime(),
  database: z.object({ ok: z.boolean() }),
  queue: z.object({ pending: z.number().int().nonnegative(), claimed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), oldestPendingAgeSeconds: z.number().nonnegative().nullable() }),
  worker: z.object({ status: z.enum(["HEALTHY", "STALE", "MISSING"]), lastHeartbeatAt: z.iso.datetime().nullable(), ageSeconds: z.number().nonnegative().nullable() }),
  imports: z.object({ windowHours: z.literal(24), total: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), errorRate: z.number().min(0).max(1) }),
  alerts: z.array(z.enum(["OLDEST_JOB", "WORKER_HEARTBEAT", "IMPORT_ERROR_RATE"]))
});
export type OperationalHealthResponse = z.infer<typeof operationalHealthResponseSchema>;

export const importMetadataSchema = z.object({
  exchangeId: z.string().min(1), rootAccount: z.string().trim().min(1).max(200), reportType: z.enum(["TRANSACTION", "AGGREGATE"]),
  periodStart: z.iso.datetime(), periodEnd: z.iso.datetime(), sourceTz: z.string().trim().min(1).max(100),
  sourceAsOf: z.iso.datetime().optional()
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
