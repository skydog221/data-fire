-- CreateTable
CREATE TABLE "EventRecord" (
    "id" BIGSERIAL NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userUuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "properties" TEXT,
    "ts" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventRecord_projectId_ts_idx" ON "EventRecord"("projectId", "ts");

-- CreateIndex
CREATE INDEX "EventRecord_projectId_userUuid_idx" ON "EventRecord"("projectId", "userUuid");

-- CreateIndex
CREATE INDEX "EventRecord_projectId_category_name_ts_idx" ON "EventRecord"("projectId", "category", "name", "ts");
