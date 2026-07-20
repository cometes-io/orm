# @cometes-io/orm

ORM pour Node.js (TypeScript).

> Statut : squelette initial — l’API évolue encore.

## Installation

```bash
npm install @cometes-io/orm
```

## Quickstart

```ts
import { Orm } from "@cometes-io/orm";

const orm = new Orm({
  postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
});
await orm.migrate("./migrations");
console.log(await orm.ping());
await orm.disconnect();
```

## Documentation

| Section | Contenu |
|---------|---------|
| [Guide de démarrage](docs/guide/getting-started.md) | Installer, lancer l’exemple, Docker |
| [Migrations](docs/guide/migrations.md) | SQL versionnés + Adminer |
| [Architecture](docs/concepts/architecture.md) | Modèle mental du projet |
| [Exemple Node.js](examples/nodejs/) | Code exécutable |

## Scripts

```bash
npm run build      # compile src/ → dist/
npm run migrate    # applique examples/nodejs/migrations/*.ts
npm run example    # lance l’exemple local
npm test           # tests unitaires
npm run ci         # typecheck + tests + build (utilisé en CI)
```

## CI

À chaque push / PR sur `main`, GitHub Actions exécute typecheck, tests et build sur Node 20 et 22 (voir [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Licence

Apache License 2.0
