# ADR-012: AI reconfiguration is a fixed pipeline on the Claude API

## Context

AI-proposed changes must be validated and calibrated by our own engine, not trusted directly.

## Decision

A fixed pipeline on the Claude API (`claude-opus-5-5`) running in the worker; its output is a draft changeset plus calibration report that the user reviews before applying. Rejected: a free agent writing to the database.

## Consequences

The model never writes data directly. Needs an API key in `.env` and a token budget per job (ADR-022). Cost and latency are bounded by the pipeline.

## Status

Accepted
