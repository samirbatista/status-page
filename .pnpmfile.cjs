// O @prisma/client declara a CLI `prisma` e o `typescript` como peers opcionais.
// Como ambos existem no workspace (devDependencies), o pnpm os resolveria como
// peers e eles (com Prisma Studio, PGlite etc.) iriam parar nas imagens de
// produção. O client gerado não usa nenhum dos dois em runtime.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === '@prisma/client' && pkg.peerDependencies) {
        for (const name of ['prisma', 'typescript']) {
          delete pkg.peerDependencies[name];
          if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
        }
      }
      return pkg;
    },
  },
};
