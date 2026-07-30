#!/bin/sh
# Seeds the bind-mounted ${DATA_DIR}/models volume with the AI model files
# baked into this image at build time (face detection/recognition ONNX +
# SmolVLM captioning GGUF/mmproj - see Dockerfile's "ai-models" stage),
# without ever overwriting a file the user already placed there themselves
# (e.g. a custom/different model, or the manually-downloaded YOLO one - see
# docs/configuration.md). Preserves subdirectories (e.g. "llm/") from the
# seed tree. Runs on every container start; a no-op after the first boot
# once the files exist.
set -e

seed_dir="/app/models-seed"
target_dir="${DATA_DIR:-/data}/models"

if [ -d "$seed_dir" ]; then
  find "$seed_dir" -type f | while IFS= read -r seed_file; do
    rel_path=${seed_file#"$seed_dir"/}
    target_file="$target_dir/$rel_path"
    if [ ! -f "$target_file" ]; then
      mkdir -p "$(dirname "$target_file")"
      cp "$seed_file" "$target_file"
    fi
  done
fi

exec "$@"
