-- CreateEnum
CREATE TYPE "TransactionMode" AS ENUM ('UPI', 'UPI_MANDATE', 'CARD', 'NEFT', 'IMPS', 'RTGS', 'ATM', 'EMI', 'BILL_DUE', 'OTHER');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "fromIdentifier" TEXT,
ADD COLUMN     "toIdentifier" TEXT,
ADD COLUMN     "transactionMode" "TransactionMode" NOT NULL DEFAULT 'UPI';
