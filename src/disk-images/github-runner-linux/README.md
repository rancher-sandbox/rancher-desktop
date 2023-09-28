# github-runner-linux

This is a [kiwi-ng](https://osinside.github.io/kiwi/) definition for a VM disk
image for use as a self-hosted GitHub runner.

## Usage

The image can be built using `./build-image.sh` from an OpenSUSE host (or a
container running OpenSUSE).  `sudo` access will be required to delete the
temporary directory, as well as to copy the output image around.
