# Diretórios de teste (LDAP e AD)

Servidores descartáveis para validar o login corporativo da F3. **Não use estas
senhas em produção.**

| Serviço                  | Imagem                    | Porta no host                      | Conta de serviço                                                        |
| ------------------------ | ------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| OpenLDAP                 | `osixia/openldap:1.5.0`   | 1389 (LDAP/StartTLS), 1636 (LDAPS) | `cn=svc-status,dc=empresa,dc=local` / `svc-pass`                        |
| Active Directory (Samba) | `diegogslomp/samba-ad-dc` | 2636 (LDAPS)                       | `CN=Servico Status,OU=Servico,DC=empresa,DC=local` / `Svc-Status-2026!` |

```bash
docker/ldap-test/start.sh
TEST_OPENLDAP=localhost:1389 TEST_SAMBA_AD=localhost:2636 pnpm --filter @status-page/core test
```

## Conteúdo

- **OpenLDAP** (`openldap.ldif`): usuários `ana`, `bruno` e `carla` (sem e-mail);
  grupos `NOC` (groupOfNames), `TI` (groupOfUniqueNames) e `plantao` (posixGroup).
- **AD** (`samba-seed.sh`): usuários `ana`, `bruno` e `carla`; grupos `NOC`, `TI` e
  `Operacao`, com `NOC` dentro de `Operacao` (grupo aninhado).

Senhas: `Senha-da-Ana-2026` no OpenLDAP e `Senha-da-Ana-2026!` no AD (idem para os
outros usuários).

Os certificados são autoassinados: no painel, desmarque "Validar o certificado do
servidor" ou informe a CA do servidor.
