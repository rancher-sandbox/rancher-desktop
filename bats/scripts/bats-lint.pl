#!/usr/bin/env perl

# This script checks a BATS script to make sure every `run` or `try` call is
# followed by a call to `assert` or `refute`, or a reference to `$output` or
# `$status`. `assert` may be a variable reference like `${assert}`.
#
# The `run` or `try` call may be followed by blank lines or `if ...` statements
# before the assert/refute becomes required.

use strict;
use warnings;

my $problems = 0;
my $run;
my $continue;

while (<>) {
    if ($ARGV =~ /\.bats$/) {
      # bats files should not override the global setup and teardown functions.
      # They should define local_* variants instead, which will be called from
      # the global versions.
      if (/^((setup|teardown)\w*)\(/) {
          print "$ARGV:$.: Don't define $1(); define local_$1() instead\n";
          $problems++;
      }

      if (/\b run \b .* \b load_var \b/x) {
          print "$ARGV:$.: Running load_var in a subshell (via run) does not work\n";
          $problems++;
      }
    }

    # The semver comparison functions take arguments that are valid semver;
    # catch uses of it with invalid versions, like '1.2' instead of '1.2.3'.
    if (/
      (semver_(?:n?eq|[lg]te?)) # Semver comparison function
      [^#\n]*                   # Eat any number of characters before new line or comment
      (?<!\d)                   # Was not preceded by digit (or we'd check that instead)
      (?<!\d\.)                 # Was not preceded by digit-dot (or we'd check that instead)
      (?!\d+\.\d+\.\d+)         # Is not a valid version string
      (\b\d[\d.]*)              # But starts a version string
    /x) {
      print qq'$ARGV:$.: $1 must be called with a valid semver, got "$2"\n';
      $problems++;
    }

    # Matches:
    # - assert_success
    # - $assert_success
    # - $ {assert}_success
    # - if [ $status -eq 0 ]
    if (/(\$\{?)? (assert | refute | \b output \b | \b status \b)/x) {
        undef $run;
        undef $continue;
    }
    # Doesn't match on:
    # - "empty lines (just whitespace or comment)"
    # - if ...
    if ($run) {
        if ($continue) {
            if (!/\\$/) {
                undef $continue;
            }
        } elsif (!/^\s*(#.*|if.*)?$/) {
            print "$ARGV:$.: Expected assert or refute after\n$run\n";
            undef $run;
            $problems++;
        }
    }
    # Matches any line starting with "run "
    if (/^\s*(run)\s/) {
        $run = $_;
        $continue = /\\$/;
    }
    # Reset $. line counter for next input file
    close ARGV if eof;
}

die "Found $problems problems\n" if $problems;
