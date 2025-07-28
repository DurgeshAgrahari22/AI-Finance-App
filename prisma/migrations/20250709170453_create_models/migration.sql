/*
  Warnings:

  - You are about to drop the column `inRecurring` on the `transactions` table. All the data in the column will be lost.
  - You are about to drop the column `nextRecurringData` on the `transactions` table. All the data in the column will be lost.
  - The `status` column on the `transactions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `updatedAt` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "budgets" ALTER COLUMN "lastAlertSent" DROP NOT NULL;

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "inRecurring",
DROP COLUMN "nextRecurringData",
ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextRecurringDate" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- DropEnum
DROP TYPE "TrasanctionTimeStatus";
