#!/usr/bin/env bash

# Add kernel parameters to the Alpine guest by patching the ISO that Rancher
# Desktop boots.  Lima ignores kernel.cmdline on EFI boot and the guest root is
# read-only, so the bootloader config inside the image is the only way in.
#
# The parameters go into boot/grub/grub.cfg, which the EFI GRUB reads from the
# ISO9660 filesystem: the GRUB binary in boot/grub/efi.img carries an embedded
# `set prefix=($root)/boot/grub` and holds no config of its own.
#
# Usage: [RD_RESOURCES_DIR=<dir>] patch-guest-iso.sh <kernel parameters>
#   tsc_early_khz=auto is replaced with this host's own TSC frequency in kHz,
#   which is the only correct value: the parameter takes a literal number and
#   a wrong one gives the guest a clock it trusts and should not.

set -o errexit -o nounset -o pipefail

params=$*
if [[ -z $params ]]; then
    echo "usage: $0 <kernel parameters>" >&2
    exit 1
fi

# The installed app by default; a dev tree (yarn test:e2e) resolves
# baseDiskImage under the checkout's own resources instead, so let the caller
# say where.  The layout below this directory is identical either way.
app="/Applications/Rancher Desktop.app"
resources=${RD_RESOURCES_DIR:-$app/Contents/Resources/resources/darwin}

if [[ $params == *tsc_early_khz=auto* ]]; then
    hz=$(sysctl -n machdep.tsc.frequency 2>/dev/null || echo 0)
    if (( hz == 0 )); then
        echo "tsc_early_khz=auto needs machdep.tsc.frequency, which this host lacks" >&2
        exit 1
    fi
    params=${params//tsc_early_khz=auto/tsc_early_khz=$(( hz / 1000 ))}
fi
echo "Kernel parameters to add: $params"

isos=("$resources"/alpine-lima-*.iso)
iso=${isos[0]}
if [[ ! -f $iso ]]; then
    echo "No guest ISO under $resources" >&2
    exit 1
fi
echo "Guest ISO: $iso"

command -v xorriso >/dev/null || brew install xorriso

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# macOS hdiutil refuses this image ("no mountable file systems"); bsdtar reads
# ISO9660 directly.
bsdtar -xOf "$iso" boot/grub/grub.cfg > "$work/grub.cfg"
echo "--- original grub.cfg ---"
cat "$work/grub.cfg"

# Append to the existing kernel line rather than replacing it, so the console
# settings the image relies on survive.
sed "s|^\(linux[[:space:]].*\)$|\1 $params|" "$work/grub.cfg" > "$work/grub.cfg.new"
if ! grep -qF -- "$params" "$work/grub.cfg.new"; then
    echo "Failed to add the parameters to the kernel line" >&2
    exit 1
fi
echo "--- patched grub.cfg ---"
cat "$work/grub.cfg.new"

# -boot_image any replay re-emits El Torito, the protective MBR and the GPT.
# Without it the image does not boot.
xorriso -indev "$iso" -outdev "$work/patched.iso" \
    -boot_image any replay \
    -map "$work/grub.cfg.new" /boot/grub/grub.cfg \
    -commit

# Read the parameters back out of the finished image, because a silently
# unpatched ISO would look exactly like the fix not working.
bsdtar -xOf "$work/patched.iso" boot/grub/grub.cfg > "$work/grub.cfg.check"
if ! diff -q "$work/grub.cfg.new" "$work/grub.cfg.check" >/dev/null; then
    echo "The repacked ISO does not carry the patched grub.cfg" >&2
    diff "$work/grub.cfg.new" "$work/grub.cfg.check" || true
    exit 1
fi

cp "$work/patched.iso" "$iso"
echo "Patched $iso"

# Replacing a file inside the bundle breaks its seal, so re-sign ad hoc.  A
# dev tree has no bundle to sign, and an unsigned CI package does not need it.
if [[ $iso == "$app"/* ]]; then
    codesign --force --sign - "$app" 2>&1 | sed 's/^/codesign: /' || \
        echo "codesign failed; continuing, the package may be unsigned"
fi
