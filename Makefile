# Build/publish helpers for the backend image (which embeds the built
# frontend - see backend/Dockerfile) to Docker Hub.
#
# Usage:
#   make build                 # build a local single-arch image (fast, for testing)
#   make login                 # docker login (interactive - do this once before push/release)
#   make push                  # build (if needed) + push a single-arch image
#   make release                # multi-arch (amd64+arm64) build, pushed directly via buildx
#   make release VERSION=1.2.0  # also tags/pushes :1.2.0 alongside :latest
#
# Override the image name if you're publishing to your own Docker Hub
# account/org: `make release IMAGE=yourname/opendvr`.

IMAGE ?= celsoenssure/opendvr
TAG ?= latest
VERSION ?=
PLATFORMS ?= linux/amd64,linux/arm64
BUILDER ?= opendvr-builder

.PHONY: build login push release buildx-setup buildx-clean

## Builds a local single-arch image (whatever platform you're running on), tagged $(IMAGE):$(TAG).
build:
	docker build -f backend/Dockerfile -t $(IMAGE):$(TAG) .

## Interactive `docker login` - run once before push/release.
login:
	docker login

## Builds (single-arch, for your own machine's platform) then pushes $(IMAGE):$(TAG).
## Simpler than `release`, but the resulting image only works on the architecture it was built on.
push: build
	docker push $(IMAGE):$(TAG)

## Creates (if missing) and selects a dedicated buildx builder capable of
## multi-platform builds (needed for --platform with more than one arch).
buildx-setup:
	docker buildx inspect $(BUILDER) >/dev/null 2>&1 || docker buildx create --name $(BUILDER) --use
	docker buildx use $(BUILDER)

## Removes the dedicated buildx builder created by buildx-setup.
buildx-clean:
	docker buildx rm $(BUILDER) 2>/dev/null || true

## Multi-arch build (linux/amd64 + linux/arm64, e.g. for Raspberry Pi
## deployments) pushed straight to Docker Hub via buildx - `docker build`
## alone can't push multi-arch manifests, only buildx can. Also pushes
## :$(VERSION) alongside :latest when VERSION is set (e.g. `make release
## VERSION=1.2.0`).
release: buildx-setup
	docker buildx build \
		--platform $(PLATFORMS) \
		-f backend/Dockerfile \
		-t $(IMAGE):$(TAG) \
		$(if $(VERSION),-t $(IMAGE):$(VERSION),) \
		--push \
		.
