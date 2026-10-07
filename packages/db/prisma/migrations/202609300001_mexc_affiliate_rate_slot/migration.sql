INSERT INTO "SyncRateSlot" ("id", "nextRequestAt")
VALUES ('mexc-affiliate', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
