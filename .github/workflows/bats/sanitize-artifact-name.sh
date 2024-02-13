#!/bin/bash
set -o errexit -o nounset -o pipefail

# GitHub restricts artifact filenames:

# Invalid characters include: Double quote ", Colon :, Less than <,
# Greater than >, Vertical bar |, Asterisk *, Question mark ?, Carriage
# return \r, Line feed \n
#
# The following characters are not allowed in files that are uploaded
# due to limitations with certain file systems such as NTFS. To maintain
# file system agnostic behavior, these characters are intentionally not
# allowed to prevent potential problems with downloads on different file
# systems.

# By default, this script takes a string on standard input and outputs the
# sanitized string on standard output.  If any positional parameters are given,
# it instead treats them as file names to (recursively) rename.

sanitize() {
    local new=$1
    new=${new//\"/%22}
    new=${new//:/%3A}
    new=${new//</%3C}
    new=${new//>/%3E}
    new=${new//|/%7C}
    new=${new//\*/%2A}
    new=${new//\?/%3F}
    new=${new//$'\r'/}
    new=${new//$'\n'/}
    echo "$new"
}

if [[ ${#@} -lt 1 ]]; then
    # No arguments; sanitize standard input.
    sanitize "$(cat)"
    exit
fi

# Find all files and put the names into the FILES array.
# We don't rename inside the loop to make sure the find command has
# finished before we modify any directories it is iterating over.
FILES=()
for PARAM in "$@"; do
    while read -d $'\0' -r FILE; do
        FILES+=("$FILE")
    done < <(find "$PARAM" -type f -print0)
done

for FILE in "${FILES[@]}"; do
    NEW="$(sanitize "$FILE")"
    if [[ $FILE != "$NEW" ]]; then
        echo "$NEW"
        mv "$FILE" "$NEW"
    fi
done
