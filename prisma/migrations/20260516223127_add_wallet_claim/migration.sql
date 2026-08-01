-- CreateTable
CREATE TABLE "WalletClaim" (
    "id" TEXT NOT NULL,
    "claimToken" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedTxHash" TEXT,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "WalletClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletClaim_claimToken_key" ON "WalletClaim"("claimToken");

-- CreateIndex
CREATE INDEX "WalletClaim_hex_idx" ON "WalletClaim"("hex");

-- CreateIndex
CREATE INDEX "WalletClaim_expiresAt_idx" ON "WalletClaim"("expiresAt");
