#!/bin/bash
set -euo pipefail
shopt -s nullglob

# Build native Node.js addons for Android
# This script is intended to be run inside the Docker container defined in Dockerfile
# It cross-compiles native modules for arm, arm64, and x86_64 Android targets

# Dependencies are installed without host lifecycle scripts, each addon is built below.
rm -rf node_modules
pnpm install --frozen-lockfile --ignore-scripts --node-linker=hoisted
node_gyp="$(npm root -g)/npm/node_modules/node-gyp/bin/node-gyp.js"

toolchain_folder=$NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin
export PATH=$toolchain_folder:$PATH

toolchain_target_archs=(armv7a aarch64 x86_64)
node_target_arch=(arm arm64 x64)
android_api_levels=(eabi24 "24" "24")
elf_machines=("ARM" "AArch64" "Advanced Micro Devices X86-64")

for ((i=0;i<${#toolchain_target_archs[@]};i++)); do
  toolchain_target_arch=${toolchain_target_archs[i]}
  node_target_arch=${node_target_arch[i]}
  android_api_level=${android_api_levels[i]}

  export CC=$toolchain_folder/${toolchain_target_arch}-linux-android${android_api_level}-clang
  export CXX=$toolchain_folder/${toolchain_target_arch}-linux-android${android_api_level}-clang++
  export LINK=$toolchain_folder/${toolchain_target_arch}-linux-android${android_api_level}-clang++
  export AR=$toolchain_folder/llvm-ar

  export GYP_DEFINES="target_arch=$node_target_arch v8_target_arch=$node_target_arch android_target_arch=$node_target_arch host_os=linux OS=android"

  echo "Rebuilding for $node_target_arch"
  for package_dir in node_modules/*; do
    [ -f "$package_dir/binding.gyp" ] || continue
    node "$node_gyp" rebuild --directory="$package_dir" \
      --arch="$node_target_arch" --nodedir="$LIBNODE_PATH" -- -f make-android

    files=("$package_dir"/build/Release/*.node)
    if [ ${#files[@]} -eq 0 ]; then
      echo "No native output for $package_dir ($node_target_arch)" >&2
      exit 1
    fi
    for file in "${files[@]}"; do
      if ! "$toolchain_folder/llvm-readelf" --file-header "$file" | grep -E "Machine:[[:space:]]+${elf_machines[i]}$" > /dev/null; then
        echo "Unexpected native architecture for $file (expected $node_target_arch)" >&2
        exit 1
      fi
      echo "moving prebuild for ${package_dir##*/} ($file)"
      mkdir -p "$package_dir/prebuilds/android-$node_target_arch"
      mv "$file" "$package_dir/prebuilds/android-$node_target_arch/node.napi.node"
    done
    rm -r "$package_dir/build/"
  done
done