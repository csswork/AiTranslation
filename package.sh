#!/usr/bin/env bash
# 兼容原来的根目录打包命令。
set -euo pipefail
exec bash "$(dirname "$0")/apps/extension/package.sh" "$@"
