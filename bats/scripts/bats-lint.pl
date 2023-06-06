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

while (<>) {
    # bats files should not override the global setup and teardown functions.
    # They should define local_* variants instead, which will be called from
    # the global versions.
    if (/^((setup|teardown)\w*)\(/) {
        print "$ARGV:$.: Don't define $1(); define local_$1() instead\n";
        $problems++;
    }

    # Matches:
    # - assert_success
    # - $assert_success
    # - $ {assert}_success
    # - if [ $status -eq 0 ]
    if (/(\$\{?)?(assert|refute|output\b|status\b)/) {
        undef $run;
    }
    # Doesn't match on:
    # - "empty lines (just whitespace)"
    # - if ...
    if ($run && !/^\s*(if.*)?$/) {
        print "$ARGV:$.: Expected assert or refute after\n$run\n";
        undef $run;
        $problems++;
    }
    # Matches any line starting with "run " or "try "
    if (/^\s*(run|try)\s/) {
        $run = $_;
    }
    # Reset $. line counter for next input file
    close ARGV if eof;
}

die "Found $problems problems\n" if $problems;
