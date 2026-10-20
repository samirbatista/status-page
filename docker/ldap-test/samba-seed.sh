#!/usr/bin/env bash
# Popula o AD de teste (Samba) usado na validação do login AD.
# Uso: docker exec -i <container samba> bash < docker/ldap-test/samba-seed.sh
set -euo pipefail
st() { samba-tool "$@"; }

st ou create "OU=Usuarios,DC=empresa,DC=local" || true
st ou create "OU=Grupos,DC=empresa,DC=local" || true
st ou create "OU=Servico,DC=empresa,DC=local" || true

st user create svc-status 'Svc-Status-2026!' --userou=OU=Servico --given-name=Servico --surname=Status
st user create ana 'Senha-da-Ana-2026!' --userou=OU=Usuarios --given-name=Ana --surname=Souza --mail-address=ana@empresa.local
st user create bruno 'Senha-do-Bruno-2026!' --userou=OU=Usuarios --given-name=Bruno --surname=Lima --mail-address=bruno@empresa.local
st user create carla 'Senha-da-Carla-2026!' --userou=OU=Usuarios --given-name=Carla --surname=Dias --mail-address=carla@empresa.local

st group add NOC --groupou=OU=Grupos
st group add Operacao --groupou=OU=Grupos
st group add TI --groupou=OU=Grupos
# Grupo aninhado: NOC faz parte de Operacao.
st group addmembers Operacao NOC
st group addmembers NOC ana,carla
st group addmembers TI bruno
