#!/usr/bin/env bash
# Sobe os diretórios de teste: OpenLDAP (porta 1389/1636) e Samba AD (LDAPS na 2636).
# Usado pelo CI e para testar o login LDAP/AD localmente:
#   docker/ldap-test/start.sh
#   TEST_OPENLDAP=localhost:1389 TEST_SAMBA_AD=localhost:2636 pnpm --filter @status-page/core test
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

docker rm -f sp-openldap sp-samba >/dev/null 2>&1 || true

docker run -d --name sp-openldap -p 1389:389 -p 1636:636 \
  -e LDAP_ORGANISATION=Empresa -e LDAP_DOMAIN=empresa.local -e LDAP_ADMIN_PASSWORD=admin-pass \
  -e LDAP_READONLY_USER=true -e LDAP_READONLY_USER_USERNAME=svc-status \
  -e LDAP_READONLY_USER_PASSWORD=svc-pass -e LDAP_TLS_VERIFY_CLIENT=never \
  -v "$HERE/openldap.ldif:/container/service/slapd/assets/config/bootstrap/ldif/custom/50-empresa.ldif:ro" \
  osixia/openldap:1.5.0 --copy-service >/dev/null

docker run -d --name sp-samba --hostname dc01 --privileged -p 2636:636 \
  -e REALM=EMPRESA.LOCAL -e DOMAIN=EMPRESA -e 'ADMIN_PASS=Adm1n-Pass-2026!' \
  -e DNS_FORWARDER=127.0.0.11 -e BIND_NETWORK_INTERFACES=false \
  diegogslomp/samba-ad-dc:latest >/dev/null

echo "Aguardando o OpenLDAP..."
until docker exec sp-openldap ldapsearch -x -H ldap://localhost -D cn=svc-status,dc=empresa,dc=local \
  -w svc-pass -b dc=empresa,dc=local '(uid=ana)' dn 2>/dev/null | grep -q '^dn:'; do sleep 2; done

echo "Aguardando o Samba AD (o provisionamento leva alguns minutos)..."
until docker exec sp-samba samba-tool user list >/dev/null 2>&1 \
  && docker exec sp-samba bash -c 'exec 3<>/dev/tcp/127.0.0.1/636' 2>/dev/null; do sleep 5; done
docker exec -i sp-samba bash < "$HERE/samba-seed.sh" >/dev/null
echo "Diretórios de teste prontos."
