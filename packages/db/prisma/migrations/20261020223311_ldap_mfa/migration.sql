-- CreateEnum
CREATE TYPE "LdapKind" AS ENUM ('active_directory', 'openldap');

-- CreateEnum
CREATE TYPE "LdapSecurity" AS ENUM ('none', 'starttls', 'ldaps');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "identity_id" UUID;

-- AlterTable
ALTER TABLE "user_identities" ADD COLUMN     "disabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "dn" TEXT,
ADD COLUMN     "groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "last_sync_at" TIMESTAMPTZ(3),
ADD COLUMN     "ldap_provider_id" UUID,
ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "owner_via_ldap" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ldap_providers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LdapKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "security" "LdapSecurity" NOT NULL DEFAULT 'ldaps',
    "verify_certificate" BOOLEAN NOT NULL DEFAULT true,
    "ca_certificate" TEXT,
    "bind_dn" TEXT NOT NULL,
    "bind_password_enc" TEXT NOT NULL,
    "base_dn" TEXT NOT NULL,
    "user_filter" TEXT NOT NULL,
    "username_attribute" TEXT NOT NULL,
    "email_attribute" TEXT NOT NULL,
    "name_attribute" TEXT NOT NULL,
    "unique_id_attribute" TEXT NOT NULL,
    "nested_groups" BOOLEAN NOT NULL DEFAULT true,
    "group_base_dn" TEXT,
    "group_filter" TEXT,
    "manual_roles_win" BOOLEAN NOT NULL DEFAULT true,
    "link_by_email" BOOLEAN NOT NULL DEFAULT false,
    "timeout_ms" INTEGER NOT NULL DEFAULT 5000,
    "last_sync_at" TIMESTAMPTZ(3),
    "last_sync_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ldap_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ldap_group_mappings" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "group_dn" TEXT NOT NULL,
    "page_id" UUID,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ldap_group_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_secrets" (
    "user_id" UUID NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "last_step" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_secrets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rp_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ldap_group_mappings_page_id_idx" ON "ldap_group_mappings"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "ldap_group_mappings_provider_id_group_dn_page_id_key" ON "ldap_group_mappings"("provider_id", "group_dn", "page_id");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_codes_user_id_code_hash_key" ON "recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE INDEX "sessions_identity_id_idx" ON "sessions"("identity_id");

-- CreateIndex
CREATE INDEX "user_identities_ldap_provider_id_idx" ON "user_identities"("ldap_provider_id");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_ldap_provider_id_fkey" FOREIGN KEY ("ldap_provider_id") REFERENCES "ldap_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "user_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ldap_group_mappings" ADD CONSTRAINT "ldap_group_mappings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ldap_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ldap_group_mappings" ADD CONSTRAINT "ldap_group_mappings_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_secrets" ADD CONSTRAINT "totp_secrets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mapeamento global (sem página) só pode conceder o papel de Dono, e vice-versa.
ALTER TABLE "ldap_group_mappings" ADD CONSTRAINT "ldap_group_mappings_owner_scope"
  CHECK (("role" = 'owner') = ("page_id" IS NULL));

-- NULL não colide no índice único acima; garante um único mapeamento global por grupo.
CREATE UNIQUE INDEX "ldap_group_mappings_global_key"
  ON "ldap_group_mappings"("provider_id", "group_dn") WHERE "page_id" IS NULL;
