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
Source0:    %{name}-%{version}-linux.zip
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
Requires:       qemu-utils
Requires:       qemu-system-x86
Requires:       openssh-client
%else
Requires:       qemu
Requires:       openssh-clients
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
