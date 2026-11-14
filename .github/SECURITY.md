# Security Policy

## Supported versions

Only the latest release published to npm (`animate-mcp`) receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately via
[GitHub private vulnerability reporting](https://github.com/gekkyo/animate-mcp/security/advisories/new)
(Security tab → "Report a vulnerability").

Include, if possible:

- affected version and Animate version
- steps to reproduce or a proof of concept
- impact

Reports are acknowledged on a best-effort basis; this is a single-maintainer project.

## Scope

This server runs JSFL inside Adobe Animate on the user's machine, including the
`run_jsfl` tool, which executes arbitrary JSFL by design. Reports about that
intended capability are out of scope; issues such as a tool escaping its
documented behavior, path traversal, or unintended file access are in scope.
