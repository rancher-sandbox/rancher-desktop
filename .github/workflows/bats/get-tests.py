#!/usr/bin/env python3

# This script determines the tests to be run.
# Inputs (as environment variables, all are space-separated):
# TESTS The set of tests to run (e.g. "*", "containers k8s")
# PLATFORMS The set of platforms (e.g. "linux mac")
# ENGINES The set of engines (e.g. "containerd moby")
# The working directory must be the "bats/tests/" folder

import dataclasses
import glob
import json
from operator import attrgetter
import os
import sys
from typing import Iterator, List, Literal, get_args

Platforms = Literal["linux", "mac", "win"]
Hosts = Literal["ubuntu-latest", "macos-12", "windows-latest"]
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
    # The version of k3s to test; may be empty.
    k3sVersion: str

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
    if test.host == "macos-12" and test.name.startswith("k8s/"):
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
         "mac": "macos-12",
         "win": "windows-latest",
      }[platform]
      for name in resolve_test(test, platform):
          for engine in engines:
            # If using containerd, use the maximum version of k3s that is
            # supported by the Rancher helm chart; as of 2.8.5, that's 1.28.x.
            k3sVersion = "1.28.11" if engine == "containerd" else ""
            if os.access(name, os.R_OK):
              result = Result(name=name, host=host, engine=engine, k3sVersion=k3sVersion)
            elif os.access(f"{name}.bats", os.R_OK):
              result = Result(name=name, host=host, engine=engine, k3sVersion=k3sVersion)
            else:
              errors = True
              print(f"Failed to find test {name}", file=sys.stderr)
              continue
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
