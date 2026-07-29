# Build/publish helpers for the backend image (which embeds the built
# frontend - see backend/Dockerfile) to Docker Hub.
#
# Usage:
#   make build                 # build a local single-arch image (fast, for testing)
#   make login                 # docker login (interactive - do this once before push/release)
#   make push                  # build (if needed) + push a single-arch image
#   make release                # multi-arch (amd64+arm64) build, pushed directly via buildx
#   make release VERSION=1.2.0  # also tags/pushes :1.2.0 alongside :latest
#   make certs                  # generate a local HTTPS cert (mkcert, no local install needed - see docs/configuration.md)
#
# Override the image name if you're publishing to your own Docker Hub
# account/org: `make release IMAGE=yourname/opendvr`.

IMAGE ?= celsoenssure/opendvr
TAG ?= latest
VERSION ?=
PLATFORMS ?= linux/amd64,linux/arm64
BUILDER ?= opendvr-builder
CERTS_DIR ?= certs
CERT_HOSTS ?= homeserver.lan 127.0.0.1 

.PHONY: build login push release buildx-setup buildx-clean certs

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

## Generates a locally-trusted TLS cert/key for the optional local HTTPS
## listener (see docs/configuration.md's "Local HTTPS for Push
## notifications" section) using mkcert, run inside a throwaway `golang`
## container via `go install filippo.io/mkcert@latest` - no need to install
## mkcert (or Go) on your own machine at all.
##
## Override which hosts/IPs the cert covers, e.g.:
##   make certs CERT_HOSTS="opendvr.local 192.168.1.50"
##
## IMPORTANT: this only GENERATES the certificate files - it can't install
## the CA into a browser/OS trust store, since that has to happen on
## whichever device will actually access the app over HTTPS (phone,
## laptop...), not inside this throwaway container. After running this,
## copy $(CERTS_DIR)/rootCA.pem to each such device and trust it manually
## (double-click on macOS/Windows to add it to the system keychain/cert
## store; Firefox keeps its own store, so use Settings -> Certificates ->
## Import there instead).
certs:
	mkdir -p $(CERTS_DIR)
	docker run --rm \
		-v $(abspath $(CERTS_DIR)):/certs \
		-e CAROOT=/certs \
		-e GOBIN=/usr/local/bin \
		golang:1.22-alpine \
		sh -c "go install filippo.io/mkcert@latest && mkcert -cert-file /certs/cert.pem -key-file /certs/key.pem $(CERT_HOSTS)"
	@echo ""
	@echo "Certificado gerado em $(CERTS_DIR)/cert.pem e $(CERTS_DIR)/key.pem"
	@echo ""
	@echo "Copie $(CERTS_DIR)/rootCA.pem para cada dispositivo que vai acessar via HTTPS e confie nele manualmente (isso não dá pra automatizar de dentro do container - é por dispositivo)."
	@echo "Depois defina no seu .env (raiz do repo): HTTPS_CERT_FILE=/certs/cert.pem e HTTPS_KEY_FILE=/certs/key.pem"
