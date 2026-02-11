#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_PATH="$SCRIPT_DIR/../backend/public/mountain.jpg"

if [ -f "$IMAGE_PATH" ]; then
  echo "Image already exists: $IMAGE_PATH"
  exit 0
fi

echo "Downloading mountain image from Unsplash..."
# Photo: "A mountain range with a snow covered peak in the distance"
# https://unsplash.com/photos/a-mountain-range-with-a-snow-covered-peak-in-the-distance-NVUxS1SFhKE
# Unsplash License: free to use, attribution appreciated but not required
curl -fSL -o "$IMAGE_PATH" \
  "https://images.unsplash.com/photo-1671865128471-3d68923e7191?w=1920&q=80&fm=jpg"

if [ -s "$IMAGE_PATH" ]; then
  echo "Downloaded: $(du -h "$IMAGE_PATH" | cut -f1)"
else
  echo "ERROR: Failed to download image. Please download manually:"
  echo "  https://unsplash.com/photos/NVUxS1SFhKE"
  echo "  Save as: $IMAGE_PATH"
  rm -f "$IMAGE_PATH"
  exit 1
fi
