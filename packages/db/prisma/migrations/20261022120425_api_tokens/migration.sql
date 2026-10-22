-- CreateTable
CREATE TABLE "api_tokens" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "last_used_ip" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_page_id_idx" ON "api_tokens"("page_id");

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
