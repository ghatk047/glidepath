# docker buildx bake -f ops/docker/logic/docker-bake.hcl --print logic
# Builds glidepath/logic for linux/arm64 (Apple Silicon) and linux/amd64 (x86 cloud hosts).
# Run from the repo root; TAG matches docker-compose.yml (default dev).

variable "TAG" {
  default = "dev"
}

# Registry prefix for CI pushes, for example ghcr.io/<owner>/. Empty keeps local names.
variable "REGISTRY" {
  default = ""
}

variable "STRICT_ENTRYPOINTS" {
  default = "0"
}

variable "SERVER_ENTRY" {
  default = "tier2-logic/server/dist/server.js"
}

variable "WORKER_ENTRY" {
  default = "tier2-logic/worker/dist/worker.js"
}

variable "MIGRATE_ENTRY" {
  default = "tier2-logic/worker/dist/migrate.js"
}

group "default" {
  targets = ["logic"]
}

target "logic" {
  context    = "."
  dockerfile = "ops/docker/logic/Dockerfile"
  tags       = ["${REGISTRY}glidepath/logic:${TAG}"]
  platforms  = ["linux/arm64", "linux/amd64"]
  args = {
    SERVER_ENTRY       = SERVER_ENTRY
    WORKER_ENTRY       = WORKER_ENTRY
    MIGRATE_ENTRY      = MIGRATE_ENTRY
    STRICT_ENTRYPOINTS = STRICT_ENTRYPOINTS
  }
}
