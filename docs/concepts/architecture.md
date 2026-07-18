# Architecture

Vue d’ensemble du dépôt — le *pourquoi* de l’organisation, pas le détail de l’API.

## Organisation

```
orm/
├── src/
│   ├── index.ts         # exports publics
│   ├── orm.ts           # façade Orm
│   ├── postgres/        # persistance
│   └── redis/           # cache / files
├── examples/            # usages concrets + Docker Compose
├── tests/               # tests unitaires (miroir de src/)
└── docs/                # documentation utilisateur
```

| Dossier | Responsabilité |
|---------|----------------|
| `src/` | Code distribué via npm ; seuls les exports de `index.ts` sont publics |
| `src/postgres/` | Client PostgreSQL (init → connexion → CRUD → déconnexion) |
| `src/redis/` | Client Redis (init → connexion → CRUD / cache / queue → déconnexion) |
| `examples/` | Preuves exécutables (Node, compose) — pas de doc dupliquée |
| `tests/` | Comportement attendu de l’API publique |
| `docs/` | Guides et concepts ; la référence API vit dans le TSDoc de `src/` |

## Point d’entrée public

Tout ce qu’un consommateur du package peut importer passe par `src/index.ts`.  
Le reste de `src/` est considéré interne jusqu’à export explicite.

## Évolution prévue

L’ORM s’étendra typiquement autour de :

1. **Connexion** — Postgres (persistance), Redis (cache / files)
2. **Modèles** — description des entités et relations
3. **Requêtes** — lecture / écriture typées
4. **Migrations** — évolution du schéma

Chaque brique aura sa page dans `docs/guide/` quand elle existera ; cette page restera le modèle mental global.
