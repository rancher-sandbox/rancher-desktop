ensure_dotfiles_are_completed_BUG_BUG_BUG_4519() {
    # BUG BUG BUG
    # BUG 4519
    # Looks like the rcfiles don't get updated via `rdctl start`
    # BUG BUG BUG
    if is_unix; then
        rdctl set --application.path-management-strategy manual
        rdctl set --application.path-management-strategy rcfiles
    fi
}
