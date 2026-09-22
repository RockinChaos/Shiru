#!/bin/bash

# Build native Node.js addons for Android
# This script is intended to be run inside the Docker container defined in Dockerfile
# It cross-compiles native modules for arm, arm64, and x86_64 Android targets

if [ -d "node_modules" ]; then
    echo "node_modules already exists, removing for a clean install"
    rm -rf node_modules
fi
npm install

toolchain_folder=$NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin
export PATH=$toolchain_folder:$PATH

toolchain_target_archs=(armv7a aarch64 x86_64)
node_target_arch=(arm arm64 x64)
android_api_levels=(eabi24 "24" "24")

for ((i=0;i<${#toolchain_target_archs[@]};i++)); do
  toolchain_target_arch=${toolchain_target_archs[i]}
  node_target_arch=${node_target_arch[i]}
  android_api_level=${android_api_levels[i]}

  export CC=$toolchain_folder/${toolchain_target_arch}-linux-android${android_api_level}-clang
  export CXX=$toolchain_folder/${toolchain_target_arch}-linux-android${android_api_level}-clang++
  export LINK=$toolchain_folder/${toolchain_target_arch}-linux-android${android_api_level}-clang++
  export AR=$toolchain_folder/llvm-ar

  export npm_config_verbose=1
  export npm_config_nodedir=${LIBNODE_PATH}
  export npm_config_node_gyp=$(pwd)/node_modules/nodejs-mobile-gyp/bin/node-gyp.js
  export npm_config_arch=${node_target_arch}
  export npm_config_platform=android
  export npm_config_format=make-android
  export npm_gyp_defines="target_arch=$node_target_arch v8_target_arch=$node_target_arch android_target_arch=$node_target_arch host_os=linux OS=android"

  # --build-from-source is used by node-pre-gyp
  echo "Rebuilding for $node_target_arch"
  npm rebuild --build-from-source

  for file in node_modules/*/build/Release/*.node; do
    package=$(echo "$file" | cut -f 2 -d "/")
    echo "moving prebuild for $package ($file)"
    mkdir "node_modules/$package/prebuilds/android-$node_target_arch"
    mv $file "node_modules/$package/prebuilds/android-$node_target_arch/node.napi.node"
    rm -r "node_modules/$package/build/"
  done
done