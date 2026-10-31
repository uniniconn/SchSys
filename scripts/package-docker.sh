#!/usr/bin/env bash
# =============================================================================
#  Build and export the scheduling-system Docker image (Linux / WSL)
#
#  Usage:
#    ./scripts/package-docker.sh               # SQLite variant
#    ./scripts/package-docker.sh --pg          # PostgreSQL variant
#    ./scripts/package-docker.sh --context-only
#
#  Output (dist/):
#    scheduling-system-<version>-<provider>.tar
#    scheduling-system-<version>-<provider>.tar.sha256
#    scheduling-system-docker-context-<version>.tar.gz
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"
PROVIDER="sqlite"
CONTEXT_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --pg|--postgres) PROVIDER="postgresql" ;;
    --context-only) CONTEXT_ONLY=1 ;;
    *) echo "unknown argument: $arg"; exit 1 ;;
  esac
done

VERSION="$(node -e "process.stdout.write(require('./package.json').version)")"
TAG="scheduling-system:$VERSION"
DIST="$PROJECT_ROOT/dist"
mkdir -p "$DIST"

echo "[1/4] Build context ($PROVIDER)"
node "$PROJECT_ROOT/scripts/package-docker-context.mjs"

if [ "$CONTEXT_ONLY" -eq 1 ]; then
  echo "[2/4] --context-only: skipping image build"
  exit 0
fi

echo "[2/4] Checking Docker engine"
if ! command -v docker >/dev/null 2>&1; then
  echo "  [!] docker not found; install Docker or build the context archive elsewhere" >&2
  exit 2
fi
if ! SERVER_VERSION="$(docker version --format '{{.Server.Version}}' 2>/dev/null)"; then
  echo "  [!] Docker engine is not running." >&2
  echo "      The build context is available: $DIST/scheduling-system-docker-context-$VERSION.tar.gz" >&2
  exit 2
fi
echo "  engine $SERVER_VERSION"

echo "[3/4] Building image $TAG (DATABASE_PROVIDER=$PROVIDER)"
docker build --build-arg "DATABASE_PROVIDER=$PROVIDER" -t "$TAG" .
docker tag "$TAG" scheduling-system:latest

TAR_PATH="$DIST/scheduling-system-$VERSION-$PROVIDER.tar"
echo "[4/4] Exporting image -> $TAR_PATH"
docker save -o "$TAR_PATH" "$TAG"
sha256sum "$TAR_PATH" | sed "s|dist/||" > "$TAR_PATH.sha256"

echo
echo "Done."
echo "  image tag : $TAG (also scheduling-system:latest)"
echo "  image tar : $TAR_PATH"
echo "  sha256    : $(cut -d' ' -f1 "$TAR_PATH.sha256")"
echo
echo "On the target server:"
echo "  docker load -i scheduling-system-$VERSION-$PROVIDER.tar"
echo "  docker compose up -d   # or docker run ..."
