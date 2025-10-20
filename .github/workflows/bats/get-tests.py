#!/usr/bin/env python3

# This script determines the tests to be run.
# Inputs (as environment variables, all are space-separated):
# TESTS The set of tests to run (e.g. "*", "containers k8s")
# PLATFORMS The set of platforms (e.g. "linux mac")
# ENGINES The set of engines (e.g. "containerd moby")
# KUBERNETES_VERSION The default Kubernetes version to use
# KUBERNETES_ALT_VERSION Alternative Kubernetes version for coverage
# The working directory must be the "bats/tests/" folder

import dataclasses
import glob
import json
from operator import attrgetter
import os
import sys
from typing import Iterator, List, Literal, get_args

Platforms = Literal["linux", "mac", "win"]
Hosts = Literal["ubuntu-latest", "macos-15-intel", "windows-latest"]
Engines = Literal["containerd", "moby"]

@dataclasses.dataclass
class Result:
    """
    A Result describes a test run, which is a matrix entry.
    """
    # The name of the test; either a directory or a file name (without extension)
    name: str
    host: Hosts
    engine: Engines
    # The version of k3s to test
    k3sVersion: str
    # A different Kubernetes version, for testing upgrades.
    k3sAltVersion: str

    key = staticmethod(attrgetter("name", "host", "engine"))

def resolve_test(test: str, platform: Platforms) -> Iterator[str]:
    """
    Given a test spec, convert that to a list of tests.
    """
    # If we can't glob the test, use it as-is.
    for test in glob.glob(test) or (test,):
        if platform == "mac" and test == "k8s":
            # The macOS runners on CI are extra slow; for this test suite,
            # run each test individually.
            for name in glob.glob("k8s/*.bats"):
                yield name.removesuffix(".bats")
        else:
            yield test.removesuffix(".bats")

def skip_test(test: Result) -> bool:
    """
    Check if a given test should be skipped.
    We skip some tests because the CI machines can't handle them.
    """
    if test.host == "macos-15-intel" and test.name.startswith("k8s/"):
        # The macOS CI runners are slow; skip some tests that can be tested on
        # other OSes.
        skipped_tests = ("verify-cached-images",)
        if any(test.name == f"k8s/{t}" for t in skipped_tests):
            return True
    return False

results: List[Result] = list()
errors: bool = False

for test in (os.environ.get("TESTS", None) or "*").split():
    platforms: List[Platforms] = os.environ.get("PLATFORMS", "").split() or get_args(Platforms)
    engines: List[Engines] = os.environ.get("ENGINES", "").split() or get_args(Engines)
    for platform in platforms:
      host: Hosts = {
         "linux": "ubuntu-latest",
         "mac": "macos-15-intel",
         "win": "windows-latest",
      }[platform]
      for name in resolve_test(test, platform):
          for engine in engines:
            if os.access(name, os.R_OK):
              pass
            elif os.access(f"{name}.bats", os.R_OK):
              name = f"{name}.bats"
            else:
              errors = True
              print(f"Failed to find test {name}", file=sys.stderr)
              continue

            # To get some coverage of different Kubernetes versions, pick the
            # version depending on the container engine; one gets the old version
            # we previously tested, the other gets the maximum version
            # of k3s that is supported by the Rancher helm chart.  These values
            # come from the environment.
            k3sVersion = os.environ.get("KUBERNETES_VERSION", "")
            k3sAltVersion = os.environ.get("KUBERNETES_ALT_VERSION", "")
            if k3sVersion == "" or k3sAltVersion == "":
               raise "Either KUBERNETES_VERSION or KUBERNETES_ALT_VERSION is unset"
            if engine == "containerd":
              (k3sAltVersion, k3sVersion) = (k3sVersion, k3sAltVersion)

            result = Result(name=name, host=host, engine=engine,
                            k3sVersion=k3sVersion, k3sAltVersion=k3sAltVersion)
            if not skip_test(result):
                results.append(result)

dicts = [dataclasses.asdict(x) for x in sorted(results, key=Result.key)]

output = os.environ.get("GITHUB_OUTPUT", None)
if output is not None:
  with open(output, "a") as file:
    print(f"tests={json.dumps(dicts)}", file=file)

json.dump(dicts, sys.stdout, indent=2)

if errors:
    raise FileNotFoundError("Some tests were not found")
