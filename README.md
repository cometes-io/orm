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

const orm = new Orm({ name: "demo" });
console.log(orm.ping()); // → "orm:demo"
```

## Documentation

| Section | Contenu |
|---------|---------|
| [Guide de démarrage](docs/guide/getting-started.md) | Installer, lancer l’exemple, Docker |
| [Architecture](docs/concepts/architecture.md) | Modèle mental du projet |
| [Exemple Node.js](examples/nodejs/) | Code exécutable |

## Scripts

```bash
npm run build      # compile src/ → dist/
npm run example    # lance l’exemple local
npm test           # tests unitaires
```

## Licence

Apache License 2.0
