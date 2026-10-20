# Autenticação: LDAP/AD, MFA e conta de emergência

Guia de configuração para o Dono da instalação. Tudo fica em **Painel → Autenticação**.

## 1. Conta de emergência (faça primeiro)

A conta Dono criada pelo seed (`SEED_OWNER_EMAIL`) já é uma **conta de emergência**: um
Dono com senha local que continua entrando mesmo com o diretório fora do ar. Em
**Usuários**, outros Donos com senha local podem ser marcados ou desmarcados.

Com o diretório funcionando, você pode restringir o **login com senha local** às contas de
emergência (Autenticação → Política de acesso). A restrição exige ao menos uma conta de
emergência ativa, e a última delas não pode ser desmarcada enquanto a restrição valer.
Todo login por conta de emergência fica na auditoria como `auth.break_glass_login`.

## 2. Provedor LDAP

**Autenticação → Adicionar provedor.** Ao escolher o tipo (Active Directory ou OpenLDAP),
os campos de filtro e atributos são preenchidos com valores padrão.

| Campo | Active Directory | OpenLDAP |
|---|---|---|
| Segurança / porta | LDAPS / 636 (ou StartTLS / 389) | LDAPS / 636 (ou StartTLS / 389) |
| Conta de serviço | conta só de leitura, ex.: `CN=svc-status,OU=Servico,DC=empresa,DC=local` | ex.: `cn=svc-status,dc=empresa,dc=local` |
| Filtro de usuário | `sAMAccountName` ou `userPrincipalName` = `{username}` | `uid` ou `mail` = `{username}` |
| Identificador único | `objectGUID` | `entryUUID` |
| Grupos | `memberOf` + aninhados (`LDAP_MATCHING_RULE_IN_CHAIN`) | busca por `groupOfNames`, `groupOfUniqueNames` e `posixGroup` |

- A senha da conta de serviço é guardada cifrada (AES-256-GCM com o `APP_SECRET`) e nunca
  volta para a tela.
- Para certificados da PKI interna, cole a CA (PEM). Desmarcar "Validar o certificado"
  e usar "Sem TLS" são opções só para laboratório.
- **Testar conexão** confere servidor, TLS, conta de serviço e base DN antes de salvar.
- **Testar login** mostra o DN, os grupos e os papéis que a pessoa receberia, sem criar o
  usuário.

O usuário é criado no primeiro login (pelo login de rede ou, no AD, pelo UPN) e
atualizado a cada login: nome, e-mail, grupos e papéis. Mais de um provedor pode ser
cadastrado; eles são tentados em ordem.

**E-mail igual ao de um usuário local:** por segurança, o login LDAP é recusado
(`ldap_email_conflict`). Para vincular as contas, habilite "Vincular a usuários locais
existentes com o mesmo e-mail" no provedor, sabendo que quem controla o atributo de
e-mail no diretório passa a entrar naquela conta.

## 3. Mapeamento de grupos → papéis

Na página do provedor, associe o DN de um grupo a um papel em uma página (Leitor,
Operador ou Admin) ou, sem página, ao papel de **Dono** da instalação.

- Vale o maior papel entre os grupos da pessoa; grupos aninhados contam no AD.
- Por padrão, um papel atribuído à mão na equipe da página prevalece sobre o mapeado.
  Desmarque "Papel atribuído manualmente prevalece" para o grupo sempre mandar.
- Saiu do grupo, perde o papel no próximo login ou na próxima sincronização.

## 4. Sincronização e contas desativadas

O `worker` relê no diretório, a cada `LDAP_SYNC_MINUTES` (padrão 15), todos os usuários
vindos de cada provedor. Uma conta **desativada ou removida** do diretório:

- perde as sessões abertas e os papéis vindos de grupos;
- não entra mais pelo LDAP, nem com uma senha local antiga (exceto contas de emergência).

O login também verifica o diretório na hora, então a perda de acesso é imediata para
quem tenta entrar. Se o servidor LDAP estiver fora do ar, a sincronização para sem
desativar ninguém e o erro aparece na lista de provedores. O botão **Sincronizar agora**
roda a sincronização na hora.

## 5. Verificação em duas etapas (MFA)

Cada pessoa ativa em **Meu perfil** um ou mais métodos:

- **Aplicativo autenticador** (TOTP): Google Authenticator, Microsoft Authenticator,
  Authy e similares, pelo QR code.
- **Chave de segurança / passkey** (WebAuthn): YubiKey, Windows Hello, Touch ID etc.
- **Códigos de recuperação**: 10 códigos de uso único, gerados ao ativar o primeiro método
  e mostrados uma única vez.

O MFA vale para contas locais e LDAP: é pedido depois da senha. A sessão só fica liberada
depois do segundo fator (e o token da sessão é trocado nesse momento).

**Política** (Autenticação → Política de acesso): opcional, obrigatória para alguns papéis
ou para todos. Quem precisa e ainda não cadastrou é levado ao cadastro no próximo acesso;
o último método não pode ser removido enquanto a política exigir.

**Perdeu o celular ou a chave?** Use um código de recuperação. Sem eles, o Dono (qualquer
usuário) ou um Admin (membros da equipe da sua página, exceto Donos) usa **Redefinir MFA**;
os métodos são apagados, as sessões encerradas e a ação vai para a auditoria.

> As chaves de segurança ficam presas ao endereço do painel em que foram cadastradas
> (ex.: `status.empresa.com.br`) e exigem HTTPS (ou `localhost`). Cadastre a chave pelo
> endereço que a equipe usa no dia a dia.

## 6. Testando com servidores de laboratório

`docker/ldap-test/` sobe um OpenLDAP e um Samba AD já populados, os mesmos usados no CI.
Veja [docker/ldap-test/README.md](../docker/ldap-test/README.md).
