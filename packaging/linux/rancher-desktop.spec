#
# spec file for package rancher-desktop
#
# Copyright (c) 2021 SUSE LLC
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
Requires: openssh-client
Requires: libasound2
Requires: libatk1.0-0
Requires: libatk-bridge2.0-0
Requires: libatspi2.0-0
Requires: libavahi-client3
Requires: libavahi-common3
Requires: libblkid1
Requires: libbsd0
Requires: libc6
Requires: libc6-dev
Requires: libcairo2
Requires: libcairo-gobject2
Requires: libcom-err2
Requires: libdatrie1
Requires: libdbus-1-3
Requires: libdrm2
Requires: libepoxy0
Requires: libexpat1
Requires: libffi7
Requires: libfontconfig1
Requires: libfreetype6
Requires: libfribidi0
Requires: libgbm1
Requires: libgcrypt20
Requires: libgdk-pixbuf2.0-0
Requires: libglib2.0-0
Requires: libglib2.0-dev
Requires: libgmp10
Requires: libgnutls30
Requires: libgpg-error0
Requires: libgraphite2-3
Requires: libgssapi-krb5-2
Requires: libgtk-3-0
Requires: libharfbuzz0b
Requires: libhogweed5
Requires: libidn2-0
Requires: libk5crypto3
Requires: libkeyutils1
Requires: libkrb5-3
Requires: libkrb5support0
Requires: liblz4-1
Requires: liblzma5
Requires: libmount1
Requires: libnettle7
Requires: libp11-kit0
Requires: libpango-1.0-0
Requires: libpangocairo-1.0-0
Requires: libpangoft2-1.0-0
Requires: libpcre2-8-0
Requires: libpcre3
Requires: libpixman-1-0
Requires: libpng16-16
Requires: libsystemd0
Requires: libtasn1-6
Requires: libthai0
Requires: libunistring2
Requires: libuuid1
Requires: libwayland-client0
Requires: libwayland-cursor0
Requires: libwayland-egl1
Requires: libwayland-server0
Requires: libx11-6
Requires: libxau6
Requires: libxcb1
Requires: libxcb-render0
Requires: libxcb-shm0
Requires: libxcomposite1
Requires: libxcursor1
Requires: libxdamage1
Requires: libxdmcp6
Requires: libxext6
Requires: libxfixes3
Requires: libxi6
Requires: libxinerama1
Requires: libxkbcommon0
Requires: libxrandr2
Requires: libxrender1
Requires: zlib1g
%else
Requires: qemu
Requires: openssh-clients
Requires: fontconfig
Requires: glibc
Requires: krb5
Requires: libasound2
Requires: libatk-1_0-0
Requires: libatk-bridge-2_0-0
Requires: libatspi0
Requires: libavahi-client3
Requires: libavahi-common3
Requires: libblkid1
Requires: libbz2-1
Requires: libcairo2
Requires: libcairo-gobject2
Requires: libcap2
Requires: libcom_err2
Requires: libcups2
Requires: libdatrie1
Requires: libdbus-1-3
Requires: libdrm2
Requires: libepoxy0
Requires: libexpat1
Requires: libffi7
Requires: libfreetype6
Requires: libfribidi0
Requires: libgbm1
Requires: libgcc_s1
Requires: libgcrypt20
Requires: libgdk_pixbuf-2_0-0
Requires: libgio-2_0-0
Requires: libglib-2_0-0
Requires: libglvnd
Requires: libgmodule-2_0-0
Requires: libgmp10
Requires: libgnutls30
Requires: libgobject-2_0-0
Requires: libgpg-error0
Requires: libgraphite2-3
Requires: libgtk-3-0
Requires: libharfbuzz0
Requires: libhogweed4
Requires: libidn2-0
Requires: libkeyutils1
Requires: liblz4-1
Requires: liblzma5
Requires: libmount1
Requires: libnettle6
Requires: libp11-kit0
Requires: libpango-1_0-0
Requires: libpcre1
Requires: libpixman-1-0
Requires: libpng16-16
Requires: libselinux1
Requires: libsystemd0
Requires: libtasn1-6
Requires: libthai0
Requires: libunistring2
Requires: libwayland-client0
Requires: libwayland-cursor0
Requires: libwayland-egl1
Requires: libwayland-server0
Requires: libX11-6
Requires: libXau6
Requires: libxcb1
Requires: libxcb-render0
Requires: libxcb-shm0
Requires: libXcomposite1
Requires: libXcursor1
Requires: libXdamage1
Requires: libXext6
Requires: libXfixes3
Requires: libXi6
Requires: libXinerama1
Requires: libxkbcommon0
Requires: libXrandr2
Requires: libXrender1
Requires: libz1
Requires: libzstd1
Requires: mozilla-nspr
Requires: mozilla-nss
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

%post
# SUID chrome-sandbox for Electron 5+
chmod 4755 "/opt/%{name}/chrome-sandbox"

update-desktop-database %{_prefix}/share/applications || true

%files
%defattr(-,root,root,-)
%dir /opt/%{name}
/opt/%{name}*
%{_bindir}/rancher-desktop
%{_prefix}/share/applications/rancher-desktop.desktop
%{_prefix}/share/icons/hicolor/*
%{_prefix}/share/metainfo/rancher-desktop.appdata.xml

%changelog
