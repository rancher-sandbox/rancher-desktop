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
from typing import Iterator, List, Literal, Protocol, Union

Platforms = Literal["linux", "mac"]
Hosts = Literal["ubuntu-latest", "macos-12"]

@dataclasses.dataclass
class Result:
    """
    A Result describes a test run, which is a matrix entry.
    """
    # The name of the test; either a directory or a file name (without extension)
    name: str
    host: Hosts
    engine: Literal["containerd", "moby"]

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

for test in os.environ.get("TESTS", "*").split():
    platforms: List[Platforms] = os.environ.get("PLATFORMS", "linux mac").split()
    engines: List[Literal["containerd", "moby"]] = os.environ.get("ENGINES", "contained moby").split()
    for platform in platforms:
      host: Hosts = {
         "linux": "ubuntu-latest",
         "mac": "macos-12",
      }[platform]
      for name in resolve_test(test, platform):
          for engine in engines:
            if os.access(name, os.R_OK):
              result = Result(name=name, host=host, engine=engine)
            elif os.access(f"{name}.bats", os.R_OK):
              result = Result(name=name, host=host, engine=engine)
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
