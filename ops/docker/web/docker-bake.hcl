# Multi-arch build of glidepath/web (docs/architecture/11_docker_deployment.md section 5).
#
#   docker buildx bake -f ops/docker/web/docker-bake.hcl web --print     # show the plan
#   docker buildx bake -f ops/docker/web/docker-bake.hcl web --load      # host arch, into the daemon
#   TAG=1.0.0 REGISTRY=ghcr.io/<org>/ docker buildx bake -f ops/docker/web/docker-bake.hcl web --push
#
# Run from the repo root: the build context is the repo root, like docker-compose.yml.

variable "TAG" {
  default = "dev"
}

# Registry prefix including the trailing slash, e.g. "ghcr.io/acme/". Empty for local images.
variable "REGISTRY" {
  default = ""
}

group "default" {
  targets = ["web"]
}

target "web" {
  context    = "."
  dockerfile = "ops/docker/web/Dockerfile"
  tags       = ["${REGISTRY}glidepath/web:${TAG}"]
  platforms  = ["linux/arm64", "linux/amd64"]
}
