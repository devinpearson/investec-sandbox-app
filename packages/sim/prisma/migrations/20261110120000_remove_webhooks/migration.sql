-- Webhooks are gone: they aren't part of the Investec API.

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WebhookDelivery";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Webhook";
PRAGMA foreign_keys=on;
