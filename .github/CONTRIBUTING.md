# Contributing

Thanks for your interest! Issues and pull requests are welcome.

## Issues

- Bugs and feature requests: use the [issue templates](https://github.com/gekkyo/animate-mcp/issues/new/choose).
  Include your Animate version, OS, and document type (ActionScript 3 / HTML5 Canvas).
- Security issues: see [SECURITY.md](SECURITY.md). Do not open a public issue.

## Development

Requires Node.js and (for real-Animate checks) Adobe Animate.

```sh
npm install
npm run lint    # biome check  (fix with: npm run format)
npm run build
npm test
```

### Real-Animate smoke tests

CI uses a fake Animate. For changes to JSFL or tool behavior, also run the matching
smoke script with Animate open (each creates and closes a disposable document):

```sh
npm run build && node server/scripts/smoke-edit-elements.mjs
```

## Pull requests

- Branch from and target `develop`.
- Keep changes focused; add or update tests in `server/test/`.
- Update `README.md` and `README.ja.md` when tool behavior changes, and add a `CHANGELOG.md` entry.
- `npm run lint`, `npm run build`, and `npm test` must pass (CI checks them).

By contributing, you agree that your contributions are licensed under the [MIT License](../LICENSE),
and to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
