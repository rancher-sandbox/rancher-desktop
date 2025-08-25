#
# spec file for package rancher-desktop
#
# Copyright (c) 2025 SUSE LLC
#
# All modifications and additions to the file contributed by third parties
# remain the property of their copyright owners, unless otherwise agreed
# upon. The license for this file, and modifications and additions to the
# file, is the same license as for the pristine package itself (unless the
# license for the pristine package is not an Open Source License, in which
# case the license is the MIT License). An "Open Source License" is a
# license that conforms to the Open Source Definition (Version 1.9)
# published by the Open Source Initiative.

# Please submit bugfixes or comments via https://bugs.opensuse.org/
#


Name:       rancher-desktop
Version:    0
Release:    0
Summary:    Kubernetes and container management on the desktop
License:    Apache-2.0
BuildRoot:  %{_tmppath}/%{name}-%{version}-build
Group:      Development/Tools/Other
Source0:    %{name}.zip
URL:        https://github.com/rancher-sandbox/rancher-desktop#readme

%if "%{_vendor}" == "debbuild"
# Needed to set Maintainer in output debs
Packager:       SUSE <containers@suse.com>
%endif

%if 0%{?fedora} || 0%{?rhel}
%global debug_package %{nil}
%endif

AutoReqProv:    no

BuildRequires:  unzip
%if 0%{?debian}
BuildRequires:  imagemagick
%else
BuildRequires:  ImageMagick
%endif

%if 0%{?debian}
Requires: qemu-utils
Requires: qemu-system-x86
Requires: pass
Requires: openssh-client
Requires: gnupg
Requires: libasound2
Requires: libatk1.0-0
Requires: libatk-bridge2.0-0
Requires: libatspi2.0-0
Requires: libc6
Requires: libcairo2
Requires: libcups2
Requires: libdbus-1-3
Requires: libdrm2
Requires: libexpat1
Requires: libgbm1
Requires: libgcc1
Requires: libgdk-pixbuf-2.0-0
Requires: libglib2.0-0
Requires: libglib2.0-dev
Requires: libgtk-3-0
Requires: libnspr4
Requires: libnss3
Requires: libpango-1.0-0
Requires: libx11-6
Requires: libxcb1
Requires: libxcomposite1
Requires: libxdamage1
Requires: libxext6
Requires: libxfixes3
Requires: libxkbcommon0
Requires: libxrandr2
%else
Requires: qemu
Requires: openssh-clients

%if 0%{?fedora} || 0%{?rhel}
Requires: pass
%else
Requires: password-store
Requires: qemu-img
%endif

Requires: glibc
Requires: desktop-file-utils

%if 0%{?fedora} || 0%{?rhel}
Requires: libX11
Requires: libXcomposite
Requires: libXdamage
Requires: libXext
Requires: libXfixes
Requires: libXrandr
Requires: alsa-lib
Requires: atk
Requires: at-spi2-atk
Requires: at-spi2-core
Requires: cairo
Requires: cups-libs
Requires: dbus-libs
Requires: libdrm
Requires: expat
Requires: mesa-libgbm
Requires: libgcc
Requires: gdk-pixbuf2
Requires: glib
Requires: gtk3
Requires: pango
Requires: libxcb
Requires: libxkbcommon
Requires: nspr
Requires: nss
%else
Requires: libX11-6
Requires: libXcomposite1
Requires: libXdamage1
Requires: libXext6
Requires: libXfixes3
Requires: libXrandr2
Requires: libasound2
Requires: libatk-1_0-0
Requires: libatk-bridge-2_0-0
Requires: libatspi0
Requires: libcairo2
Requires: libcups2
Requires: libdbus-1-3
Requires: libdrm2
Requires: libexpat1
Requires: libgbm1
Requires: libgcc_s1
Requires: libgdk_pixbuf-2_0-0
Requires: libgio-2_0-0
Requires: libglib-2_0-0
Requires: libgmodule-2_0-0
Requires: libgobject-2_0-0
Requires: libgtk-3-0
Requires: libpango-1_0-0
Requires: libxcb1
Requires: libxkbcommon0
Requires: mozilla-nspr
Requires: mozilla-nss
%endif

%endif

%description
Rancher Desktop is an open-source project to bring Kubernetes and container management to the desktop

%prep
%setup -c %{name} -n %{name}

%build
# Generate icons
icon="resources/resources/icons/logo-square-512.png"
for size in 512x512 256x256 128x128 96x96 64x64 48x48 32x32 24x24 16x16; do
  mkdir "share/icons/hicolor/${size}/apps" -p
  convert -resize "${size}" "${icon}" "share/icons/hicolor/${size}/apps/%{name}.png"
done

# Desktop integration files
mkdir -p share/applications share/metainfo
mv resources/resources/linux/rancher-desktop.desktop share/applications/rancher-desktop.desktop
mv resources/resources/linux/rancher-desktop.appdata.xml share/metainfo/rancher-desktop.appdata.xml

# Remove qemu binaries included in lima tarball
rm -v resources/resources/linux/lima/bin/qemu-*
rm -rvf resources/resources/linux/lima/lib
rm -rvf resources/resources/linux/lima/share/qemu

%install
mkdir -p "%{buildroot}%{_prefix}/bin" "%{buildroot}/opt/%{name}"

cp -ra ./share "%{buildroot}%{_prefix}"
cp -ra ./* "%{buildroot}/opt/%{name}"

# Link to the binary
ln -sf "/opt/%{name}/rancher-desktop" "%{buildroot}%{_bindir}/rancher-desktop"

%files
%defattr(-,root,root,-)
%dir /opt/%{name}
/opt/%{name}*
%attr(4755,root,root) /opt/%{name}/chrome-sandbox
%{_bindir}/rancher-desktop
%{_prefix}/share/applications/rancher-desktop.desktop
%{_prefix}/share/icons/hicolor/*
%{_prefix}/share/metainfo/rancher-desktop.appdata.xml

%changelog
