-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralPaidAt" TIMESTAMP(3),
ADD COLUMN     "signupIpHash" TEXT;

-- CreateIndex
CREATE INDEX "User_signupIpHash_idx" ON "User"("signupIpHash");
