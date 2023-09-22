load '../helpers/load'

# TODO: Uncomment this test when snapshots go unhidden.
#@test 'snapshot shows up in general help' {
#    run rdctl --help
#    assert_success
#    assert_output -partial snapshot
#}

@test 'complain about missing argument' {
    # These test the rdctl cmd layer, can't be easily unit-tested
    for arg in create restore delete; do
        run rdctl snapshot "$arg"
        assert_failure
    done
}
