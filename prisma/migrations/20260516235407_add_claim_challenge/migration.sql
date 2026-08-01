/*
  Warnings:

  - Added the required column `challengeNanoMcm` to the `WalletClaim` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WalletClaim" ADD COLUMN     "challengeNanoMcm" INTEGER NOT NULL;
