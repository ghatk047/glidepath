# ADR-013: Docker Compose on the user's Mac, multi-arch images, 12-factor config

## Context

The user has Docker and no cloud account yet; a cloud host must be able to run the same images later.

## Decision

Docker Compose on the owner's Mac is the first environment. Images are multi-arch (arm64 and amd64). All configuration is environment variables listed in `.env.example`. Rejected: Fly.io for v1.0. Neon is the planned next database host (ADR-015): the stack takes its database only from DATABASE_URL, so moving is a config change.

## Consequences

`docker compose up` is the run path. Moving to a VM, managed containers or Kubernetes changes only env vars and infrastructure (deployment doc section 5). Database portability is detailed in ADR-015.

## Status

Accepted
