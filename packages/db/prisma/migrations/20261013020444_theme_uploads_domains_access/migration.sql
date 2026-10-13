/*
  Warnings:

  - Added the required column `verification_token` to the `page_domains` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PrivateAccessMode" AS ENUM ('login', 'ip', 'login_or_ip', 'login_and_ip');

-- CreateEnum
CREATE TYPE "ThemeKind" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('image', 'font');

-- AlterTable
-- Domínios já existentes recebem um token aleatório (ainda não havia API para criá-los).
ALTER TABLE "page_domains" ADD COLUMN     "verification_token" TEXT NOT NULL DEFAULT md5(random()::text);
ALTER TABLE "page_domains" ALTER COLUMN "verification_token" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "allowed_cidrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "private_access" "PrivateAccessMode" NOT NULL DEFAULT 'login';

-- CreateTable
CREATE TABLE "page_themes" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "kind" "ThemeKind" NOT NULL,
    "data" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "page_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "kind" "UploadKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "page_themes_page_id_kind_key" ON "page_themes"("page_id", "kind");

-- CreateIndex
CREATE INDEX "uploads_page_id_idx" ON "uploads"("page_id");

-- AddForeignKey
ALTER TABLE "page_themes" ADD CONSTRAINT "page_themes_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
